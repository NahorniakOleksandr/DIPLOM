"""
booking_rules.py — правила життєвого циклу консультації з боку спеціаліста (чисті функції, без БД).

Дозволені переходи:
    pending   → confirmed   підтвердження нової заявки (до початку консультації)
    pending   → rejected    відхилення нової заявки
    confirmed → rejected    скасування спеціалістом ДО початку; причина обов'язкова — клієнт її побачить
    confirmed → completed   завершення (лише після початку консультації)
Статус «paid» лишився від старого ендпоінта оплати й поводиться так само, як «confirmed».

Модуль не імпортує models: статуси порівнюються як рядки (BookingStatus — str-enum), тому
правила можна перевіряти без SQLAlchemy. Єдине джерело істини: бекенд віддає фронтенду готові
прапорці can_confirm / can_reject / can_complete, а не змушує інтерфейс повторювати правила.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

PENDING = "pending"
CONFIRMED = "confirmed"
PAID = "paid"
COMPLETED = "completed"
REJECTED = "rejected"
CANCELLED = "cancelled"

# «Живі» консультації: підтверджені, але ще не завершені
LIVE = (CONFIRMED, PAID)

# Розділи списку консультацій у кабінеті фахівця
SCOPES: dict[str, Optional[tuple[str, ...]]] = {
    "requests": (PENDING,),                       # нові заявки
    "upcoming": LIVE,                             # підтверджені (майбутні й ті, що чекають завершення)
    "history": (COMPLETED, REJECTED, CANCELLED),  # архів
    "all": None,
}

# Статуси, які може встановити спеціаліст, і ті, з яких це дозволено
SETTABLE = (CONFIRMED, REJECTED, COMPLETED)
ALLOWED_FROM: dict[str, tuple[str, ...]] = {
    CONFIRMED: (PENDING,),
    REJECTED: (PENDING, CONFIRMED, PAID),
    COMPLETED: (CONFIRMED, PAID),
}

STATUS_LABEL = {
    PENDING: "очікує підтвердження",
    CONFIRMED: "підтверджено",
    PAID: "оплачено",
    COMPLETED: "завершено",
    REJECTED: "відхилено",
    CANCELLED: "скасовано",
}


def status_str(status) -> str:
    """BookingStatus.pending → 'pending'; рядок лишається рядком."""
    return str(getattr(status, "value", status))


@dataclass(frozen=True)
class Actions:
    """Що можна робити із записом просто зараз."""

    is_past: bool            # консультація вже закінчилась
    can_confirm: bool
    can_reject: bool
    can_complete: bool
    can_edit_meeting: bool   # змінити посилання на зустріч
    can_write_summary: bool  # писати підсумок для клієнта


def allowed_actions(status, slot_start: datetime, slot_end: datetime, now: datetime) -> Actions:
    st = status_str(status)
    started = slot_start <= now
    live = st in LIVE
    return Actions(
        is_past=slot_end <= now,
        can_confirm=st == PENDING and not started,
        # Відхилити нову заявку можна завжди (щоб прибрати прострочену); підтверджену — лише до початку
        can_reject=st == PENDING or (live and not started),
        can_complete=live and started,
        can_edit_meeting=(st == PENDING or live) and slot_end > now,
        can_write_summary=live or st == COMPLETED,
    )


@dataclass(frozen=True)
class Violation:
    """Порушення правила: HTTP-код і готове повідомлення українською."""

    code: int
    message: str


def check_transition(
    status,
    target,
    slot_start: datetime,
    slot_end: datetime,
    now: datetime,
    reason: Optional[str] = None,
) -> Optional[Violation]:
    """None — перехід дозволено; інакше Violation. Усі дати — aware UTC."""
    cur, tgt = status_str(status), status_str(target)
    if tgt not in SETTABLE:
        return Violation(400, "Спеціаліст може встановити лише статуси: confirmed, rejected, completed")

    label = STATUS_LABEL.get(cur, cur)
    act = allowed_actions(cur, slot_start, slot_end, now)

    if tgt == CONFIRMED:
        if cur != PENDING:
            return Violation(409, f"Підтвердити можна лише нову заявку, а цей запис — «{label}»")
        if not act.can_confirm:
            return Violation(409, "Час консультації вже розпочався або минув — заявку можна лише відхилити")
    elif tgt == REJECTED:
        if cur not in ALLOWED_FROM[REJECTED]:
            return Violation(409, f"Відхилити неможливо: запис уже «{label}»")
        if not act.can_reject:
            return Violation(409, "Консультація вже розпочалась — завершіть її замість скасування")
        if cur in LIVE and not (reason or "").strip():
            return Violation(422, "Вкажіть причину скасування — клієнт побачить її")
    else:  # COMPLETED
        if cur not in ALLOWED_FROM[COMPLETED]:
            return Violation(409, f"Завершити можна лише підтверджену консультацію, а цей запис — «{label}»")
        if not act.can_complete:
            return Violation(409, "Консультація ще не розпочалась — завершити її можна після початку")
    return None


def clean_text(value: Optional[str]) -> Optional[str]:
    """Обрізає пробіли; порожній рядок → None (щоб «очистити» поле в БД)."""
    text = (value or "").strip()
    return text or None
