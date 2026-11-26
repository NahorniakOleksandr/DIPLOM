"""
tax_rules.py — правила для особистого трекера ліміту та податкового календаря ФОПа.

Модуль чистий (без БД і фреймворків), тому його легко тестувати. Це ДОВІДКОВІ орієнтири,
а не «звірка з ДПС»: платформа не інтегрована з державними сервісами.

Джерела правил (звірено станом на листопад 2026):
  * ліміти доходу — п. 291.4 ст. 291 ПКУ: 167 / 834 / 1167 мінімальних зарплат на 1 січня року;
  * ЄП I–II груп і ВЗ I–II груп — щомісяця до 20 числа (п. 295.1 ПКУ);
  * ЄП і ВЗ III групи — квартально, протягом 10 днів після граничного строку декларації
    (тобто через 50 днів після кінця кварталу);
  * декларація III групи — 40 днів після кварталу; I–II груп — 60 днів після року;
  * ЄСВ за себе — щокварталу до 19 числа місяця, наступного за кварталом
    (19-те, а не 20-те: так у календарях ДПС; якщо 19-те вихідне — зсув на понеділок).

Щороку оновлюйте MIN_WAGE_BY_YEAR (мінімальна зарплата на 1 січня).
Вихідні враховано (строк переноситься на найближчий понеділок), державні свята — ні.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

# Мінімальна зарплата станом на 1 січня відповідного року (грн)
MIN_WAGE_BY_YEAR: dict[int, int] = {
    2025: 8000,
    2026: 8647,
}

# Річний ліміт доходу = N мінімальних зарплат
LIMIT_MULTIPLIER: dict[int, int] = {1: 167, 2: 834, 3: 1167}

WARNING_PERCENT = 80.0   # з якого відсотка попереджаємо
SOON_DAYS = 7            # «Наближається», якщо лишилось ≤ 7 днів
STALE_OVERDUE_DAYS = 14  # невідмічені строки, що минули давніше, не показуємо: ми не знаємо, чи сплачено
HORIZON_DAYS = 150       # як далеко вперед показуємо строки

DISCLAIMER = (
    "Суми й строки — довідкові орієнтири на основі введених вами даних. "
    "Перед сплатою звірте їх з Електронним кабінетом платника ДПС."
)


# ----------------------------------------------------------------------------
# Ліміт доходу
# ----------------------------------------------------------------------------
@dataclass(frozen=True)
class LimitResult:
    group: Optional[int]
    year: int
    configured: bool          # чи відома мінімальна зарплата цього року
    min_wage: Optional[int]
    limit: Optional[int]
    used: Decimal
    remaining: Optional[Decimal]
    percent: Optional[float]
    status: str               # no_group | not_configured | ok | warning | exceeded
    message: str


def limit_amount(group: Optional[int], year: int) -> Optional[int]:
    wage = MIN_WAGE_BY_YEAR.get(year)
    mult = LIMIT_MULTIPLIER.get(group or 0)
    if wage is None or mult is None:
        return None
    return wage * mult


def compute_limit(group: Optional[int], year: int, used: Decimal) -> LimitResult:
    used = Decimal(used)
    wage = MIN_WAGE_BY_YEAR.get(year)

    if group not in LIMIT_MULTIPLIER:
        return LimitResult(group, year, wage is not None, wage, None, used, None, None, "no_group",
                           "Вкажіть групу єдиного податку в профілі, щоб побачити ліміт.")
    if wage is None:
        return LimitResult(group, year, False, None, None, used, None, None, "not_configured",
                           f"Ліміт на {year} рік ще не налаштований у системі (потрібна мінімальна зарплата на 1 січня).")

    limit = wage * LIMIT_MULTIPLIER[group]
    remaining = max(Decimal(limit) - used, Decimal(0))
    percent = round(float(used / Decimal(limit) * 100), 1)

    if used > limit:
        status, message = "exceeded", (
            "Ліміт перевищено. Це може вплинути на право застосовувати єдиний податок — "
            "зверніться до бухгалтера."
        )
    elif percent >= WARNING_PERCENT:
        status, message = "warning", (
            "Ви використали понад 80% ліміту. Заплануйте наперед і за потреби проконсультуйтеся з бухгалтером."
        )
    else:
        status, message = "ok", "Ви в межах річного ліміту"
    return LimitResult(group, year, True, wage, limit, used, remaining, percent, status, message)


# ----------------------------------------------------------------------------
# Податковий календар
# ----------------------------------------------------------------------------
@dataclass(frozen=True)
class Deadline:
    key: str
    kind: str                 # eu | vz | esv | decl | employees
    badge: str                # короткий підпис для плитки: ЄП / ВЗ / ЄСВ / Звіт / Штат
    title: str
    period: Optional[str]
    due_date: Optional[date]
    advice: Optional[str] = None
    suggest_specialist: bool = False


_ROMAN = {1: "I", 2: "II", 3: "III", 4: "IV"}
_MONTHS_NOM = [
    "січень", "лютий", "березень", "квітень", "травень", "червень",
    "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
]
_KIND_ORDER = {"eu": 0, "esv": 1, "vz": 2, "decl": 3, "employees": 4}


def shift_to_workday(d: date) -> date:
    """Якщо строк припадає на суботу/неділю — переносимо на понеділок (п. 49.18.4 ПКУ)."""
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def _quarter_end(year: int, q: int) -> date:
    return {1: date(year, 3, 31), 2: date(year, 6, 30), 3: date(year, 9, 30), 4: date(year, 12, 31)}[q]


def _esv_date(year: int, q: int) -> date:
    """ЄСВ за себе: 19 число місяця після кварталу (для IV кварталу — січня наступного року)."""
    if q == 4:
        return shift_to_workday(date(year + 1, 1, 19))
    return shift_to_workday(date(year, q * 3 + 1, 19))


def generate_deadlines(group: int, has_employees: bool, today: date) -> list[Deadline]:
    """Усі строки для групи за три календарні роки навколо сьогодні (для валідації та вибірки)."""
    items: list[Deadline] = []
    for year in (today.year - 1, today.year, today.year + 1):
        # ЄСВ за себе — для всіх груп щокварталу
        for q in range(1, 5):
            items.append(Deadline(
                key=f"esv-{year}Q{q}", kind="esv", badge="ЄСВ", title="ЄСВ за себе",
                period=f"{_ROMAN[q]} квартал {year}", due_date=_esv_date(year, q),
            ))

        if group in (1, 2):
            for month in range(1, 13):
                due = shift_to_workday(date(year, month, 20))
                period = f"{_MONTHS_NOM[month - 1]} {year}"
                items.append(Deadline(f"eu-{year}-{month:02d}", "eu", "ЄП", "Єдиний податок", period, due))
                items.append(Deadline(f"vz-{year}-{month:02d}", "vz", "ВЗ", "Військовий збір", period, due))
            items.append(Deadline(
                key=f"decl-{year}Y", kind="decl", badge="Звіт", title="Річна декларація платника ЄП",
                period=f"{year} рік", due_date=shift_to_workday(_quarter_end(year, 4) + timedelta(days=60)),
                advice="Не впевнені, як заповнити декларацію? Бухгалтер допоможе її підготувати.",
                suggest_specialist=True,
            ))
        else:  # група 3 — квартальний режим
            for q in range(1, 5):
                qend = _quarter_end(year, q)
                period = f"{_ROMAN[q]} квартал {year}"
                pay_due = shift_to_workday(qend + timedelta(days=50))  # 40 днів на декларацію + 10 днів на оплату
                items.append(Deadline(f"eu-{year}Q{q}", "eu", "ЄП", "Єдиний податок", period, pay_due))
                items.append(Deadline(f"vz-{year}Q{q}", "vz", "ВЗ", "Військовий збір (1%)", period, pay_due))
                items.append(Deadline(
                    key=f"decl-{year}Q{q}", kind="decl", badge="Звіт", title="Декларація платника ЄП",
                    period=period, due_date=shift_to_workday(qend + timedelta(days=40)),
                    advice="Не впевнені, як заповнити декларацію? Бухгалтер допоможе її підготувати.",
                    suggest_specialist=True,
                ))

    if has_employees:
        items.append(Deadline(
            key="employees", kind="employees", badge="Штат",
            title="Наймані працівники: ПДФО, ВЗ та ЄСВ", period=None, due_date=None,
            advice="Строки залежать від дати виплати зарплати та форми звітності — уточніть у бухгалтера.",
            suggest_specialist=True,
        ))
    return items


def deadline_status(d: Deadline, today: date, done: bool) -> str:
    if done:
        return "done"
    if d.due_date is None:
        return "verify"
    if d.due_date < today:
        return "overdue"
    if (d.due_date - today).days <= SOON_DAYS:
        return "soon"
    return "planned"


def valid_keys(group: int, has_employees: bool, today: date) -> set[str]:
    return {d.key for d in generate_deadlines(group, has_employees, today)}


def upcoming_deadlines(
    group: Optional[int], has_employees: bool, today: date, done_keys: set[str]
) -> list[tuple[Deadline, str, Optional[int], bool]]:
    """
    Найближчий невиконаний строк кожного виду (ЄП, ЄСВ, ВЗ, звітність) + пункт про працівників.
    Повертає (deadline, status, days_left, done).
    """
    if group not in LIMIT_MULTIPLIER:
        return []

    lowest = today - timedelta(days=STALE_OVERDUE_DAYS)
    highest = today + timedelta(days=HORIZON_DAYS)

    nearest: dict[str, Deadline] = {}
    for d in sorted(generate_deadlines(group, has_employees, today), key=lambda x: (x.due_date or date.max)):
        if d.key in done_keys and d.due_date is not None:
            continue  # виконані пропускаємо — показуємо наступний строк цього виду
        if d.due_date is not None and not (lowest <= d.due_date <= highest):
            continue
        nearest.setdefault(d.kind, d)

    result = []
    for d in nearest.values():
        done = d.key in done_keys
        days_left = (d.due_date - today).days if d.due_date else None
        result.append((d, deadline_status(d, today, done), days_left, done))
    result.sort(key=lambda r: (r[0].due_date or date.max, _KIND_ORDER[r[0].kind]))
    return result
