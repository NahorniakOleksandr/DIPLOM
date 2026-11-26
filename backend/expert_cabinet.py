"""
expert_cabinet.py — ендпоінти кабінету спеціаліста (Етап 3). Усі потребують ролі expert.

    GET    /expert/dashboard                      лічильники, найближча консультація, чек-лист налаштування
    GET    /expert/consultations?scope=           заявки / майбутні / архів (scope: requests | upcoming | history | all)
    GET    /expert/consultations/{id}             картка: клієнт, параметри ФОПа, контекст ШІ, нотатки, підсумок, історія
    PATCH  /expert/consultations/{id}             посилання на зустріч, приватні нотатки, підсумок (часткове оновлення)
    PATCH  /expert/bookings/{id}/status           confirmed | rejected | completed (правила — у booking_rules.py)
    GET    /expert/clients                        клієнти (для чату й картки клієнта)
    GET    /expert/schedule, PUT /expert/schedule робочі вікна й тривалість консультації
    GET    /expert/profile, PATCH /expert/profile профіль і лічильники

Послуги (CRUD) лишаються в main.py: /expert/services. Чат — спільні /chat/*.

Принципи:
  * Приватність: спеціаліст бачить лише записи, де expert_id — він сам; email ФОПа не віддається;
    приватні нотатки (expert_notes) не потрапляють в жодну відповідь для ФОПа.
  * Переходи статусів атомарні: UPDATE ... WHERE status IN (дозволені) і перевірка rowcount.
  * Правила (які дії доступні в який момент) — єдине джерело в booking_rules.py; бекенд віддає
    прапорці can_confirm / can_reject / can_complete, а інтерфейс лише їх показує.
Автентифікація передається ззовні (як у ai_service.py і fop_cabinet.py), щоб не було циклічного імпорту main.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

import booking_rules as rules
import schemas
from database import get_db
from fop_cabinet import FREED_STATUSES, as_utc, ensure_expert_profile, load_schedule
from models import (
    Booking,
    BookingAiContext,
    BookingDetail,
    BookingStatus,
    ExpertAvailability,
    ExpertProfile,
    FopProfile,
    Message,
    Service,
    User,
    UserRole,
)
from scheduling import (
    DEFAULT_SLOT_MINUTES,
    KYIV,
    ScheduleError,
    count_outside,
    kyiv_today,
    validate_windows,
)

logger = logging.getLogger("fop_platform")

LIVE = [BookingStatus(v) for v in rules.LIVE]
ACTIVE = [BookingStatus.pending, *LIVE]  # займають слот і ще не завершені
SUMMARY_PREVIEW_CHARS = 160


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _statuses(values) -> list[BookingStatus]:
    return [BookingStatus(v) for v in values]


def _slot_minutes(db: Session, expert_id: int) -> int:
    profile = db.get(ExpertProfile, expert_id)
    return profile.slot_minutes if profile and profile.slot_minutes else DEFAULT_SLOT_MINUTES


def _own_booking(db: Session, expert: User, booking_id: int) -> Booking:
    booking = db.scalar(
        select(Booking)
        .where(Booking.id == booking_id, Booking.expert_id == expert.id)
        .options(selectinload(Booking.fop), selectinload(Booking.service))
    )
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Консультацію не знайдено")
    return booking


def _detail_for_write(db: Session, booking_id: int) -> BookingDetail:
    detail = db.get(BookingDetail, booking_id)
    if detail is None:
        detail = BookingDetail(booking_id=booking_id)
        db.add(detail)
    return detail


# =====================================================================
# Побудова відповідей
# =====================================================================
@dataclass
class _Lookup:
    """Пов'язані дані для пачки записів — завантажуються кількома запитами, а не по одному на запис."""

    now: datetime
    slot_minutes: int
    details: dict[int, BookingDetail] = field(default_factory=dict)
    ai: dict[int, BookingAiContext] = field(default_factory=dict)
    profiles: dict[int, FopProfile] = field(default_factory=dict)


def _load_lookup(db: Session, bookings: list[Booking], slot_minutes: int) -> _Lookup:
    lk = _Lookup(now=_now(), slot_minutes=slot_minutes)
    if not bookings:
        return lk
    ids = [b.id for b in bookings]
    fop_ids = list({b.fop_id for b in bookings})
    lk.details = {d.booking_id: d for d in db.scalars(select(BookingDetail).where(BookingDetail.booking_id.in_(ids)))}
    lk.ai = {c.booking_id: c for c in db.scalars(select(BookingAiContext).where(BookingAiContext.booking_id.in_(ids)))}
    lk.profiles = {p.user_id: p for p in db.scalars(select(FopProfile).where(FopProfile.user_id.in_(fop_ids)))}
    return lk


def _common_fields(b: Booking, lk: _Lookup) -> tuple[dict, rules.Actions]:
    start = as_utc(b.slot_datetime)
    end = start + timedelta(minutes=lk.slot_minutes)
    act = rules.allowed_actions(b.status, start, end, lk.now)
    detail = lk.details.get(b.id)
    profile = lk.profiles.get(b.fop_id)
    fields = dict(
        id=b.id,
        status=b.status,
        slot_datetime=start,
        slot_end=end,
        created_at=as_utc(b.created_at),
        client_id=b.fop_id,
        client_name=b.fop.full_name,
        client_profile=schemas.FopProfileRead.model_validate(profile) if profile else None,
        service_id=b.service_id,
        service_title=b.service.title,
        service_price=float(b.service.price),
        meeting_url=detail.meeting_url if detail else None,
        rejection_reason=detail.rejection_reason if detail else None,
        has_ai_summary=b.id in lk.ai,
        has_notes=bool(detail and detail.expert_notes),
        has_summary=bool(detail and detail.expert_summary),
        is_past=act.is_past,
        can_confirm=act.can_confirm,
        can_reject=act.can_reject,
        can_complete=act.can_complete,
    )
    return fields, act


def _read(b: Booking, lk: _Lookup) -> schemas.ExpertConsultationRead:
    fields, _ = _common_fields(b, lk)
    return schemas.ExpertConsultationRead(**fields)


def _preview(text: Optional[str]) -> Optional[str]:
    if not text:
        return None
    return text if len(text) <= SUMMARY_PREVIEW_CHARS else text[:SUMMARY_PREVIEW_CHARS].rstrip() + "…"


def _detail_read(db: Session, b: Booking, slot_minutes: int) -> schemas.ExpertConsultationDetail:
    lk = _load_lookup(db, [b], slot_minutes)
    fields, act = _common_fields(b, lk)
    detail = lk.details.get(b.id)
    ctx = lk.ai.get(b.id)

    previous = list(
        db.scalars(
            select(Booking)
            .where(Booking.expert_id == b.expert_id, Booking.fop_id == b.fop_id, Booking.id != b.id)
            .options(selectinload(Booking.service))
            .order_by(Booking.slot_datetime.desc(), Booking.id.desc())
            .limit(10)
        )
    )
    summaries: dict[int, Optional[str]] = {}
    if previous:
        summaries = {
            d.booking_id: d.expert_summary
            for d in db.scalars(select(BookingDetail).where(BookingDetail.booking_id.in_([p.id for p in previous])))
        }
    history = [
        schemas.ClientHistoryItem(
            id=p.id,
            slot_datetime=as_utc(p.slot_datetime),
            status=p.status,
            service_title=p.service.title,
            summary_preview=_preview(summaries.get(p.id)),
        )
        for p in previous
    ]
    return schemas.ExpertConsultationDetail(
        **fields,
        ai_summary=ctx.summary if ctx else None,
        ai_summary_created_at=as_utc(ctx.created_at) if ctx else None,
        expert_notes=detail.expert_notes if detail else None,
        expert_summary=detail.expert_summary if detail else None,
        can_edit_meeting=act.can_edit_meeting,
        can_write_summary=act.can_write_summary,
        history=history,
    )


def _future_active_slots(db: Session, expert_id: int, now: datetime) -> list[datetime]:
    rows = db.scalars(
        select(Booking.slot_datetime).where(
            Booking.expert_id == expert_id,
            Booking.status.in_(ACTIVE),
            Booking.slot_datetime > now,
        )
    ).all()
    return [as_utc(r) for r in rows]


def _schedule_read(db: Session, expert_id: int) -> schemas.ScheduleRead:
    windows, slot_minutes = load_schedule(db, expert_id)
    windows = sorted(windows, key=lambda w: (w[0], w[1], w[2]))
    outside = count_outside(_future_active_slots(db, expert_id, _now()), windows, slot_minutes)
    return schemas.ScheduleRead(
        slot_minutes=slot_minutes,
        timezone=str(KYIV),
        windows=[schemas.ScheduleWindow(weekday=wd, start=st, end=en) for wd, st, en in windows],
        outside_schedule_bookings=outside,
    )


def _profile_read(db: Session, expert: User) -> schemas.ExpertProfileRead:
    profile = db.get(ExpertProfile, expert.id)

    def count(*conds) -> int:
        return db.scalar(select(func.count(Booking.id)).where(Booking.expert_id == expert.id, *conds)) or 0

    return schemas.ExpertProfileRead(
        id=expert.id,
        email=expert.email,
        full_name=expert.full_name,
        specialization=profile.specialization if profile else None,
        headline=(profile.headline if profile else "") or "",
        bio=(profile.bio if profile else "") or "",
        experience_years=profile.experience_years if profile else None,
        slot_minutes=profile.slot_minutes if profile and profile.slot_minutes else DEFAULT_SLOT_MINUTES,
        services_count=db.scalar(select(func.count(Service.id)).where(Service.expert_id == expert.id)) or 0,
        completed_count=count(Booking.status == BookingStatus.completed),
        total_count=count(Booking.status.notin_(FREED_STATUSES)),
    )


# =====================================================================
# Роутер
# =====================================================================
def create_expert_cabinet_router(require_role) -> APIRouter:
    router = APIRouter(prefix="/expert", tags=["expert cabinet: stage 3"])
    expert_dep = require_role(UserRole.expert)

    # ---------- Огляд ----------
    @router.get("/dashboard", response_model=schemas.ExpertDashboardRead)
    def dashboard(db: Session = Depends(get_db), expert: User = Depends(expert_dep)):
        now = _now()
        today = kyiv_today(now)
        slot_minutes = _slot_minutes(db, expert.id)

        def count(*conds) -> int:
            return db.scalar(select(func.count(Booking.id)).where(Booking.expert_id == expert.id, *conds)) or 0

        # Межі «сьогодні» — за київським часом, у БД порівнюємо в UTC
        day_start = datetime.combine(today, time.min, tzinfo=KYIV).astimezone(timezone.utc)
        day_end = datetime.combine(today + timedelta(days=1), time.min, tzinfo=KYIV).astimezone(timezone.utc)

        upcoming = db.scalar(
            select(Booking)
            .where(
                Booking.expert_id == expert.id,
                Booking.status.in_(LIVE),
                Booking.slot_datetime > now - timedelta(minutes=slot_minutes),  # включно з тією, що триває
            )
            .options(selectinload(Booking.fop), selectinload(Booking.service))
            .order_by(Booking.slot_datetime, Booking.id)
            .limit(1)
        )
        next_consultation = _read(upcoming, _load_lookup(db, [upcoming], slot_minutes)) if upcoming else None

        windows, _ = load_schedule(db, expert.id)
        profile = db.get(ExpertProfile, expert.id)
        services_count = db.scalar(select(func.count(Service.id)).where(Service.expert_id == expert.id)) or 0

        return schemas.ExpertDashboardRead(
            today=today,
            pending_count=count(Booking.status == BookingStatus.pending),
            today_count=count(
                Booking.status.in_([*LIVE, BookingStatus.completed]),
                Booking.slot_datetime >= day_start,
                Booking.slot_datetime < day_end,
            ),
            upcoming_count=count(Booking.status.in_(LIVE), Booking.slot_datetime > now),
            to_complete_count=count(Booking.status.in_(LIVE), Booking.slot_datetime <= now),
            completed_count=count(Booking.status == BookingStatus.completed),
            clients_count=db.scalar(
                select(func.count(func.distinct(Booking.fop_id))).where(
                    Booking.expert_id == expert.id, Booking.status.notin_(FREED_STATUSES)
                )
            )
            or 0,
            next_consultation=next_consultation,
            setup=schemas.ExpertSetupRead(
                has_services=services_count > 0,
                has_schedule=bool(windows),
                has_profile_text=bool(profile and (profile.headline or "").strip() and (profile.bio or "").strip()),
            ),
        )

    # ---------- Список ----------
    @router.get("/consultations", response_model=list[schemas.ExpertConsultationRead])
    def list_consultations(
        scope: Literal["requests", "upcoming", "history", "all"] = Query(default="all"),
        status_filter: Optional[BookingStatus] = Query(default=None, alias="status"),
        limit: int = Query(default=100, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
        db: Session = Depends(get_db),
        expert: User = Depends(expert_dep),
    ):
        stmt = (
            select(Booking)
            .where(Booking.expert_id == expert.id)
            .options(selectinload(Booking.fop), selectinload(Booking.service))
        )
        scope_statuses = rules.SCOPES[scope]
        if scope_statuses is not None:
            stmt = stmt.where(Booking.status.in_(_statuses(scope_statuses)))
        if status_filter is not None:
            stmt = stmt.where(Booking.status == status_filter)
        # Нові заявки й майбутні — від найближчої; архів і «усе» — від найсвіжішої
        if scope in ("requests", "upcoming"):
            stmt = stmt.order_by(Booking.slot_datetime, Booking.id)
        else:
            stmt = stmt.order_by(Booking.slot_datetime.desc(), Booking.id.desc())
        bookings = list(db.scalars(stmt.limit(limit).offset(offset)))

        lk = _load_lookup(db, bookings, _slot_minutes(db, expert.id))
        return [_read(b, lk) for b in bookings]

    # ---------- Картка ----------
    @router.get("/consultations/{booking_id}", response_model=schemas.ExpertConsultationDetail)
    def get_consultation(booking_id: int, db: Session = Depends(get_db), expert: User = Depends(expert_dep)):
        booking = _own_booking(db, expert, booking_id)
        return _detail_read(db, booking, _slot_minutes(db, expert.id))

    @router.patch("/consultations/{booking_id}", response_model=schemas.ExpertConsultationDetail)
    def update_consultation(
        booking_id: int,
        payload: schemas.ConsultationUpdate,
        db: Session = Depends(get_db),
        expert: User = Depends(expert_dep),
    ):
        booking = _own_booking(db, expert, booking_id)
        slot_minutes = _slot_minutes(db, expert.id)
        start = as_utc(booking.slot_datetime)
        act = rules.allowed_actions(booking.status, start, start + timedelta(minutes=slot_minutes), _now())
        fields = payload.model_fields_set

        if "meeting_url" in fields and not act.can_edit_meeting:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Посилання можна змінювати лише для заявок і підтверджених консультацій, що ще не закінчились",
            )
        if "expert_summary" in fields and not act.can_write_summary:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Підсумок можна додати лише до підтвердженої або завершеної консультації"
            )

        detail = _detail_for_write(db, booking_id)
        if "meeting_url" in fields:
            detail.meeting_url = payload.meeting_url
        if "expert_notes" in fields:
            detail.expert_notes = rules.clean_text(payload.expert_notes)
        if "expert_summary" in fields:
            detail.expert_summary = rules.clean_text(payload.expert_summary)
        try:
            db.commit()
        except IntegrityError:  # гонка: паралельне створення BookingDetail
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "Не вдалося зберегти. Спробуйте ще раз.")
        db.refresh(booking)
        return _detail_read(db, booking, slot_minutes)

    # ---------- Зміна статусу ----------
    @router.patch("/bookings/{booking_id}/status", response_model=schemas.ExpertConsultationDetail)
    def update_booking_status(
        booking_id: int,
        payload: schemas.BookingStatusUpdate,
        db: Session = Depends(get_db),
        expert: User = Depends(expert_dep),
    ):
        """
        pending → confirmed (опційно meeting_url) | rejected (опційно reason);
        confirmed → rejected (reason обов'язковий, лише до початку) | completed (опційно summary, лише після початку).
        """
        booking = _own_booking(db, expert, booking_id)
        slot_minutes = _slot_minutes(db, expert.id)
        start = as_utc(booking.slot_datetime)
        violation = rules.check_transition(
            booking.status, payload.status, start, start + timedelta(minutes=slot_minutes), _now(), payload.reason
        )
        if violation is not None:
            raise HTTPException(violation.code, violation.message)

        # Атомарний перехід: UPDATE спрацює лише якщо статус досі дозволяє його (захист від подвійного кліку/гонки)
        result = db.execute(
            update(Booking)
            .where(
                Booking.id == booking_id,
                Booking.expert_id == expert.id,
                Booking.status.in_(_statuses(rules.ALLOWED_FROM[rules.status_str(payload.status)])),
            )
            .values(status=payload.status)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:  # type: ignore[attr-defined]
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "Статус запису щойно змінився. Оновіть сторінку.")

        target = rules.status_str(payload.status)
        changes: dict[str, Optional[str]] = {}
        if target == rules.CONFIRMED and payload.meeting_url:
            changes["meeting_url"] = payload.meeting_url
        elif target == rules.REJECTED:
            changes["rejection_reason"] = rules.clean_text(payload.reason)
        elif target == rules.COMPLETED and payload.summary is not None:
            changes["expert_summary"] = rules.clean_text(payload.summary)
        if changes:
            detail = _detail_for_write(db, booking_id)
            for name, value in changes.items():
                setattr(detail, name, value)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "Не вдалося зберегти зміну. Спробуйте ще раз.")

        db.refresh(booking)
        return _detail_read(db, booking, slot_minutes)

    # ---------- Клієнти ----------
    @router.get("/clients", response_model=list[schemas.ExpertClientRead])
    def list_clients(db: Session = Depends(get_db), expert: User = Depends(expert_dep)):
        """Клієнти спеціаліста: ті, хто записувався, і ті, хто писав у чат. Відповідає й за список чату."""
        now = _now()
        rows = db.execute(
            select(Booking.fop_id, Booking.status, Booking.slot_datetime).where(Booking.expert_id == expert.id)
        ).all()

        stats: dict[int, dict] = {}
        for fop_id, st, slot in rows:
            if st in FREED_STATUSES:
                continue  # відхилені й скасовані не роблять людину клієнтом
            entry = stats.setdefault(fop_id, {"total": 0, "completed": 0, "next": None, "last": None})
            entry["total"] += 1
            if st == BookingStatus.completed:
                entry["completed"] += 1
            slot = as_utc(slot)
            if slot > now:
                if st != BookingStatus.completed and (entry["next"] is None or slot < entry["next"]):
                    entry["next"] = slot
            elif entry["last"] is None or slot > entry["last"]:
                entry["last"] = slot

        peer_col = case((Message.sender_id == expert.id, Message.receiver_id), else_=Message.sender_id)
        last_messages = {
            r.peer_id: as_utc(r.last_at)
            for r in db.execute(
                select(peer_col.label("peer_id"), func.max(Message.created_at).label("last_at"))
                .where(or_(Message.sender_id == expert.id, Message.receiver_id == expert.id))
                .group_by("peer_id")
            ).all()
        }

        ids = set(stats) | set(last_messages)
        if not ids:
            return []
        users = {
            u.id: u for u in db.scalars(select(User).where(User.id.in_(list(ids)), User.role == UserRole.fop))
        }
        groups = {
            p.user_id: p.tax_group for p in db.scalars(select(FopProfile).where(FopProfile.user_id.in_(list(users))))
        }

        clients = []
        for uid, user in users.items():
            entry = stats.get(uid, {"total": 0, "completed": 0, "next": None, "last": None})
            clients.append(
                schemas.ExpertClientRead(
                    id=uid,
                    full_name=user.full_name,
                    tax_group=groups.get(uid),
                    consultations_total=entry["total"],
                    consultations_completed=entry["completed"],
                    next_slot_datetime=entry["next"],
                    last_slot_datetime=entry["last"],
                    last_message_at=last_messages.get(uid),
                )
            )

        def order(c: schemas.ExpertClientRead):
            # Спочатку з листуванням (найсвіжіші зверху), потім решта за алфавітом
            if c.last_message_at is None:
                return (1, 0.0, c.full_name.lower())
            return (0, -c.last_message_at.timestamp(), c.full_name.lower())

        clients.sort(key=order)
        return clients

    # ---------- Розклад ----------
    @router.get("/schedule", response_model=schemas.ScheduleRead)
    def get_schedule(db: Session = Depends(get_db), expert: User = Depends(expert_dep)):
        return _schedule_read(db, expert.id)

    @router.put("/schedule", response_model=schemas.ScheduleRead)
    def save_schedule(
        payload: schemas.ScheduleUpdate, db: Session = Depends(get_db), expert: User = Depends(expert_dep)
    ):
        """Повна заміна розкладу. Наявні записи не скасовуються, але ті, що випали з розкладу, лічаться окремо."""
        try:
            windows = validate_windows([(w.weekday, w.start, w.end) for w in payload.windows], payload.slot_minutes)
        except ScheduleError as exc:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

        profile = ensure_expert_profile(db, expert.id, None)
        if payload.slot_minutes != (profile.slot_minutes or DEFAULT_SLOT_MINUTES):
            # Кінець запису обчислюється з тривалості слота: зміна «з'їла» б межі вже створених записів
            pending = len(_future_active_slots(db, expert.id, _now()))
            if pending:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"Не можна змінити тривалість консультації, поки є майбутні записи ({pending}). "
                    "Спочатку проведіть або скасуйте їх.",
                )
        profile.slot_minutes = payload.slot_minutes

        db.execute(delete(ExpertAvailability).where(ExpertAvailability.expert_id == expert.id))
        db.add_all(
            ExpertAvailability(expert_id=expert.id, weekday=wd, start_time=st, end_time=en) for wd, st, en in windows
        )
        db.commit()
        return _schedule_read(db, expert.id)

    # ---------- Профіль ----------
    @router.get("/profile", response_model=schemas.ExpertProfileRead)
    def get_profile(db: Session = Depends(get_db), expert: User = Depends(expert_dep)):
        return _profile_read(db, expert)

    @router.patch("/profile", response_model=schemas.ExpertProfileRead)
    def update_profile(
        payload: schemas.ExpertProfileUpdate, db: Session = Depends(get_db), expert: User = Depends(expert_dep)
    ):
        fields = payload.model_fields_set
        profile = ensure_expert_profile(db, expert.id, payload.specialization)
        if "full_name" in fields and payload.full_name is not None:
            expert.full_name = payload.full_name
        if "specialization" in fields and payload.specialization is not None:
            profile.specialization = payload.specialization
        if "headline" in fields:
            profile.headline = payload.headline or ""
        if "bio" in fields:
            profile.bio = payload.bio or ""
        if "experience_years" in fields:
            profile.experience_years = payload.experience_years
        db.commit()
        db.refresh(expert)
        return _profile_read(db, expert)

    return router
