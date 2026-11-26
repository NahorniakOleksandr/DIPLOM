"""
news_feeds.py — читання зовнішніх стрічок RSS 2.0 / RSS 1.0 (RDF) / Atom (без БД і без models).

    parse_feed(xml_bytes, now)   байти XML → список FeedItem (чиста функція, тестується на зразках)
    fetch_feed(url)              завантаження стрічки з обмеженнями (таймаут, розмір, лише http/https)
    parse_sources(raw)           NEWS_FEEDS з .env → список FeedSource

Джерела задаються в backend/.env рядком NEWS_FEEDS:
    NEWS_FEEDS=Назва стрічки|https://адреса-стрічки;Інша стрічка|https://адреса|all
Третє поле «all» вимикає відбір за ключовими словами (за замовчуванням стрічка фільтрується).

Безпека: XML із DOCTYPE/ENTITY відхиляється до розбору (захист від «billion laughs»), розмір відповіді
обмежений, перенаправлення на не-http(s) не виконуються, будь-який HTML у текстах прибирається.
"""
from __future__ import annotations

import hashlib
import re
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import news_rules as rules

MAX_FEED_BYTES = 2_000_000
FETCH_TIMEOUT_SECONDS = 12
USER_AGENT = "FopPlatformNewsBot/1.0 (+навчальний проєкт; читає публічні RSS-стрічки)"
MAX_TITLE = rules.TITLE_MAX
MAX_BODY = rules.BODY_MAX


class FeedError(Exception):
    """Стрічку не вдалося отримати або розібрати; повідомлення можна показувати користувачу."""


@dataclass(frozen=True)
class FeedItem:
    guid: str                 # стабільний ідентифікатор запису в межах стрічки
    title: str
    body: str                 # простий текст, без HTML
    link: Optional[str]
    published_at: datetime    # aware, UTC


@dataclass(frozen=True)
class FeedSource:
    name: str
    url: str
    filtered: bool = True     # відбирати за ключовими словами


# ---------- Налаштування джерел ----------
def parse_sources(raw: Optional[str]) -> list[FeedSource]:
    """Розбирає NEWS_FEEDS. Некоректний запис — FeedError із підказкою про формат (помилку конфігурації видно одразу)."""
    sources: list[FeedSource] = []
    seen: set[str] = set()
    for chunk in re.split(r"[;\n]+", raw or ""):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = [p.strip() for p in chunk.split("|")]
        if len(parts) < 2 or not parts[0] or not rules.valid_http_url(parts[1], max_len=500):
            raise FeedError(
                f"Некоректний запис у NEWS_FEEDS: «{chunk[:80]}». Формат: Назва|https://адреса[|all]"
            )
        url = parts[1]
        if url in seen:
            continue
        seen.add(url)
        sources.append(FeedSource(name=parts[0][:120], url=url, filtered=not (len(parts) > 2 and parts[2].lower() == "all")))
    return sources


# ---------- Завантаження ----------
class _HttpOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not rules.valid_http_url(newurl, max_len=2000):
            raise urllib.error.URLError("перенаправлення на небезпечну адресу відхилено")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_feed(url: str, timeout: int = FETCH_TIMEOUT_SECONDS, max_bytes: int = MAX_FEED_BYTES) -> bytes:
    if not rules.valid_http_url(url, max_len=2000):
        raise FeedError("Адреса стрічки має починатися з http:// або https://")
    request = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"},
    )
    opener = urllib.request.build_opener(_HttpOnlyRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            data = response.read(max_bytes + 1)
    except urllib.error.HTTPError as exc:
        raise FeedError(f"Сервер стрічки відповів помилкою {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise FeedError(f"Не вдалося з'єднатися зі стрічкою: {reason}") from exc
    if len(data) > max_bytes:
        raise FeedError("Стрічка завелика (понад 2 МБ), її пропущено")
    return data


# ---------- Розбір ----------
def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _children(node: ET.Element, name: str) -> list[ET.Element]:
    return [c for c in node if _local(c.tag) == name]


def _text(node: ET.Element, *names: str) -> str:
    for name in names:
        for child in _children(node, name):
            # Atom-контент може містити вкладений XHTML — збираємо весь текст
            value = "".join(child.itertext()).strip() if len(child) else (child.text or "").strip()
            if value:
                return value
    return ""


def _parse_date(raw: str) -> Optional[datetime]:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:  # RFC 822 (RSS)
        dt = parsedate_to_datetime(raw)
        if dt is not None:
            return rules.as_aware_utc(dt)
    except (TypeError, ValueError, IndexError):
        pass
    try:  # ISO 8601 (Atom, dc:date); «Z» → +00:00
        return rules.as_aware_utc(datetime.fromisoformat(raw.replace("Z", "+00:00")))
    except ValueError:
        return None


def _atom_link(entry: ET.Element) -> Optional[str]:
    links = _children(entry, "link")
    for link in links:  # перевага — rel="alternate" або без rel
        if link.get("rel") in (None, "", "alternate") and link.get("href"):
            return link.get("href")
    return links[0].get("href") if links and links[0].get("href") else None


def _reject_dtd(data: bytes) -> None:
    head = data[:4096].lower() + data[-512:].lower()
    if b"<!doctype" in head or b"<!entity" in data.lower():
        raise FeedError("Стрічку відхилено: XML із DOCTYPE/ENTITY небезпечний")


def parse_feed(data: bytes, now: Optional[datetime] = None) -> list[FeedItem]:
    """RSS 2.0 / RSS 1.0 / Atom → записи (новіші першими). Некоректні записи без заголовка пропускаються."""
    now = now or datetime.now(timezone.utc)
    if not data or not data.strip():
        raise FeedError("Порожня відповідь замість стрічки")
    _reject_dtd(data)
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise FeedError(f"Відповідь не є коректним XML ({exc})") from exc

    root_name = _local(root.tag)
    if root_name == "feed":
        entries = _children(root, "entry")
        is_atom = True
    elif root_name in ("rss", "RDF", "rdf"):
        # RSS 2.0: rss/channel/item; RSS 1.0: item — прямі нащадки кореня
        entries = [n for n in root.iter() if _local(n.tag) == "item"]
        is_atom = False
    else:
        raise FeedError("Це не RSS/Atom-стрічка (невідомий кореневий елемент)")

    items: list[FeedItem] = []
    for entry in entries:
        title = rules.clean_text(rules.strip_html(_text(entry, "title")))
        if not title:
            continue
        if is_atom:
            link = _atom_link(entry)
            raw_body = _text(entry, "content", "summary")
            published = _parse_date(_text(entry, "published", "updated"))
            guid = _text(entry, "id") or link or title
        else:
            link = _text(entry, "link") or None
            raw_body = _text(entry, "encoded", "description")
            published = _parse_date(_text(entry, "pubDate", "date", "published"))
            guid = _text(entry, "guid") or link or title
        link = link if rules.valid_http_url(link) else None
        body = rules.strip_html(raw_body)
        items.append(
            FeedItem(
                guid=guid[:1000],
                title=title[:MAX_TITLE],
                body=body[:MAX_BODY],
                link=link,
                published_at=published or now,
            )
        )
    items.sort(key=lambda i: i.published_at, reverse=True)
    return items


def external_id(feed_url: str, guid: str) -> str:
    """Стабільний короткий ключ запису (унікальний індекс у БД): sha1 від «адреса стрічки | guid»."""
    return hashlib.sha1(f"{feed_url}|{guid}".encode("utf-8")).hexdigest()
