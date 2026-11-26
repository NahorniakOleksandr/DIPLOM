"""
fop_cabinet.py — ендпоінти кабінету ФОПа (Етап 2), що доповнюють /fop/* з main.py:

    GET    /fop/dashboard                  ліміт доходу + найближчі податкові строки
    GET    /fop/income?year=               надходження за рік
    POST   /fop/income                     додати надходження
    DELETE /fop/income/{id}                видалити надходження
    PUT    /fop/deadlines/{key}            позначити строк виконаним / зняти позначку
    GET    /fop/experts/{id}/slots         вільні слоти спеціаліста
    GET    /fop/consultations              мої записи зі статусами, посиланням на зустріч тощо
    POST   /fop/bookings/{id}/cancel       скасувати запис

Також тут живуть допоміжні функції розкладу, якими користується main.py (create_booking).
Автентифікація передається ззовні (як у ai_service.py), щоб не було циклічного імпорту main.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

import schemas
import tax_rules
from database import get_db
from models import (
    Booking,
    BookingAiContext,
    BookingDetail,
    BookingStatus,
    DeadlineCompletion,
    ExpertAvailability,
    ExpertProfile,
    FopProfile,
    IncomeEntry,
    Specialization,
    User,
    UserRole,
)
from scheduling import (
    DEFAULT_SLOT_MINUTES,
    DEFAULT_WINDOWS,
    KYIV,
    MAX_DAYS_AHEAD,
    Window,
    generate_slots,
    kyiv_today,
)

logger = logging.getLogger("fop_platform")

# Статуси, що звільняють слот для інших ФОПів
FREED_STATUSES = (BookingStatus.rejected, BookingStatus.cancelled)


def as_utc(dt: datetime) -> datetime:
    """SQLite повертає naive-datetime (UTC) — приводимо до aware."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


# =====================================================================
# Розклад спеціаліста (БД)
# =====================================================================
def load_schedule(db: Session, expert_id: int) -> tuple[list[Window], int]:
    rows = db.scalars(select(ExpertAvailability).where(ExpertAvailability.expert_id == expert_id)).all()
    profile = db.get(ExpertProfile, expert_id)
    slot_minutes = profile.slot_minutes if profile and profile.slot_minutes else DEFAULT_SLOT_MINUTES
    return [(r.weekday, r.start_time, r.end_time) for r in rows], slot_minutes


def busy_slots(db: Session, expert_id: int, since: datetime) -> set[datetime]:
    rows = db.scalars(
        select(Booking.slot_datetime).where(
            Booking.expert_id == expert_id,
            Booking.slot_datetime >= since,
            Booking.status.notin_(FREED_STATUSES),
        )
    ).all()
    return {as_utc(dt).replace(second=0, microsecond=0) for dt in rows}


def infer_specialization(service_titles: list[str]) -> Optional[Specialization]:
    """Для спеціалістів, створених до Етапу 2: визначаємо за назвами послуг."""
    text = " ".join(service_titles).lower()
    if "юрист" in text:
        return Specialization.lawyer
    if "бухгалтер" in text:
        return Specialization.accountant
    return None


def ensure_expert_profile(db: Session, user_id: int, specialization: Optional[Specialization]) -> ExpertProfile:
    """
    Створює профіль спеціаліста та типовий розклад (Пн–Пт 10:00–17:00, слот 60 хв) — один раз,
    разом із профілем. Розклад потім редагується спеціалістом. Без commit.
    """
    profile = db.get(ExpertProfile, user_id)
    if profile is not None:
        return profile
    profile = ExpertProfile(user_id=user_id, specialization=specialization, slot_minutes=DEFAULT_SLOT_MINUTES)
    db.add(profile)
    db.add_all(
        ExpertAvailability(expert_id=user_id, weekday=wd, start_time=start, end_time=end)
        for wd, start, end in DEFAULT_WINDOWS
    )
    return profile


def backfill_expert_profiles(db: Session) -> int:
    """Старт застосунку: профілі та розклад для спеціалістів, створених до Етапу 2."""
    experts = db.scalars(
        select(User)
        .where(User.role == UserRole.expert)
        .options(selectinload(User.services), selectinload(User.expert_profile))
    ).all()
    created = 0
    for expert in experts:
        if expert.expert_profile is None:
            ensure_expert_profile(db, expert.id, infer_specialization([s.title for s in expert.services]))
            created += 1
    if created:
        db.commit()
        logger.info("Етап 2: створено профіль і типовий розклад для %d спеціалістів", created)
    return created


# =====================================================================
# Допоміжне
# =====================================================================
def _income_total(db: Session, user_id: int, year: int) -> Decimal:
    value = db.scalar(
        select(func.coalesce(func.sum(IncomeEntry.amount), 0)).where(
            IncomeEntry.user_id == user_id,
            IncomeEntry.received_on >= date(year, 1, 1),
            IncomeEntry.received_on <= date(year, 12, 31),
        )
    )
    return Decimal(str(value or 0))


def _income_read(e: IncomeEntry) -> schemas.IncomeRead:
    return schemas.IncomeRead(
        id=e.id, amount=float(e.amount), received_on=e.received_on, note=e.note or "",
        created_at=as_utc(e.created_at),
    )


def _profile_read(profile: Optional[FopProfile]) -> schemas.FopProfileRead:
    return schemas.FopProfileRead.model_validate(profile) if profile else schemas.FopProfileRead()


# =====================================================================
# Роутер
# =====================================================================
def create_fop_cabinet_router(get_current_user, require_role) -> APIRouter:
    router = APIRouter(prefix="/fop", tags=["fop cabinet: stage 2"])
    fop_dep = require_role(UserRole.fop)

    # ---------- Дашборд ----------
    @router.get("/dashboard", response_model=schemas.DashboardRead)
    def dashboard(db: Session = Depends(get_db), fop: User = Depends(fop_dep)):
        today = kyiv_today()
        profile = db.get(FopProfile, fop.id)
        group = profile.tax_group if profile else None
        has_employees = bool(profile.has_employees) if profile else False

        limit = tax_rules.compute_limit(group, today.year, _income_total(db, fop.id, today.year))
        done_keys = set(
            db.scalars(select(DeadlineCompletion.deadline_key).where(DeadlineCompletion.user_id == fop.id))
        )
        deadlines = [
            schemas.DeadlineRead(
                key=d.key, kind=d.kind, badge=d.badge, title=d.title, period=d.period,
                due_date=d.due_date, days_left=days_left, status=st, done=done,
                advice=d.advice, suggest_specialist=d.suggest_specialist,
            )
            for d, st, days_left, done in tax_rules.upcoming_deadlines(group, has_employees, today, done_keys)
        ]
        return schemas.DashboardRead(
            today=today,
            year=today.year,
            profile=_profile_read(profile),
            profile_complete=bool(profile and profile.tax_group and profile.tax_rate is not None and profile.kveds),
            limit=schemas.LimitRead(
                group=limit.group, year=limit.year, configured=limit.configured, min_wage=limit.min_wage,
                limit=limit.limit, used=float(limit.used),
                remaining=float(limit.remaining) if limit.remaining is not None else None,
                percent=limit.percent, status=limit.status, message=limit.message,
            ),
            deadlines=deadlines,
            disclaimer=tax_rules.DISCLAIMER,
        )

    # ---------- Доходи ----------
    @router.get("/income", response_model=schemas.IncomeListRead)
    def list_income(
        year: Optional[int] = Query(default=None, ge=2000, le=2100),
        db: Session = Depends(get_db),
        fop: User = Depends(fop_dep),
    ):
        year = year or kyiv_today().year
        rows = db.scalars(
            select(IncomeEntry)
            .where(
                IncomeEntry.user_id == fop.id,
                IncomeEntry.received_on >= date(year, 1, 1),
                IncomeEntry.received_on <= date(year, 12, 31),
            )
            .order_by(IncomeEntry.received_on.desc(), IncomeEntry.id.desc())
        ).all()
        return schemas.IncomeListRead(
            year=year,
            total=float(_income_total(db, fop.id, year)),
            count=len(rows),
            entries=[_income_read(r) for r in rows],
        )

    @router.post("/income", response_model=schemas.IncomeRead, status_code=status.HTTP_201_CREATED)
    def add_income(payload: schemas.IncomeCreate, db: Session = Depends(get_db), fop: User = Depends(fop_dep)):
        if payload.received_on > kyiv_today():
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Дата надходження не може бути в майбутньому")
        if payload.received_on.year < 2000:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Некоректна дата надходження")
        entry = IncomeEntry(
            user_id=fop.id, amount=payload.amount, received_on=payload.received_on, note=payload.note.strip()
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)
        return _income_read(entry)

    @router.delete("/income/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_income(entry_id: int, db: Session = Depends(get_db), fop: User = Depends(fop_dep)) -> Response:
        result = db.execute(delete(IncomeEntry).where(IncomeEntry.id == entry_id, IncomeEntry.user_id == fop.id))
        if result.rowcount != 1:  # type: ignore[attr-defined]
            db.rollback()
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Запис про дохід не знайдено")
        db.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    # ---------- Строки ----------
    @router.put("/deadlines/{key}", response_model=schemas.DeadlineDoneUpdate)
    def set_deadline_done(
        key: str,
        payload: schemas.DeadlineDoneUpdate,
        db: Session = Depends(get_db),
        fop: User = Depends(fop_dep),
    ):
        profile = db.get(FopProfile, fop.id)
        if profile is None or profile.tax_group is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Спершу вкажіть групу єдиного податку в профілі")
        # Приймаємо лише ключі, які справді існують у календарі цього ФОПа
        if key not in tax_rules.valid_keys(profile.tax_group, bool(profile.has_employees), kyiv_today()):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Такого строку немає у вашому календарі")

        if payload.done:
            exists = db.scalar(
                select(DeadlineCompletion.id).where(
                    DeadlineCompletion.user_id == fop.id, DeadlineCompletion.deadline_key == key
                )
            )
            if exists is None:
                db.add(DeadlineCompletion(user_id=fop.id, deadline_key=key))
                try:
                    db.commit()
                except IntegrityError:  # паралельний клік — вже збережено
                    db.rollback()
        else:
            db.execute(
                delete(DeadlineCompletion).where(
                    DeadlineCompletion.user_id == fop.id, DeadlineCompletion.deadline_key == key
                )
            )
            db.commit()
        return schemas.DeadlineDoneUpdate(done=payload.done)

    # ---------- Вільні слоти ----------
    @router.get("/experts/{expert_id}/slots", response_model=schemas.SlotsRead)
    def expert_slots(
        expert_id: int,
        days: int = Query(default=14, ge=1, le=MAX_DAYS_AHEAD),
        db: Session = Depends(get_db),
        fop: User = Depends(fop_dep),
    ):
        expert = db.scalar(select(User.id).where(User.id == expert_id, User.role == UserRole.expert))
        if expert is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Спеціаліста не знайдено")
        windows, slot_minutes = load_schedule(db, expert_id)
        now = datetime.now(timezone.utc)
        slots = generate_slots(
            windows, slot_minutes, now_utc=now, days=days, busy=busy_slots(db, expert_id, now)
        )
        step = timedelta(minutes=slot_minutes)
        return schemas.SlotsRead(
            expert_id=expert_id,
            slot_minutes=slot_minutes,
            timezone=str(KYIV),
            slots=[schemas.SlotRead(start=s, end=s + step) for s in slots],
        )

    # ---------- Мої консультації ----------
    @router.get("/consultations", response_model=list[schemas.BookingDetailRead])
    def my_consultations(
        status_filter: Optional[BookingStatus] = Query(default=None, alias="status"),
        limit: int = Query(default=100, ge=1, le=200),
        db: Session = Depends(get_db),
        fop: User = Depends(fop_dep),
    ):
        stmt = (
            select(Booking)
            .where(Booking.fop_id == fop.id)
            .options(selectinload(Booking.expert), selectinload(Booking.service))
            .order_by(Booking.slot_datetime.desc(), Booking.id.desc())
            .limit(limit)
        )
        if status_filter is not None:
            stmt = stmt.where(Booking.status == status_filter)
        bookings = list(db.scalars(stmt))
        if not bookings:
            return []

        ids = [b.id for b in bookings]
        expert_ids = {b.expert_id for b in bookings}
        details = {d.booking_id: d for d in db.scalars(select(BookingDetail).where(BookingDetail.booking_id.in_(ids)))}
        with_ai = set(db.scalars(select(BookingAiContext.booking_id).where(BookingAiContext.booking_id.in_(ids))))
        profiles = {p.user_id: p for p in db.scalars(select(ExpertProfile).where(ExpertProfile.user_id.in_(expert_ids)))}

        result = []
        for b in bookings:
            profile = profiles.get(b.expert_id)
            detail = details.get(b.id)
            start = as_utc(b.slot_datetime)
            minutes = profile.slot_minutes if profile and profile.slot_minutes else DEFAULT_SLOT_MINUTES
            result.append(
                schemas.BookingDetailRead(
                    id=b.id, status=b.status, slot_datetime=start, slot_end=start + timedelta(minutes=minutes),
                    created_at=as_utc(b.created_at), expert_id=b.expert_id, expert_name=b.expert.full_name,
                    expert_specialization=profile.specialization if profile else None,
                    service_id=b.service_id, service_title=b.service.title, service_price=float(b.service.price),
                    meeting_url=detail.meeting_url if detail else None,
                    rejection_reason=detail.rejection_reason if detail else None,
                    expert_summary=detail.expert_summary if detail else None,
                    has_ai_summary=b.id in with_ai,
                )
            )
        return result

    @router.post("/bookings/{booking_id}/cancel", response_model=schemas.BookingRead)
    def cancel_booking(booking_id: int, db: Session = Depends(get_db), fop: User = Depends(fop_dep)):
        booking = db.scalar(select(Booking).where(Booking.id == booking_id, Booking.fop_id == fop.id))
        if booking is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Запис не знайдено")
        if booking.status != BookingStatus.pending and as_utc(booking.slot_datetime) <= datetime.now(timezone.utc):
            raise HTTPException(status.HTTP_409_CONFLICT, "Консультація вже розпочалась або минула")

        # Атомарний перехід: спрацює лише якщо статус досі дозволяє скасування
        result = db.execute(
            update(Booking)
            .where(
                Booking.id == booking_id,
                Booking.status.in_((BookingStatus.pending, BookingStatus.confirmed, BookingStatus.paid)),
            )
            .values(status=BookingStatus.cancelled)
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:  # type: ignore[attr-defined]
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "Цей запис уже не можна скасувати")
        db.commit()
        db.refresh(booking)
        return booking

    return router
