"""
news_api.py — новини: статті спеціалістів + офіційні стрічки (Етап 4).

Усі ендпоінти потребують входу; запис — лише для ролі expert.

    GET    /news                      стрічка (kind, category, importance, unread_only, mine, q, limit, offset)
    GET    /news/unread-count         скільки непрочитаного (для бейджа вкладки)
    GET    /news/popup                важливі непрочитані — для спливаючого вікна
    POST   /news/read-all             позначити все свіже прочитаним
    GET    /news/{id}                 повний текст
    POST   /news/{id}/read            «прочитано» (гасить спливаюче вікно для цього користувача)
    POST   /news                      [expert] опублікувати статтю
    PATCH  /news/{id}                 [expert] змінити власну статтю
    DELETE /news/{id}                 [expert] видалити власну статтю
    GET    /news/sources              [expert] стан офіційних стрічок (коли оновлено, чи була помилка)
    POST   /news/sync                 [expert] оновити офіційні стрічки зараз

Офіційні новини підтягуються зі стрічок RSS/Atom, заданих у backend/.env (NEWS_FEEDS), раз на NEWS_SYNC_MINUTES
(за замовчуванням 180; 0 — вимкнути). Помилки стрічок зберігаються й показуються, а не ховаються.
Правила (ліміти, очищення тексту, відбір за ключовими словами) — у news_rules.py, розбір XML — у news_feeds.py.
Автентифікація передається ззовні, щоб не було циклічного імпорту main.
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

import news_rules as rules
from database import SessionLocal, get_db
from models import NewsFeedState, NewsPost, NewsRead, User, UserRole
from news_feeds import FeedError, FeedSource, external_id, fetch_feed, parse_feed, parse_sources
from news_schemas import (
    Category,
    Importance,
    Kind,
    NewsCreate,
    NewsDetailRead,
    NewsItemRead,
    NewsSourceRead,
    NewsSyncResult,
    NewsSyncSourceResult,
    NewsUnreadRead,
    NewsUpdate,
)

logger = logging.getLogger("fop_platform")

OFFICIAL_RETENTION_DAYS = 90
MANUAL_SYNC_COOLDOWN_SECONDS = 60
EDITED_AFTER_SECONDS = 120

_sync_lock = threading.Lock()
_last_manual_sync = 0.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "").strip() or default)
    except ValueError:
        return default


def _configured_sources() -> list[FeedSource]:
    """Джерела з NEWS_FEEDS; помилка в налаштуваннях повертається як зрозуміла HTTP-помилка."""
    try:
        return parse_sources(os.getenv("NEWS_FEEDS"))
    except FeedError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Помилка налаштування NEWS_FEEDS: {exc}") from exc


# =====================================================================
# Побудова відповідей
# =====================================================================
def _is_read_clause(user_id: int):
    return exists().where(NewsRead.news_id == NewsPost.id, NewsRead.user_id == user_id)


def _item_fields(post: NewsPost, viewer_id: int, is_read: bool) -> dict:
    published = rules.as_aware_utc(post.published_at)
    updated = rules.as_aware_utc(post.updated_at)
    author = post.author if post.kind == rules.KIND_ARTICLE else None
    spec = author.specialization if author is not None else None
    return dict(
        id=post.id,
        kind=post.kind,
        title=post.title,
        summary=post.summary,
        category=post.category if post.category in rules.CATEGORY_LABEL else rules.DEFAULT_CATEGORY,
        category_label=rules.CATEGORY_LABEL.get(post.category, rules.CATEGORY_LABEL[rules.DEFAULT_CATEGORY]),
        importance=post.importance,
        effective_date=post.effective_date,
        author_id=post.author_id if post.kind == rules.KIND_ARTICLE else None,
        author_name=author.full_name if author is not None else None,
        author_specialization=spec.value if spec is not None else None,
        source_name=post.source_name,
        source_url=post.source_url,
        published_at=published,
        updated_at=updated,
        edited=post.kind == rules.KIND_ARTICLE and (updated - published).total_seconds() > EDITED_AFTER_SECONDS,
        is_read=bool(is_read),
        is_mine=post.author_id == viewer_id and post.kind == rules.KIND_ARTICLE,
    )


def _item(post: NewsPost, viewer_id: int, is_read: bool) -> NewsItemRead:
    return NewsItemRead(**_item_fields(post, viewer_id, is_read))


def _detail(post: NewsPost, viewer_id: int, is_read: bool) -> NewsDetailRead:
    return NewsDetailRead(**_item_fields(post, viewer_id, is_read), body=post.body)


def _with_author(stmt):
    return stmt.options(selectinload(NewsPost.author).selectinload(User.expert_profile))


def _unread_counts(db: Session, user_id: int, now: datetime) -> NewsUnreadRead:
    since = now - timedelta(days=rules.UNREAD_WINDOW_DAYS)
    since_popup = now - timedelta(days=rules.POPUP_WINDOW_DAYS)
    unread = db.scalar(
        select(func.count()).select_from(NewsPost).where(NewsPost.published_at >= since, ~_is_read_clause(user_id))
    )
    important = db.scalar(
        select(func.count())
        .select_from(NewsPost)
        .where(
            NewsPost.importance == rules.IMPORTANT,
            NewsPost.published_at >= since_popup,
            ~_is_read_clause(user_id),
        )
    )
    return NewsUnreadRead(unread=int(unread or 0), important_unread=int(important or 0))


def _mark_read(db: Session, user_id: int, news_ids: list[int]) -> None:
    """Ідемпотентно ставить позначку «прочитано»; гонка двох запитів не дає помилки."""
    if not news_ids:
        return
    existing = set(
        db.scalars(select(NewsRead.news_id).where(NewsRead.user_id == user_id, NewsRead.news_id.in_(news_ids)))
    )
    fresh = [i for i in news_ids if i not in existing]
    if not fresh:
        return
    db.add_all(NewsRead(news_id=i, user_id=user_id) for i in fresh)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        for news_id in fresh:  # інший запит уже встиг частину — додаємо по одному
            try:
                db.add(NewsRead(news_id=news_id, user_id=user_id))
                db.commit()
            except IntegrityError:
                db.rollback()


def _own_article(db: Session, expert: User, news_id: int) -> NewsPost:
    post = db.scalar(
        _with_author(
            select(NewsPost).where(
                NewsPost.id == news_id, NewsPost.author_id == expert.id, NewsPost.kind == rules.KIND_ARTICLE
            )
        )
    )
    if post is None:
        # Чужу статтю й офіційну новину не розрізняємо — 404, щоб не підказувати існування запису
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Статтю не знайдено або вона вам не належить")
    return post


def _quota_counts(db: Session, author_id: int, now: datetime) -> tuple[int, int]:
    since = now - timedelta(hours=24)
    base = (NewsPost.author_id == author_id, NewsPost.kind == rules.KIND_ARTICLE, NewsPost.created_at >= since)
    articles = db.scalar(select(func.count()).select_from(NewsPost).where(*base))
    important = db.scalar(
        select(func.count()).select_from(NewsPost).where(*base, NewsPost.importance == rules.IMPORTANT)
    )
    return int(articles or 0), int(important or 0)


# =====================================================================
# Синхронізація офіційних стрічок (викликається з фону й вручну)
# =====================================================================
def _sync_one(
    db: Session, source: FeedSource, keywords: tuple[str, ...], max_age_days: int, max_items: int, now: datetime
) -> NewsSyncSourceResult:
    state = db.get(NewsFeedState, source.url)
    if state is None:
        state = NewsFeedState(url=source.url, name=source.name)
        db.add(state)
    state.name = source.name
    state.last_attempt_at = now

    try:
        items = parse_feed(fetch_feed(source.url), now)
    except FeedError as exc:
        state.last_error = str(exc)[:500]
        db.commit()
        logger.warning("Стрічка «%s» не оновлена: %s", source.name, exc)
        return NewsSyncSourceResult(name=source.name, ok=False, error=str(exc)[:500])

    fresh = [i for i in items if rules.is_fresh(i.published_at, now, max_age_days)][:max_items]
    matched = [
        i for i in fresh if not source.filtered or rules.matches_keywords(f"{i.title} {i.body}", keywords)
    ]
    by_id = {external_id(source.url, i.guid): i for i in matched}

    existing = set(db.scalars(select(NewsPost.external_id).where(NewsPost.external_id.in_(list(by_id))))) if by_id else set()
    new_items = [(eid, i) for eid, i in by_id.items() if eid not in existing]

    def build(eid: str, item) -> NewsPost:
        body = item.body or item.title
        return NewsPost(
            kind=rules.KIND_OFFICIAL,
            title=item.title,
            summary=rules.make_summary(body),
            body=body,
            category=rules.guess_category(item.title, item.body),
            importance=rules.NORMAL,
            source_name=source.name,
            source_url=item.link,
            external_id=eid,
            published_at=item.published_at,
        )

    added = 0
    try:
        db.add_all(build(eid, i) for eid, i in new_items)
        db.flush()
        added = len(new_items)
    except IntegrityError:
        # Паралельний процес уже додав частину записів — вставляємо по одному, дублікати пропускаємо
        db.rollback()
        state = db.get(NewsFeedState, source.url) or NewsFeedState(url=source.url, name=source.name)
        state.name, state.last_attempt_at = source.name, now
        db.add(state)
        for eid, i in new_items:
            try:
                with db.begin_nested():
                    db.add(build(eid, i))
                    db.flush()
                added += 1
            except IntegrityError:
                continue

    state.last_success_at = now
    state.last_error = None
    state.last_fetched = len(items)
    state.last_added = added
    db.commit()
    return NewsSyncSourceResult(name=source.name, ok=True, fetched=len(items), matched=len(matched), added=added)


def _prune_old_official(db: Session, now: datetime) -> None:
    cutoff = now - timedelta(days=OFFICIAL_RETENTION_DAYS)
    old_ids = list(
        db.scalars(select(NewsPost.id).where(NewsPost.kind == rules.KIND_OFFICIAL, NewsPost.published_at < cutoff))
    )
    if not old_ids:
        return
    db.execute(delete(NewsRead).where(NewsRead.news_id.in_(old_ids)))
    db.execute(delete(NewsPost).where(NewsPost.id.in_(old_ids)))
    db.commit()


def sync_feeds(db: Session, sources: list[FeedSource]) -> list[NewsSyncSourceResult]:
    now = _now()
    keywords = rules.parse_keywords(os.getenv("NEWS_KEYWORDS"))
    max_age = _int_env("NEWS_MAX_AGE_DAYS", 30)
    max_items = _int_env("NEWS_MAX_ITEMS_PER_FEED", 40)
    results = [_sync_one(db, s, keywords, max_age, max_items, now) for s in sources]
    try:
        _prune_old_official(db, now)
    except Exception:  # прибирання старого — другорядне, не ламає оновлення
        db.rollback()
        logger.exception("Не вдалося прибрати старі офіційні новини")
    return results


def _sync_once_blocking() -> None:
    try:
        sources = parse_sources(os.getenv("NEWS_FEEDS"))
    except FeedError as exc:
        logger.error("NEWS_FEEDS налаштовано некоректно: %s", exc)
        return
    if not sources:
        return
    with SessionLocal() as db:
        results = sync_feeds(db, sources)
    logger.info("Новини: оновлено %d стрічок, додано %d", len(results), sum(r.added for r in results))


async def _sync_loop(interval_minutes: int) -> None:
    await asyncio.sleep(5)  # дати застосунку піднятися
    while True:
        try:
            await asyncio.to_thread(_sync_once_blocking)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Фонове оновлення новин завершилося помилкою")
        await asyncio.sleep(interval_minutes * 60)


def start_news_sync() -> Optional["asyncio.Task[None]"]:
    """Запускає фонове оновлення офіційних стрічок; викликається з lifespan. None — якщо вимкнено або стрічок немає."""
    minutes = _int_env("NEWS_SYNC_MINUTES", 180)
    if minutes <= 0:
        logger.info("Автооновлення офіційних новин вимкнено (NEWS_SYNC_MINUTES=0)")
        return None
    if not os.getenv("NEWS_FEEDS", "").strip():
        logger.info("NEWS_FEEDS не задано — офіційні новини не підтягуються (статті спеціалістів працюють)")
        return None
    return asyncio.create_task(_sync_loop(minutes))


# =====================================================================
# Роутер
# =====================================================================
def create_news_router(get_current_user, require_role) -> APIRouter:
    router = APIRouter(prefix="/news", tags=["news"])

    DbDep = Annotated[Session, Depends(get_db)]
    CurrentUser = Annotated[User, Depends(get_current_user)]
    ExpertUser = Annotated[User, Depends(require_role(UserRole.expert))]

    # ---------- Читання ----------
    @router.get("", response_model=list[NewsItemRead])
    def list_news(
        db: DbDep,
        user: CurrentUser,
        kind: Optional[Kind] = None,
        category: Optional[Category] = None,
        importance: Optional[Importance] = None,
        unread_only: bool = False,
        mine: bool = False,
        q: Optional[str] = Query(default=None, max_length=100),
        limit: int = Query(default=20, ge=1, le=50),
        offset: int = Query(default=0, ge=0),
    ):
        stmt = _with_author(select(NewsPost, _is_read_clause(user.id).label("is_read")))
        if kind:
            stmt = stmt.where(NewsPost.kind == kind)
        if category:
            stmt = stmt.where(NewsPost.category == category)
        if importance:
            stmt = stmt.where(NewsPost.importance == importance)
        if mine:
            stmt = stmt.where(NewsPost.author_id == user.id, NewsPost.kind == rules.KIND_ARTICLE)
        if unread_only:
            since = _now() - timedelta(days=rules.UNREAD_WINDOW_DAYS)
            stmt = stmt.where(NewsPost.published_at >= since, ~_is_read_clause(user.id))
        term = rules.clean_text(q)
        if term:
            stmt = stmt.where(
                NewsPost.title.icontains(term, autoescape=True) | NewsPost.summary.icontains(term, autoescape=True)
            )
        stmt = stmt.order_by(NewsPost.published_at.desc(), NewsPost.id.desc()).limit(limit).offset(offset)
        return [_item(post, user.id, is_read) for post, is_read in db.execute(stmt).all()]

    @router.get("/unread-count", response_model=NewsUnreadRead)
    def unread_count(db: DbDep, user: CurrentUser):
        return _unread_counts(db, user.id, _now())

    @router.get("/popup", response_model=list[NewsDetailRead])
    def popup(db: DbDep, user: CurrentUser):
        """Важливі непрочитані повідомлення: показуються у спливаючому вікні, доки користувач не підтвердить."""
        since = _now() - timedelta(days=rules.POPUP_WINDOW_DAYS)
        stmt = _with_author(
            select(NewsPost, _is_read_clause(user.id).label("is_read")).where(
                NewsPost.importance == rules.IMPORTANT,
                NewsPost.published_at >= since,
                ~_is_read_clause(user.id),
            )
        )
        stmt = stmt.order_by(NewsPost.published_at.desc(), NewsPost.id.desc()).limit(rules.POPUP_MAX_ITEMS)
        return [_detail(post, user.id, is_read) for post, is_read in db.execute(stmt).all()]

    @router.post("/read-all", response_model=NewsUnreadRead)
    def read_all(db: DbDep, user: CurrentUser):
        now = _now()
        since = now - timedelta(days=rules.UNREAD_WINDOW_DAYS)
        ids = list(
            db.scalars(select(NewsPost.id).where(NewsPost.published_at >= since, ~_is_read_clause(user.id)))
        )
        _mark_read(db, user.id, ids)
        return _unread_counts(db, user.id, now)

    # ---------- Офіційні стрічки (статичні шляхи — до /{news_id}) ----------
    @router.get("/sources", response_model=list[NewsSourceRead])
    def list_sources(db: DbDep, expert: ExpertUser):
        sources = _configured_sources()
        states = {s.url: s for s in db.scalars(select(NewsFeedState))}
        out = []
        for src in sources:
            st = states.get(src.url)
            out.append(
                NewsSourceRead(
                    name=src.name,
                    url=src.url,
                    filtered=src.filtered,
                    last_attempt_at=rules.as_aware_utc(st.last_attempt_at) if st and st.last_attempt_at else None,
                    last_success_at=rules.as_aware_utc(st.last_success_at) if st and st.last_success_at else None,
                    last_error=st.last_error if st else None,
                    last_fetched=st.last_fetched if st else 0,
                    last_added=st.last_added if st else 0,
                )
            )
        return out

    @router.post("/sync", response_model=NewsSyncResult)
    def sync_now(db: DbDep, expert: ExpertUser):
        global _last_manual_sync
        sources = _configured_sources()
        if not sources:
            return NewsSyncResult(configured=False, added_total=0, sources=[])
        with _sync_lock:
            wait = MANUAL_SYNC_COOLDOWN_SECONDS - (time.monotonic() - _last_manual_sync)
            if wait > 0:
                raise HTTPException(
                    status.HTTP_429_TOO_MANY_REQUESTS,
                    f"Стрічки щойно оновлювали. Спробуйте за {int(wait) + 1} с.",
                )
            _last_manual_sync = time.monotonic()
        results = sync_feeds(db, sources)
        return NewsSyncResult(configured=True, added_total=sum(r.added for r in results), sources=results)

    # ---------- Одна новина ----------
    @router.get("/{news_id}", response_model=NewsDetailRead)
    def get_news(news_id: int, db: DbDep, user: CurrentUser):
        row = db.execute(
            _with_author(select(NewsPost, _is_read_clause(user.id).label("is_read")).where(NewsPost.id == news_id))
        ).first()
        if row is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Новину не знайдено")
        return _detail(row[0], user.id, row[1])

    @router.post("/{news_id}/read", response_model=NewsUnreadRead)
    def mark_read(news_id: int, db: DbDep, user: CurrentUser):
        if db.get(NewsPost, news_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Новину не знайдено")
        _mark_read(db, user.id, [news_id])
        return _unread_counts(db, user.id, _now())

    # ---------- Статті спеціалістів ----------
    @router.post("", response_model=NewsDetailRead, status_code=status.HTTP_201_CREATED)
    def create_article(payload: NewsCreate, db: DbDep, expert: ExpertUser):
        now = _now()
        articles, important = _quota_counts(db, expert.id, now)
        violation = rules.check_publish_quota(payload.importance, articles, important)
        if violation:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, violation.message)

        post = NewsPost(
            kind=rules.KIND_ARTICLE,
            title=payload.title,
            summary=rules.make_summary(payload.body),
            body=payload.body,
            category=payload.category,
            importance=payload.importance,
            effective_date=payload.effective_date,
            author_id=expert.id,
            source_url=payload.source_url,
            published_at=now,
        )
        db.add(post)
        db.flush()
        db.add(NewsRead(news_id=post.id, user_id=expert.id))  # автор не отримує власне спливаюче вікно
        db.commit()
        post = _own_article(db, expert, post.id)
        return _detail(post, expert.id, True)

    @router.patch("/{news_id}", response_model=NewsDetailRead)
    def update_article(news_id: int, payload: NewsUpdate, db: DbDep, expert: ExpertUser):
        post = _own_article(db, expert, news_id)
        fields = payload.model_fields_set
        raising = "importance" in fields and payload.importance == rules.IMPORTANT and post.importance != rules.IMPORTANT
        if raising:
            articles, important = _quota_counts(db, expert.id, _now())
            violation = rules.check_publish_quota(rules.IMPORTANT, 0, important)
            if violation:
                raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, violation.message)

        # Схема гарантує, що title/body/category/importance, якщо передані, не null
        if payload.title is not None:
            post.title = payload.title
        if payload.body is not None:
            post.body = payload.body
            post.summary = rules.make_summary(payload.body)
        if payload.category is not None:
            post.category = payload.category
        if payload.importance is not None:
            post.importance = payload.importance
        if "effective_date" in fields:
            post.effective_date = payload.effective_date
        if "source_url" in fields:
            post.source_url = payload.source_url

        if raising:  # стаття стала важливою — вікно має з'явитися знову всім, крім автора
            db.execute(delete(NewsRead).where(NewsRead.news_id == post.id, NewsRead.user_id != expert.id))
        db.commit()
        post = _own_article(db, expert, news_id)
        return _detail(post, expert.id, True)

    @router.delete("/{news_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_article(news_id: int, db: DbDep, expert: ExpertUser):
        post = _own_article(db, expert, news_id)
        db.execute(delete(NewsRead).where(NewsRead.news_id == post.id))
        db.delete(post)
        db.commit()

    return router
