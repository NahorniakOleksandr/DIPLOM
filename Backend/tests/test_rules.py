import sys; import os; sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from datetime import date, datetime, timezone, time
from decimal import Decimal
import tax_rules as t, scheduling as s

n = 0
def ck(name, cond, extra=""):
    global n
    print(("OK   " if cond else "FAIL ") + name, extra if not cond else "")
    assert cond, name
    n += 1

# --- ліміти 2026 (звірено з джерелами: 1 444 049 / 7 211 598 / 10 091 049) ---
ck("ліміт 1 гр 2026", t.limit_amount(1, 2026) == 1_444_049)
ck("ліміт 2 гр 2026", t.limit_amount(2, 2026) == 7_211_598)
ck("ліміт 3 гр 2026", t.limit_amount(3, 2026) == 10_091_049)
r = t.compute_limit(3, 2026, Decimal("4120000"))
ck("ліміт ok: % і залишок", r.status == "ok" and r.percent == 40.8 and r.remaining == Decimal(10091049 - 4120000), (r.percent, r.remaining))
ck("warning ≥80%", t.compute_limit(3, 2026, Decimal("8200000")).status == "warning")
ck("рівно межа — не exceeded", t.compute_limit(2, 2026, Decimal(7211598)).status == "warning")
r = t.compute_limit(2, 2026, Decimal("7211598.01")); ck("+1 коп → exceeded, залишок 0", r.status == "exceeded" and r.remaining == 0)
ck("без групи", t.compute_limit(None, 2026, Decimal(0)).status == "no_group")
ck("рік без МЗП", t.compute_limit(3, 2027, Decimal(0)).status == "not_configured")

# --- календар: відомі дати 2026 ---
def find(g, key, emp=False): return next(d for d in t.generate_deadlines(g, emp, date(2026, 11, 26)) if d.key == key)
ck("ЄСВ Q3-2026 → 19.10", find(3, "esv-2026Q3").due_date == date(2026, 10, 19))
ck("ЄСВ Q1-2026 → 20.04 (19.04 — неділя)", find(3, "esv-2026Q1").due_date == date(2026, 4, 20))
ck("ЄСВ Q4-2026 → 19.01.2027", find(3, "esv-2026Q4").due_date == date(2027, 1, 19))
ck("декларація Q3-2026 → 09.11", find(3, "decl-2026Q3").due_date == date(2026, 11, 9))
ck("декларація Q1-2026 → 11.05", find(3, "decl-2026Q1").due_date == date(2026, 5, 11))
ck("ЄП 3 гр Q3-2026 → 19.11", find(3, "eu-2026Q3").due_date == date(2026, 11, 19))
ck("ЄП 3 гр Q1-2026 → 20.05", find(3, "eu-2026Q1").due_date == date(2026, 5, 20))
ck("ВЗ 3 гр = ЄП", find(3, "vz-2026Q3").due_date == date(2026, 11, 19))
ck("ЄП 2 гр листопад → 20.11", find(2, "eu-2026-11").due_date == date(2026, 11, 20))
ck("річна декл. 1-2 гр за 2025 → 02.03.2026", find(2, "decl-2025Y").due_date == date(2026, 3, 2))

today = date(2026, 11, 26)
up = t.upcoming_deadlines(3, False, today, set())
kinds = [d.kind for d, *_ in up]
ck("гр3: eu/esv/vz/decl, без employees", set(kinds) == {"eu", "esv", "vz", "decl"}, kinds)
eu = [x for x in up if x[0].kind == "eu"][0]
ck("прострочене ЄП 19.11 → overdue, -7", eu[0].key == "eu-2026Q3" and eu[1] == "overdue" and eu[2] == -7, eu)
eu3 = [x for x in t.upcoming_deadlines(3, False, today, {"eu-2026Q3"}) if x[0].kind == "eu"][0]
ck("виконано → наступний ЄП", eu3[0].key == "eu-2026Q4" and eu3[1] == "planned")
e4 = [x for x in t.upcoming_deadlines(2, False, date(2026, 11, 18), set()) if x[0].kind == "eu"][0]
ck("гр2 18.11: ЄП soon, 2 дні", e4[1] == "soon" and e4[2] == 2)
ck("працівники → verify без дати", any(d.kind == "employees" and st == "verify" and dl is None for d, st, dl, _ in t.upcoming_deadlines(2, True, today, set())))
ck("без групи → []", t.upcoming_deadlines(None, False, today, set()) == [])
ck("valid_keys", "eu-2026Q3" in t.valid_keys(3, False, today) and "eu-2026-11" not in t.valid_keys(3, False, today))
ck("давній (38 дн) ЄСВ приховано", [x[0].key for x in up if x[0].kind == "esv"] == ["esv-2026Q4"])

# --- розклад ---
KY = s.KYIV
now = datetime(2026, 11, 26, 8, 0, tzinfo=timezone.utc)   # чт 10:00 Київ
sl = s.generate_slots(s.DEFAULT_WINDOWS, 60, now_utc=now, days=7, busy=set())
loc = [x.astimezone(KY) for x in sl]
ck("лише Пн–Пт", all(l.weekday() < 5 for l in loc))
ck("10:00…16:00", all(10 <= l.hour <= 16 and l.minute == 0 for l in loc))
ck("сьогодні від 11:00 (мін. 60 хв)", min(loc).date() == date(2026, 11, 26) and min(loc).hour == 11, min(loc))
ck("наступний день 7 слотів", len([l for l in loc if l.date() == date(2026, 11, 27)]) == 7)
ck("у UTC (+2 взимку)", sl[0].tzinfo == timezone.utc and sl[0].hour == 9)
sl2 = s.generate_slots(s.DEFAULT_WINDOWS, 60, now_utc=now, days=7, busy={sl[0]})
ck("зайнятий виключено", sl[0] not in sl2 and len(sl2) == len(sl) - 1)
ck("is_valid_slot для всіх згенерованих", all(s.is_valid_slot(x, s.DEFAULT_WINDOWS, 60) for x in sl))
ck("09:30 — ні", not s.is_valid_slot(datetime(2026, 11, 27, 7, 30, tzinfo=timezone.utc), s.DEFAULT_WINDOWS, 60))
ck("17:00 — ні", not s.is_valid_slot(datetime(2026, 11, 27, 15, 0, tzinfo=timezone.utc), s.DEFAULT_WINDOWS, 60))
ck("субота — ні", not s.is_valid_slot(datetime(2026, 11, 28, 9, 0, tzinfo=timezone.utc), s.DEFAULT_WINDOWS, 60))
ck("секунди — ні", not s.is_valid_slot(datetime(2026, 11, 27, 9, 0, 30, tzinfo=timezone.utc), s.DEFAULT_WINDOWS, 60))
jul = s.generate_slots(s.DEFAULT_WINDOWS, 60, now_utc=datetime(2026, 7, 6, 0, 0, tzinfo=timezone.utc), days=1, busy=set())
ck("літній час: 10:00 Київ = 07:00 UTC", jul[0].hour == 7)
ck("порожній розклад", s.generate_slots([], 60, now_utc=now, days=14, busy=set()) == [])
print(f"\nПройдено перевірок: {n}")
