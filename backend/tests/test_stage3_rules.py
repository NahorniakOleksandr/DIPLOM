"""Перевірки правил Етапу 3 (без БД і без FastAPI): python tests/test_stage3_rules.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from datetime import datetime, time, timedelta, timezone

import booking_rules as br
import scheduling as s

n = 0


def ck(name, cond, extra=""):
    global n
    print(("OK   " if cond else "FAIL ") + name, extra if not cond else "")
    assert cond, name
    n += 1


def raises(fn, *args):
    try:
        fn(*args)
    except s.ScheduleError as e:
        return str(e)
    return None


UTC = timezone.utc
NOW = datetime(2026, 11, 26, 10, 0, tzinfo=UTC)
HOUR = timedelta(hours=1)


def act(status, start_offset_h, minutes=60):
    start = NOW + timedelta(hours=start_offset_h)
    return br.allowed_actions(status, start, start + timedelta(minutes=minutes), NOW)


def trans(status, target, start_offset_h, reason=None, minutes=60):
    start = NOW + timedelta(hours=start_offset_h)
    return br.check_transition(status, target, start, start + timedelta(minutes=minutes), NOW, reason)


# --- доступні дії ---
a = act("pending", 5)
ck("нова заявка в майбутньому: можна підтвердити і відхилити", a.can_confirm and a.can_reject and not a.can_complete)
ck("нова заявка: можна змінити посилання, підсумок ще ні", a.can_edit_meeting and not a.can_write_summary)
a = act("pending", -3)
ck("прострочена заявка: підтвердити не можна, відхилити можна", not a.can_confirm and a.can_reject and a.is_past)
a = act("pending", -0.5)
ck("заявка, що вже почалась: підтвердити не можна", not a.can_confirm and a.can_reject and not a.is_past)
a = act("confirmed", 5)
ck("підтверджена в майбутньому: скасувати можна, завершити ні", a.can_reject and not a.can_complete and not a.can_confirm)
ck("підтверджена: підсумок і посилання доступні", a.can_write_summary and a.can_edit_meeting)
a = act("confirmed", -0.5)
ck("підтверджена, що триває: завершити можна, скасувати ні", a.can_complete and not a.can_reject)
a = act("confirmed", -3)
ck("підтверджена, що минула: завершити можна, посилання вже не змінити", a.can_complete and a.is_past and not a.can_edit_meeting)
a = act("paid", 5)
ck("paid поводиться як confirmed", a.can_reject and a.can_write_summary and not a.can_confirm)
for st in ("completed", "rejected", "cancelled"):
    a = act(st, 5)
    ck(f"{st}: жодних переходів", not (a.can_confirm or a.can_reject or a.can_complete))
ck("completed: підсумок ще можна виправити", act("completed", -3).can_write_summary)
ck("rejected: підсумок писати не можна", not act("rejected", -3).can_write_summary)
ck("рівно в момент початку — вже розпочато", act("confirmed", 0).can_complete and not act("confirmed", 0).can_reject)

# --- переходи ---
ck("pending → confirmed (майбутнє) дозволено", trans("pending", "confirmed", 5) is None)
v = trans("pending", "confirmed", -1)
ck("pending → confirmed для минулого слота: 409", v and v.code == 409, v)
v = trans("confirmed", "confirmed", 5)
ck("confirmed → confirmed: 409 з підписом статусу", v and v.code == 409 and "підтверджено" in v.message, v)
ck("pending → rejected без причини дозволено", trans("pending", "rejected", 5) is None)
ck("pending → rejected для минулого слота дозволено (прибрати прострочену)", trans("pending", "rejected", -9) is None)
v = trans("confirmed", "rejected", 5)
ck("скасування підтвердженої без причини: 422", v and v.code == 422, v)
v = trans("confirmed", "rejected", 5, reason="   ")
ck("причина з самих пробілів — теж 422", v and v.code == 422, v)
ck("скасування підтвердженої з причиною дозволено", trans("confirmed", "rejected", 5, reason="Захворів") is None)
v = trans("confirmed", "rejected", -0.5, reason="Захворів")
ck("скасувати вже розпочату: 409", v and v.code == 409, v)
v = trans("completed", "rejected", 5, reason="x")
ck("completed → rejected: 409", v and v.code == 409, v)
v = trans("cancelled", "confirmed", 5)
ck("cancelled → confirmed: 409", v and v.code == 409, v)
ck("confirmed → completed після початку дозволено", trans("confirmed", "completed", -2) is None)
ck("paid → completed після початку дозволено", trans("paid", "completed", -2) is None)
v = trans("confirmed", "completed", 5)
ck("завершити до початку: 409", v and v.code == 409, v)
v = trans("pending", "completed", -2)
ck("pending → completed: 409", v and v.code == 409, v)
v = trans("completed", "completed", -2)
ck("повторне завершення: 409", v and v.code == 409, v)
v = trans("pending", "paid", 5)
ck("встановити paid спеціалісту не можна: 400", v and v.code == 400, v)
v = trans("pending", "cancelled", 5)
ck("встановити cancelled спеціалісту не можна: 400", v and v.code == 400, v)

# Узгодженість: кожен дозволений перехід із ALLOWED_FROM справді пропускається в «правильний» час
for target, sources in br.ALLOWED_FROM.items():
    for src in sources:
        offset = -2 if target == "completed" else 5
        v = trans(src, target, offset, reason="причина")
        ck(f"{src} → {target} узгоджено з ALLOWED_FROM", v is None, v)

# --- enum як статус (BookingStatus — str-enum) ---
import enum


class St(str, enum.Enum):
    pending = "pending"
    confirmed = "confirmed"


ck("str-enum приймається як статус", act(St.pending, 5).can_confirm and br.status_str(St.confirmed) == "confirmed")
ck("clean_text: пробіли → None", br.clean_text("   ") is None and br.clean_text(None) is None)
ck("clean_text: обрізає", br.clean_text("  ok \n") == "ok")
ck("SCOPES: усі статуси покриті розділами", set(sum((v for k, v in br.SCOPES.items() if v), ()))
   == {"pending", "confirmed", "paid", "completed", "rejected", "cancelled"})

# --- розклад: валідація вікон ---
T = time
ok = s.validate_windows([(1, T(14, 0), T(18, 0)), (0, T(10, 0), T(13, 0)), (0, T(14, 0), T(17, 0))], 60)
ck("сортування: день, потім початок", ok == [(0, T(10, 0), T(13, 0)), (0, T(14, 0), T(17, 0)), (1, T(14, 0), T(18, 0))], ok)
ck("порожній розклад дозволено", s.validate_windows([], 60) == [])
ck("суміжні вікна (кінець = початок) дозволено", s.validate_windows([(0, T(10, 0), T(12, 0)), (0, T(12, 0), T(14, 0))], 60) != [])
ck("вікно рівно в один слот дозволено", s.validate_windows([(2, T(10, 0), T(11, 0))], 60) != [])

m = raises(s.validate_windows, [(0, T(12, 0), T(10, 0))], 60)
ck("кінець раніше за початок", m and "Понеділок" in m and "пізніше" in m, m)
m = raises(s.validate_windows, [(0, T(10, 0), T(10, 0))], 60)
ck("нульове вікно", m is not None, m)
m = raises(s.validate_windows, [(4, T(10, 0), T(10, 30))], 60)
ck("вікно коротше за слот: називає день і тривалість", m and "Пʼятниця" in m and "60 хв" in m, m)
m = raises(s.validate_windows, [(1, T(10, 0), T(13, 0)), (1, T(12, 0), T(15, 0))], 60)
ck("перетин вікон одного дня", m and "Вівторок" in m and "перетинаються" in m, m)
m = raises(s.validate_windows, [(1, T(10, 0), T(18, 0)), (1, T(11, 0), T(12, 0)), (1, T(13, 0), T(14, 0))], 60)
ck("вкладене вікно виявляється навіть після кількох вікон", m and "перетинаються" in m, m)
m = raises(s.validate_windows, [(1, T(10, 0), T(12, 0)), (1, T(10, 0), T(12, 0))], 60)
ck("точний дублікат — перетин", m is not None, m)
ck("однакові години в різні дні — не перетин", s.validate_windows([(0, T(10, 0), T(12, 0)), (1, T(10, 0), T(12, 0))], 60) != [])
m = raises(s.validate_windows, [(7, T(10, 0), T(12, 0))], 60)
ck("день тижня поза 0–6", m is not None, m)
m = raises(s.validate_windows, [(0, T(10, 0, 30), T(12, 0))], 60)
ck("секунди відхиляються", m and "хвилини" in m, m)
m = raises(s.validate_windows, [(0, T(8 + i, 0), T(8 + i, 15)) for i in range(7)], 15)
ck("більше 6 вікон на день", m and "не більше" in m, m)
m = raises(s.validate_windows, [(0, T(10, 0), T(12, 0))], 10)
ck("тривалість менша за мінімум", m and "від 15" in m, m)
m = raises(s.validate_windows, [(0, T(10, 0), T(12, 0))], 300)
ck("тривалість більша за максимум", m is not None, m)

# --- розклад: слоти за новими вікнами ---
now = datetime(2026, 11, 26, 8, 0, tzinfo=UTC)  # чт 10:00 Київ
win = s.validate_windows([(3, T(9, 0), T(12, 0)), (4, T(14, 0), T(16, 0))], 30)
sl = s.generate_slots(win, 30, now_utc=now, days=3, busy=set())
loc = [x.astimezone(s.KYIV) for x in sl]
ck("30-хв слоти: чт з 11:00 (мін. 60 хв) до 11:30 = 2 слоти", len([l for l in loc if l.weekday() == 3]) == 2, [str(l) for l in loc][:3])
ck("30-хв слоти: пт 14:00–16:00 = 4 слоти", len([l for l in loc if l.weekday() == 4]) == 4)
ck("усі згенеровані слоти проходять is_valid_slot", all(s.is_valid_slot(x, win, 30) for x in sl))

# --- слоти поза розкладом після його зміни ---
booked = [datetime(2026, 11, 27, 8, 0, tzinfo=UTC), datetime(2026, 11, 27, 9, 0, tzinfo=UTC)]  # пт 10:00 і 11:00 Київ
new_windows = s.validate_windows([(4, T(10, 0), T(11, 0))], 60)
ck("count_outside: 10:00 лишається, 11:00 випадає", s.count_outside(booked, new_windows, 60) == 1)
ck("count_outside: порожній розклад — усі поза", s.count_outside(booked, [], 60) == 2)
ck("count_outside: без записів — 0", s.count_outside([], new_windows, 60) == 0)
ck("зміна тривалості 60→45 зсуває сітку: 11:00 поза розкладом",
   s.count_outside(booked, s.validate_windows([(4, T(10, 0), T(12, 0))], 45), 45) == 1)

print(f"\nПройдено перевірок: {n}")
