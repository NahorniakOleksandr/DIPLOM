"""
scheduling.py — вільні слоти консультацій за робочими годинами спеціаліста.

Розклад задається у місцевому часі (Europe/Kyiv): «Пн–Пт 10:00–17:00». Слоти повертаються в UTC,
у такому ж вигляді зберігаються в bookings.slot_datetime. Модуль чистий (без БД).

На Windows для zoneinfo потрібен пакет tzdata (є в requirements.txt).
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

KYIV = ZoneInfo("Europe/Kyiv")

MIN_NOTICE_MINUTES = 60          # записатися можна щонайменше за годину
DEFAULT_SLOT_MINUTES = 60
MAX_DAYS_AHEAD = 60

# (день тижня 0=Пн…6=Нд, початок, кінець) — у київському часі
Window = tuple[int, time, time]

DEFAULT_WINDOWS: list[Window] = [(wd, time(10, 0), time(17, 0)) for wd in range(5)]

WEEKDAY_NAMES = ("понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота", "неділя")
MAX_WINDOWS_PER_DAY = 6
MIN_SLOT_MINUTES = 15
MAX_SLOT_MINUTES = 240


class ScheduleError(ValueError):
    """Некоректний розклад; текст готовий для показу користувачу."""


def kyiv_today(now_utc: Optional[datetime] = None) -> date:
    now_utc = now_utc or datetime.now(timezone.utc)
    return now_utc.astimezone(KYIV).date()


def _to_utc_minute(local_naive: datetime) -> datetime:
    return local_naive.replace(tzinfo=KYIV).astimezone(timezone.utc).replace(second=0, microsecond=0)


def generate_slots(
    windows: Iterable[Window],
    slot_minutes: int,
    *,
    now_utc: datetime,
    days: int,
    busy: set[datetime],
) -> list[datetime]:
    """Вільні слоти на найближчі `days` днів (UTC, відсортовані). Зайняті та надто близькі — виключені."""
    windows = list(windows)
    earliest = now_utc + timedelta(minutes=MIN_NOTICE_MINUTES)
    start_day = kyiv_today(now_utc)
    step = timedelta(minutes=slot_minutes)
    slots: set[datetime] = set()

    for offset in range(max(days, 0)):
        day = start_day + timedelta(days=offset)
        for weekday, start, end in windows:
            if weekday != day.weekday():
                continue
            cursor = datetime.combine(day, start)      # «наївний» місцевий час: крок без DST-пасток
            limit = datetime.combine(day, end)
            while cursor + step <= limit:
                slot = _to_utc_minute(cursor)
                if slot >= earliest and slot not in busy:
                    slots.add(slot)
                cursor += step
    return sorted(slots)


def is_valid_slot(slot_utc: datetime, windows: Iterable[Window], slot_minutes: int) -> bool:
    """Чи є час початком одного зі слотів розкладу (а не довільною хвилиною)."""
    local = slot_utc.astimezone(KYIV)
    if local.second or local.microsecond:
        return False
    minute = local.hour * 60 + local.minute
    for weekday, start, end in windows:
        if weekday != local.weekday():
            continue
        start_m = start.hour * 60 + start.minute
        end_m = end.hour * 60 + end.minute
        if start_m <= minute and minute + slot_minutes <= end_m and (minute - start_m) % slot_minutes == 0:
            return True
    return False


# =====================================================================
# Редагування розкладу
# =====================================================================
def _minutes(t: time) -> int:
    return t.hour * 60 + t.minute


def validate_windows(windows: Iterable[Window], slot_minutes: int) -> list[Window]:
    """
    Перевіряє робочі вікна й повертає їх відсортованими (день, початок).
    Правила: хвилинна точність; кінець пізніше за початок; вікно вміщає хоча б одну консультацію;
    вікна одного дня не перетинаються; не більше MAX_WINDOWS_PER_DAY вікон на день.
    Порожній розклад дозволено — це «не приймаю записи».
    """
    if not MIN_SLOT_MINUTES <= slot_minutes <= MAX_SLOT_MINUTES:
        raise ScheduleError(f"Тривалість консультації має бути від {MIN_SLOT_MINUTES} до {MAX_SLOT_MINUTES} хвилин")

    items: list[Window] = []
    for weekday, start, end in windows:
        if not 0 <= weekday <= 6:
            raise ScheduleError("Некоректний день тижня")
        day = WEEKDAY_NAMES[weekday].capitalize()
        if start.second or start.microsecond or end.second or end.microsecond:
            raise ScheduleError(f"{day}: час задається з точністю до хвилини")
        if _minutes(end) <= _minutes(start):
            raise ScheduleError(f"{day}: кінець вікна ({end:%H:%M}) має бути пізніше за початок ({start:%H:%M})")
        if _minutes(end) - _minutes(start) < slot_minutes:
            raise ScheduleError(
                f"{day}: вікно {start:%H:%M}–{end:%H:%M} коротше за одну консультацію ({slot_minutes} хв)"
            )
        items.append((weekday, start, end))

    items.sort(key=lambda w: (w[0], _minutes(w[1]), _minutes(w[2])))

    per_day: dict[int, int] = {}
    latest_end: dict[int, tuple[int, time]] = {}  # день → (кінець у хвилинах, кінець)
    for weekday, start, end in items:
        day = WEEKDAY_NAMES[weekday].capitalize()
        per_day[weekday] = per_day.get(weekday, 0) + 1
        if per_day[weekday] > MAX_WINDOWS_PER_DAY:
            raise ScheduleError(f"{day}: не більше {MAX_WINDOWS_PER_DAY} вікон на день")
        prev = latest_end.get(weekday)
        if prev is not None and _minutes(start) < prev[0]:
            raise ScheduleError(f"{day}: вікна перетинаються (до {prev[1]:%H:%M} і з {start:%H:%M})")
        if prev is None or _minutes(end) > prev[0]:
            latest_end[weekday] = (_minutes(end), end)
    return items


def count_outside(slots_utc: Iterable[datetime], windows: Iterable[Window], slot_minutes: int) -> int:
    """Скільки з наведених початків консультацій не збігаються зі слотами розкладу (напр., після його зміни)."""
    windows = list(windows)
    return sum(1 for slot in slots_utc if not is_valid_slot(slot, windows, slot_minutes))
