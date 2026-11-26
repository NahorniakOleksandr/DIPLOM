"""
Наскрізна перевірка кабінету спеціаліста (Етап 3) проти ЗАПУЩЕНОГО сервера. Лише стандартна бібліотека.

    uvicorn main:app --reload                       # в одному терміналі
    python tests/smoke_stage3.py                    # в іншому (або: python tests/smoke_stage3.py http://127.0.0.1:8000)

Скрипт створює нових користувачів (email з поточним часом), тож його можна запускати повторно.
Перевіряє реальні HTTP-запити: розклад, послугу, запис ФОПа з контекстом ШІ, підтвердження, нотатки, підсумок,
відхилення, звільнення слота, межі приватності та рольового доступу. Код виходу 0 — усе гаразд.
Завершення консультації (completed) потребує слота в минулому, тому тут перевіряється лише його заборона
до початку; повну дію перевірте вручну (див. README етапу).
"""
import json
import sys
import time
import urllib.error
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000").rstrip("/")
STAMP = str(int(time.time()))
PASSWORD = "Smoke12345!"
passed = 0


def call(method, path, token=None, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None), raw
    except urllib.error.HTTPError as err:
        raw = err.read().decode("utf-8")
        try:
            return err.code, json.loads(raw), raw
        except ValueError:
            return err.code, None, raw
    except urllib.error.URLError as err:
        print(f"\nНе вдалося з'єднатися з {BASE}: {err.reason}\nЗапустіть сервер: uvicorn main:app --reload")
        sys.exit(2)


def check(name, condition, extra=""):
    global passed
    if condition:
        passed += 1
        print(f"OK   {name}")
    else:
        print(f"FAIL {name}\n     {extra}")
        sys.exit(1)


def expect(name, response, status, extra_check=None):
    code, data, raw = response
    ok = code == status and (extra_check(data) if extra_check else True)
    check(name, ok, f"очікувався HTTP {status}, отримано {code}: {raw[:300]}")
    return data


def register(role, label, profession=None):
    email = f"smoke.{STAMP}.{label}@example.com"
    body = {"email": email, "password": PASSWORD, "full_name": f"Тест {label}", "role": role}
    if profession:
        body["profession"] = profession
    expect(f"реєстрація {label}", call("POST", "/auth/register", body=body), 201)
    login = expect(f"вхід {label}", call("POST", "/auth/login", body={"email": email, "password": PASSWORD}), 200,
                   lambda d: d.get("role") == role)
    token = login["access_token"]
    me = expect(f"/auth/me {label}", call("GET", "/auth/me", token), 200)
    return token, me["id"]


print(f"Сервер: {BASE}\n")
fop, fop_id = register("fop", "fop")
exp, exp_id = register("expert", "expert", "accountant")
other, _ = register("expert", "expert2", "lawyer")

# ---------- Налаштування спеціаліста ----------
week = [{"weekday": d, "start": "08:00", "end": "20:00"} for d in range(7)]
sched = expect("PUT /expert/schedule (7 днів, 60 хв)", call("PUT", "/expert/schedule", exp, {"slot_minutes": 60, "windows": week}), 200,
               lambda d: len(d["windows"]) == 7 and d["slot_minutes"] == 60 and d["timezone"] == "Europe/Kyiv")
expect("перетин вікон → 422 з поясненням",
       call("PUT", "/expert/schedule", exp, {"slot_minutes": 60, "windows": [
           {"weekday": 1, "start": "10:00", "end": "13:00"}, {"weekday": 1, "start": "12:00", "end": "15:00"}]}),
       422, lambda d: "перетинаються" in json.dumps(d, ensure_ascii=False))
expect("вікно коротше за слот → 422",
       call("PUT", "/expert/schedule", exp, {"slot_minutes": 60, "windows": [{"weekday": 1, "start": "10:00", "end": "10:30"}]}), 422)
expect("розклад не змінився після відхилених запитів", call("GET", "/expert/schedule", exp), 200, lambda d: len(d["windows"]) == 7)

service = expect("POST /expert/services", call("POST", "/expert/services", exp,
                 {"title": "Консультація з єдиного податку", "description": "Група, ліміти, строки", "price": 500}), 201)
dash = expect("GET /expert/dashboard: чек-лист налаштування", call("GET", "/expert/dashboard", exp), 200,
              lambda d: d["setup"]["has_services"] and d["setup"]["has_schedule"] and d["pending_count"] == 0)
expect("GET /expert/profile", call("GET", "/expert/profile", exp), 200, lambda d: d["services_count"] == 1 and d["specialization"] == "accountant")
expect("PATCH /expert/profile", call("PATCH", "/expert/profile", exp,
       {"headline": "Бухгалтер ФОП", "bio": "Веду ФОП на єдиному податку", "experience_years": 7}), 200,
       lambda d: d["headline"] == "Бухгалтер ФОП" and d["experience_years"] == 7)
expect("порожній PATCH профілю → 422", call("PATCH", "/expert/profile", exp, {}), 422)

# ---------- Запис ФОПа ----------
expect("PUT /fop/profile", call("PUT", "/fop/profile", fop,
       {"tax_group": 3, "tax_rate": 5, "kveds": ["62.01"], "has_employees": False}), 200)
slots = expect("GET слоти спеціаліста", call("GET", f"/fop/experts/{exp_id}/slots?days=7", fop), 200, lambda d: len(d["slots"]) > 3)
slot = slots["slots"][0]["start"]
booking = expect("POST /fop/bookings із контекстом ШІ", call("POST", "/fop/bookings", fop, {
    "service_id": service["id"], "slot_datetime": slot,
    "ai_summary": "Питання: чи потрібно сплачувати ЄСВ за себе, якщо немає доходу?"}), 201)
bid = booking["id"]

# ---------- Заявки спеціаліста ----------
reqs = expect("GET /expert/consultations?scope=requests", call("GET", "/expert/consultations?scope=requests", exp), 200,
              lambda d: len(d) == 1 and d[0]["id"] == bid)
item = reqs[0]
check("заявка: прапорці з бекенду (можна підтвердити/відхилити, не можна завершити)",
      item["can_confirm"] and item["can_reject"] and not item["can_complete"], item)
check("заявка: параметри ФОПа і ознака контексту ШІ", item["client_profile"]["tax_group"] == 3 and item["has_ai_summary"], item)
check("у списку немає email клієнта", "email" not in json.dumps(item) and "@example.com" not in json.dumps(item))
expect("лічильник нових заявок у дашборді", call("GET", "/expert/dashboard", exp), 200, lambda d: d["pending_count"] == 1)

card = expect("GET /expert/consultations/{id}: картка", call("GET", f"/expert/consultations/{bid}", exp), 200,
              lambda d: "ЄСВ" in (d["ai_summary"] or "") and d["client_profile"]["kveds"] == ["62.01"] and d["history"] == [])
expect("чужий спеціаліст не бачить картку → 404", call("GET", f"/expert/consultations/{bid}", other), 404)
expect("ФОП не має доступу до кабінету спеціаліста → 403", call("GET", "/expert/dashboard", fop), 403)
expect("спеціаліст не має доступу до кабінету ФОПа → 403", call("GET", "/fop/dashboard", exp), 403)

expect("приватні нотатки зберігаються", call("PATCH", f"/expert/consultations/{bid}", exp,
       {"expert_notes": "СЕКРЕТНА-НОТАТКА: клієнт сумнівається щодо ставки"}), 200,
       lambda d: d["expert_notes"].startswith("СЕКРЕТНА") and d["has_notes"])
expect("підсумок до підтвердження заборонено → 409",
       call("PATCH", f"/expert/consultations/{bid}", exp, {"expert_summary": "рано"}), 409)
expect("порожній PATCH картки → 422", call("PATCH", f"/expert/consultations/{bid}", exp, {}), 422)
expect("посилання не http → 422", call("PATCH", f"/expert/consultations/{bid}", exp, {"meeting_url": "javascript:alert(1)"}), 422)

# ---------- Підтвердження ----------
expect("підтвердження з посиланням", call("PATCH", f"/expert/bookings/{bid}/status", exp,
       {"status": "confirmed", "meeting_url": "https://meet.google.com/abc-defg-hij"}), 200,
       lambda d: d["status"] == "confirmed" and d["meeting_url"].startswith("https://meet.google.com"))
expect("повторне підтвердження → 409", call("PATCH", f"/expert/bookings/{bid}/status", exp, {"status": "confirmed"}), 409)
expect("чужий спеціаліст не може змінити статус → 404", call("PATCH", f"/expert/bookings/{bid}/status", other, {"status": "rejected"}), 404)
expect("спеціалісту не можна встановити paid → 400", call("PATCH", f"/expert/bookings/{bid}/status", exp, {"status": "paid"}), 400)
expect("чернетка підсумку після підтвердження", call("PATCH", f"/expert/consultations/{bid}", exp,
       {"expert_summary": "ЧЕРНЕТКА-ПІДСУМКУ"}), 200, lambda d: d["can_write_summary"] and d["has_summary"])
expect("завершення до початку → 409", call("PATCH", f"/expert/bookings/{bid}/status", exp, {"status": "completed"}), 409)

mine = expect("ФОП бачить підтвердження і посилання", call("GET", "/fop/consultations", fop), 200,
              lambda d: d[0]["status"] == "confirmed" and d[0]["meeting_url"])
whole = json.dumps(mine, ensure_ascii=False)
check("ФОП НЕ бачить приватних нотаток", "СЕКРЕТНА" not in whole, whole[:300])
check("ФОП НЕ бачить чернетки підсумку до завершення", "ЧЕРНЕТКА" not in whole and mine[0]["expert_summary"] is None, whole[:300])
expect("upcoming містить підтверджену", call("GET", "/expert/consultations?scope=upcoming", exp), 200, lambda d: [x["id"] for x in d] == [bid])
expect("requests тепер порожній", call("GET", "/expert/consultations?scope=requests", exp), 200, lambda d: d == [])
clients = expect("GET /expert/clients", call("GET", "/expert/clients", exp), 200,
                 lambda d: len(d) == 1 and d[0]["id"] == fop_id and d[0]["tax_group"] == 3 and d[0]["next_slot_datetime"])
check("клієнти без email", "email" not in json.dumps(clients))

# ---------- Скасування підтвердженої ----------
expect("скасування підтвердженої без причини → 422", call("PATCH", f"/expert/bookings/{bid}/status", exp, {"status": "rejected"}), 422)
expect("скасування з причиною", call("PATCH", f"/expert/bookings/{bid}/status", exp,
       {"status": "rejected", "reason": "Захворів, перенесемо"}), 200, lambda d: d["status"] == "rejected" and "Захворів" in d["rejection_reason"])
mine = expect("ФОП бачить причину відхилення", call("GET", "/fop/consultations", fop), 200,
              lambda d: d[0]["status"] == "rejected" and "Захворів" in d[0]["rejection_reason"])
again = expect("слот знову вільний", call("GET", f"/fop/experts/{exp_id}/slots?days=7", fop), 200,
               lambda d: slot in [s["start"] for s in d["slots"]])
expect("архів містить відхилену", call("GET", "/expert/consultations?scope=history", exp), 200, lambda d: [x["id"] for x in d] == [bid])
expect("повторне скасування → 409", call("PATCH", f"/expert/bookings/{bid}/status", exp, {"status": "rejected", "reason": "ще раз"}), 409)

# ---------- Розклад та активні записи ----------
expect("зміна тривалості без активних записів → 200", call("PUT", "/expert/schedule", exp, {"slot_minutes": 30, "windows": week}), 200,
       lambda d: d["slot_minutes"] == 30)
slots30 = expect("слоти по 30 хв", call("GET", f"/fop/experts/{exp_id}/slots?days=7", fop), 200, lambda d: d["slot_minutes"] == 30)
second = expect("другий запис", call("POST", "/fop/bookings", fop, {"service_id": service["id"], "slot_datetime": slots30["slots"][0]["start"]}), 201)
expect("зміна тривалості за наявного активного запису → 409",
       call("PUT", "/expert/schedule", exp, {"slot_minutes": 60, "windows": week}), 409, lambda d: "майбутні записи" in d["detail"])
shrunk = expect("звуження розкладу не скасовує запис, а лічить його «поза розкладом»",
                call("PUT", "/expert/schedule", exp, {"slot_minutes": 30, "windows": []}), 200,
                lambda d: d["windows"] == [] and d["outside_schedule_bookings"] == 1)
expect("порожній розклад: ФОП не бачить слотів", call("GET", f"/fop/experts/{exp_id}/slots?days=7", fop), 200, lambda d: d["slots"] == [])
expect("відновлення розкладу", call("PUT", "/expert/schedule", exp, {"slot_minutes": 30, "windows": week}), 200,
       lambda d: d["outside_schedule_bookings"] == 0)
expect("друга заявка відображається серед нових", call("GET", "/expert/consultations?scope=requests", exp), 200,
       lambda d: [x["id"] for x in d] == [second["id"]])

print(f"\nПройдено перевірок: {passed}")
print("Завершення консультації (completed) перевірте вручну: потрібен запис, слот якого вже настав.")
