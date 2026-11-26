"""
Перевірки провайдера Ollama без справжньої Ollama: піднімаємо локальний фейковий сервер
з тим самим протоколом (/api/chat, /api/tags). python tests/test_ai_provider.py
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

import ai_provider as p

n = 0


def ck(name, cond, extra=""):
    global n
    print(("OK   " if cond else "FAIL ") + name, extra if not cond else "")
    assert cond, name
    n += 1


# ---------------------------------------------------------------- фейковий сервер
class State:
    last_request: dict = {}
    mode = "ok"
    models = ["llama3.1:8b", "qwen2.5:7b"]
    prompt_eval_count = 120


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # тиша в консолі
        pass

    def _send(self, code, payload, raw=None):
        body = raw if raw is not None else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/tags":
            self._send(200, {"models": [{"name": m} for m in State.models]})
        else:
            self._send(404, {"error": "no route"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        State.last_request = json.loads(self.rfile.read(length))
        State.last_request["_path"] = self.path
        mode = State.mode
        if mode == "ok":
            self._send(200, {
                "model": State.last_request["model"],
                "message": {"role": "assistant", "content": "  **Коротка відповідь**\nТак.  "},
                "done": True, "prompt_eval_count": State.prompt_eval_count, "eval_count": 7,
            })
        elif mode == "think":
            self._send(200, {"message": {"role": "assistant", "content": "<think>\nміркую\n</think>\n\nВідповідь"}, "done": True})
        elif mode == "missing":
            self._send(404, {"error": "model 'llama3.1:8b' not found, try pulling it first"})
        elif mode == "oom":
            self._send(500, {"error": "model requires more system memory than is available"})
        elif mode == "html":
            self._send(502, None, raw=b"<html>Bad gateway</html>")
        elif mode == "notjson":
            self._send(200, None, raw=b"not json at all")
        elif mode == "nocontent":
            self._send(200, {"done": True})
        elif mode == "inline_error":
            self._send(200, {"error": "something broke"})
        elif mode == "slow":
            time.sleep(1.5)
            try:
                self._send(200, {"message": {"content": "late"}})
            except OSError:  # клієнт уже розірвав з'єднання за таймаутом — це очікувано
                pass


server = HTTPServer(("127.0.0.1", 0), Handler)
port = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{port}"
CFG = p.OllamaConfig(base_url=URL, model="llama3.1:8b", timeout=5, num_ctx=8192, keep_alive="30m")


def err(fn, *a, **kw):
    try:
        fn(*a, **kw)
    except p.ProviderError as e:
        return e
    return None


# ---------------------------------------------------------------- успішний запит
State.mode = "ok"
res = p.chat("СИСТЕМА", "ПИТАННЯ", 500, CFG)
req = State.last_request
ck("шлях запиту /api/chat", req["_path"] == "/api/chat")
ck("stream вимкнено", req["stream"] is False)
ck("модель з конфігурації", req["model"] == "llama3.1:8b")
ck("системне повідомлення першим", req["messages"][0] == {"role": "system", "content": "СИСТЕМА"})
ck("повідомлення користувача другим", req["messages"][1] == {"role": "user", "content": "ПИТАННЯ"})
ck("temperature=0 і seed=0", req["options"]["temperature"] == 0 and req["options"]["seed"] == 0)
ck("num_ctx передається явно", req["options"]["num_ctx"] == 8192)
ck("num_predict = max_tokens", req["options"]["num_predict"] == 500)
ck("keep_alive передається", req["keep_alive"] == "30m")
ck("текст відповіді обрізано по краях", res.text == "**Коротка відповідь**\nТак.")
ck("токени запиту/відповіді", res.prompt_tokens == 120 and res.completion_tokens == 7)
ck("тривалість виміряна", res.seconds >= 0)
ck("короткий запит не позначено як обрізаний", res.truncated is False)

# обрізання контексту
State.prompt_eval_count = 8192
res = p.chat("s", "u", 100, CFG)
ck("запит на межі вікна позначено як обрізаний", res.truncated is True)
State.prompt_eval_count = 8192 - 100
ck("запас до межі — не обрізаний", p.chat("s", "u", 100, CFG).truncated is False)
State.prompt_eval_count = 120

# <think>
State.mode = "think"
ck("блок <think> прибрано", p.chat("s", "u", 100, CFG).text == "Відповідь")
ck("clean_answer без тегів не змінює текст", p.clean_answer("Привіт") == "Привіт")
ck("clean_answer багаторядковий і регістр", p.clean_answer("<THINK>а\nб</THINK>Ок") == "Ок")

# ---------------------------------------------------------------- помилки
State.mode = "missing"
e = err(p.chat, "s", "u", 100, CFG)
ck("404 → model_missing", e is not None and e.kind == "model_missing" and "not found" in e.detail)

State.mode = "oom"
e = err(p.chat, "s", "u", 100, CFG)
ck("500 → upstream з текстом Ollama", e is not None and e.kind == "upstream" and "memory" in e.detail)

State.mode = "html"
e = err(p.chat, "s", "u", 100, CFG)
ck("HTML у тілі помилки → upstream", e is not None and e.kind == "upstream" and "502" in e.detail)

State.mode = "notjson"
e = err(p.chat, "s", "u", 100, CFG)
ck("не JSON → bad_response", e is not None and e.kind == "bad_response")

State.mode = "nocontent"
e = err(p.chat, "s", "u", 100, CFG)
ck("немає message.content → bad_response", e is not None and e.kind == "bad_response")

State.mode = "inline_error"
e = err(p.chat, "s", "u", 100, CFG)
ck("поле error у 200-відповіді → upstream", e is not None and e.kind == "upstream" and "broke" in e.detail)

State.mode = "slow"
slow_cfg = p.OllamaConfig(base_url=URL, model="m", timeout=0.4, num_ctx=4096, keep_alive="1m")
e = err(p.chat, "s", "u", 100, slow_cfg)
ck("повільна відповідь → timeout", e is not None and e.kind == "timeout")

dead = p.OllamaConfig(base_url="http://127.0.0.1:9", model="m", timeout=2, num_ctx=4096, keep_alive="1m")
e = err(p.chat, "s", "u", 100, dead)
ck("порт без сервера → connection", e is not None and e.kind == "connection")

bad = p.OllamaConfig(base_url="file:///etc/passwd", model="m")
e = err(p.chat, "s", "u", 100, bad)
ck("схема file:// відхилена (SSRF/читання файлів)", e is not None and e.kind == "connection")
e = err(p.chat, "s", "u", 100, p.OllamaConfig(base_url="localhost:11434", model="m"))
ck("адреса без схеми відхилена", e is not None and e.kind == "connection")

# ---------------------------------------------------------------- статус
st = p.ollama_status(CFG)
ck("статус: доступна, модель є", st.reachable and st.model_present and "qwen2.5:7b" in st.models)
st = p.ollama_status(p.OllamaConfig(base_url=URL, model="mistral:7b"))
ck("статус: доступна, моделі немає", st.reachable and not st.model_present)
State.models = ["llama3.1:latest"]
st = p.ollama_status(p.OllamaConfig(base_url=URL, model="llama3.1"))
ck("статус: «llama3.1» збігається з «llama3.1:latest»", st.model_present)
st = p.ollama_status(p.OllamaConfig(base_url=URL, model="llama3.1:8b"))
ck("статус: інший тег — не збіг", not st.model_present)
st = p.ollama_status(dead)
ck("статус: недоступна — без винятку, з текстом помилки", not st.reachable and bool(st.error))
st = p.ollama_status(bad)
ck("статус: некоректна адреса — без винятку", not st.reachable)

# ---------------------------------------------------------------- конфігурація з .env
for k in ("OLLAMA_URL", "OLLAMA_MODEL", "OLLAMA_TIMEOUT_SECONDS", "OLLAMA_NUM_CTX", "OLLAMA_KEEP_ALIVE"):
    os.environ.pop(k, None)
c = p.load_config()
ck("значення за замовчуванням", c == p.OllamaConfig())
os.environ.update({
    "OLLAMA_URL": "http://host:1234/", "OLLAMA_MODEL": " qwen2.5:7b ", "OLLAMA_TIMEOUT_SECONDS": "60",
    "OLLAMA_NUM_CTX": "16384", "OLLAMA_KEEP_ALIVE": "5m",
})
c = p.load_config()
ck("змінні оточення читаються", c.base_url == "http://host:1234" and c.model == "qwen2.5:7b"
   and c.timeout == 60 and c.num_ctx == 16384 and c.keep_alive == "5m")
os.environ.update({"OLLAMA_TIMEOUT_SECONDS": "abc", "OLLAMA_NUM_CTX": "-5", "OLLAMA_MODEL": "  "})
c = p.load_config()
ck("некоректні значення → за замовчуванням", c.timeout == p.DEFAULT_TIMEOUT and c.num_ctx == p.DEFAULT_NUM_CTX
   and c.model == p.DEFAULT_MODEL)

server.shutdown()
print(f"\nПройдено перевірок: {n}")
