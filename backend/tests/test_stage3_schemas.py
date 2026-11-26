"""Перевірки схем Етапу 3 (валідація вхідних даних): python tests/test_stage3_schemas.py"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from datetime import datetime, time, timezone

from pydantic import ValidationError

import schemas as sc

n = 0


def ck(name, cond, extra=""):
    global n
    print(("OK   " if cond else "FAIL ") + name, extra if not cond else "")
    assert cond, name
    n += 1


def invalid(model, **data):
    try:
        model(**data)
    except ValidationError as e:
        return "; ".join(err["msg"] for err in e.errors())
    return None


# --- ConsultationUpdate: часткове оновлення ---
ck("порожнє тіло відхиляється", invalid(sc.ConsultationUpdate) is not None)
u = sc.ConsultationUpdate(expert_notes="нотатка")
ck("передане поле — у model_fields_set, решта — ні", u.model_fields_set == {"expert_notes"}, u.model_fields_set)
u = sc.ConsultationUpdate(meeting_url=None)
ck("явний null теж рахується переданим (очищення)", u.model_fields_set == {"meeting_url"} and u.meeting_url is None)
u = sc.ConsultationUpdate(meeting_url="   ")
ck("порожнє посилання → None", u.meeting_url is None and "meeting_url" in u.model_fields_set)
u = sc.ConsultationUpdate(meeting_url="  https://meet.google.com/abc-defg-hij ")
ck("посилання обрізається", u.meeting_url == "https://meet.google.com/abc-defg-hij")
m = invalid(sc.ConsultationUpdate, meeting_url="javascript:alert(1)")
ck("javascript: у посиланні відхиляється", m and "http" in m, m)
m = invalid(sc.ConsultationUpdate, meeting_url="meet.google.com/abc")
ck("посилання без схеми відхиляється", m is not None, m)
ck("нотатки понад 5000 символів відхиляються", invalid(sc.ConsultationUpdate, expert_notes="x" * 5001) is not None)
ck("рівно 5000 — дозволено", invalid(sc.ConsultationUpdate, expert_notes="x" * 5000) is None)

# --- BookingStatusUpdate ---
u = sc.BookingStatusUpdate(status="completed", summary="Підсумок")
ck("статус завершення з підсумком", u.status.value == "completed" and u.summary == "Підсумок")
ck("summary за замовчуванням None", sc.BookingStatusUpdate(status="confirmed").summary is None)
ck("посилання при підтвердженні валідується", invalid(sc.BookingStatusUpdate, status="confirmed", meeting_url="ftp://x") is not None)
ck("невідомий статус відхиляється", invalid(sc.BookingStatusUpdate, status="done") is not None)
ck("summary понад 5000 відхиляється", invalid(sc.BookingStatusUpdate, status="completed", summary="x" * 5001) is not None)

# --- Розклад ---
good = {"slot_minutes": 45, "windows": [{"weekday": 0, "start": "10:00", "end": "13:00"}]}
u = sc.ScheduleUpdate(**good)
ck("час 'HH:MM' розбирається", u.windows[0].start == time(10, 0) and u.windows[0].end == time(13, 0))
ck("час 'HH:MM:SS' теж", sc.ScheduleWindow(weekday=1, start="09:30:00", end="10:30:00").start == time(9, 30))
ck("порожній розклад дозволено", sc.ScheduleUpdate(slot_minutes=60, windows=[]).windows == [])
m = invalid(sc.ScheduleUpdate, slot_minutes=47, windows=[])
ck("тривалість некратна 5", m and "5" in m, m)
ck("тривалість < 15", invalid(sc.ScheduleUpdate, slot_minutes=10, windows=[]) is not None)
ck("тривалість > 240", invalid(sc.ScheduleUpdate, slot_minutes=245, windows=[]) is not None)
ck("день тижня 7", invalid(sc.ScheduleWindow, weekday=7, start="10:00", end="11:00") is not None)
ck("день тижня -1", invalid(sc.ScheduleWindow, weekday=-1, start="10:00", end="11:00") is not None)
ck("некоректний час", invalid(sc.ScheduleWindow, weekday=0, start="25:00", end="26:00") is not None)
m = invalid(sc.ScheduleWindow, weekday=0, start="10:00+02:00", end="11:00+02:00")
ck("час із часовою зоною відхиляється", m and "зони" in m, m)
ck("понад 42 вікон", invalid(sc.ScheduleUpdate, slot_minutes=60,
                            windows=[{"weekday": 0, "start": "10:00", "end": "11:00"}] * 43) is not None)
r = sc.ScheduleRead(slot_minutes=60, timezone="Europe/Kyiv", windows=[sc.ScheduleWindow(weekday=0, start=time(10, 0), end=time(17, 0))])
ck("серіалізація часу в JSON: HH:MM:SS", r.model_dump(mode="json")["windows"][0]["start"] == "10:00:00", r.model_dump(mode="json"))

# --- Профіль спеціаліста ---
ck("порожнє оновлення профілю відхиляється", invalid(sc.ExpertProfileUpdate) is not None)
u = sc.ExpertProfileUpdate(headline="  Бухгалтер ФОП  ", bio=" Досвід ")
ck("текст профілю обрізається", u.headline == "Бухгалтер ФОП" and u.bio == "Досвід")
ck("лише передані поля у model_fields_set", u.model_fields_set == {"headline", "bio"})
u = sc.ExpertProfileUpdate(experience_years=None)
ck("experience_years: null очищає", u.model_fields_set == {"experience_years"} and u.experience_years is None)
ck("стаж -1", invalid(sc.ExpertProfileUpdate, experience_years=-1) is not None)
ck("стаж 71", invalid(sc.ExpertProfileUpdate, experience_years=71) is not None)
ck("стаж 0 і 70 дозволені", invalid(sc.ExpertProfileUpdate, experience_years=0) is None and invalid(sc.ExpertProfileUpdate, experience_years=70) is None)
ck("імʼя з 1 літери", invalid(sc.ExpertProfileUpdate, full_name=" а ") is not None)
ck("імʼя обрізається", sc.ExpertProfileUpdate(full_name="  Олена Коваль ").full_name == "Олена Коваль")
ck("спеціалізація — enum", sc.ExpertProfileUpdate(specialization="lawyer").specialization.value == "lawyer")
ck("невідома спеціалізація", invalid(sc.ExpertProfileUpdate, specialization="doctor") is not None)
ck("bio понад 2000", invalid(sc.ExpertProfileUpdate, bio="x" * 2001) is not None)

# --- Відповіді: збираються з мінімального набору полів ---
now = datetime(2026, 11, 26, 10, 0, tzinfo=timezone.utc)
base = dict(id=1, status="pending", slot_datetime=now, slot_end=now, created_at=now, client_id=2, client_name="Ірина",
            service_id=3, service_title="Консультація", service_price=500.0)
c = sc.ExpertConsultationRead(**base)
ck("ExpertConsultationRead: прапорці за замовчуванням false", not (c.can_confirm or c.can_reject or c.can_complete or c.is_past))
d = sc.ExpertConsultationDetail(**base, ai_summary="Питання про ЄСВ", history=[
    sc.ClientHistoryItem(id=9, slot_datetime=now, status="completed", service_title="Консультація", summary_preview="…")])
ck("ExpertConsultationDetail: історія і контекст", d.ai_summary == "Питання про ЄСВ" and d.history[0].status.value == "completed")
ck("приватні нотатки не входять у список (лише в картку)", "expert_notes" not in sc.ExpertConsultationRead.model_fields
   and "expert_notes" in sc.ExpertConsultationDetail.model_fields)
ck("ExpertConsultationRead не містить email клієнта", "email" not in sc.ExpertConsultationRead.model_fields)
ck("ExpertClientRead не містить email", "email" not in sc.ExpertClientRead.model_fields)
dash = sc.ExpertDashboardRead(today=now.date(), pending_count=1, today_count=0, upcoming_count=2, to_complete_count=0,
                              completed_count=5, clients_count=3,
                              setup=sc.ExpertSetupRead(has_services=True, has_schedule=True, has_profile_text=False))
ck("ExpertDashboardRead збирається без next_consultation", dash.next_consultation is None and dash.completed_count == 5)

print(f"\nПройдено перевірок: {n}")
