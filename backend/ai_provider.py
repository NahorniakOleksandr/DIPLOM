"""
ai_provider.py — виклик локальної моделі через Ollama (без зовнішніх залежностей).

Модуль не імпортує FastAPI/SQLAlchemy, тому його можна запускати й тестувати окремо
(tests/test_ai_provider.py). Виклик синхронний (urllib); ai_service.py виконує його
в threadpool, щоб не блокувати event loop.

Використовується рідний API Ollama POST /api/chat (а не OpenAI-сумісний режим), бо тільки він
дозволяє задати розмір контексту num_ctx для кожного запиту. Це важливо: за замовчуванням Ollama
має невелике вікно контексту й МОВЧКИ обрізає довший запит — модель тоді відповідає за уривком
статті, а не за всією статтею. Тому num_ctx задається явно, а якщо сервер повідомив, що обробив
стільки токенів, скільки вміщає вікно, — у лог іде попередження.

Змінні оточення (backend/.env):
    OLLAMA_URL               — адреса сервера (за замовчуванням http://localhost:11434)
    OLLAMA_MODEL             — модель (за замовчуванням llama3.1:8b; має бути завантажена: ollama pull ...)
    OLLAMA_TIMEOUT_SECONDS   — таймаут одного запиту (за замовчуванням 180: на процесорі відповідь повільна)
    OLLAMA_NUM_CTX           — розмір вікна контексту в токенах (за замовчуванням 8192)
    OLLAMA_KEEP_ALIVE        — скільки тримати модель у пам'яті після запиту (за замовчуванням 30m)
"""

from __future__ import annotations

import json
import logging
import os
import re
import socket
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlsplit

import config  # noqa: F401  — завантажує backend/.env; має бути до першого os.getenv

logger = logging.getLogger(__name__)

DEFAULT_URL = "http://localhost:11434"
DEFAULT_MODEL = "llama3.1:8b"
DEFAULT_TIMEOUT = 180.0
DEFAULT_NUM_CTX = 8192
DEFAULT_KEEP_ALIVE = "30m"
STATUS_TIMEOUT = 3.0          # перевірка доступності при старті має бути швидкою
MAX_ERROR_BODY = 300          # скільки символів тіла помилки писати в лог

# Деякі моделі (з «міркуванням») віддають хід думок у тегах <think>…</think> — користувачу він не потрібен.
_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


class ProviderError(Exception):
    """
    Збій виклику моделі.

    kind:
      'connection'    — Ollama не запущено або адреса неправильна;
      'timeout'       — модель не встигла відповісти;
      'model_missing' — модель не завантажена (ollama pull …);
      'upstream'      — Ollama повернула помилку (недостатньо пам'яті тощо);
      'bad_response'  — відповідь не схожа на відповідь Ollama.
    detail — технічний опис для логів (користувачу не показується).
    """

    def __init__(self, kind: str, detail: str):
        super().__init__(f"{kind}: {detail}")
        self.kind = kind
        self.detail = detail


@dataclass(frozen=True)
class OllamaConfig:
    base_url: str = DEFAULT_URL
    model: str = DEFAULT_MODEL
    timeout: float = DEFAULT_TIMEOUT
    num_ctx: int = DEFAULT_NUM_CTX
    keep_alive: str = DEFAULT_KEEP_ALIVE


@dataclass(frozen=True)
class ChatResult:
    text: str
    prompt_tokens: int | None      # скільки токенів запиту обробила модель
    completion_tokens: int | None  # скільки токенів згенерувала
    seconds: float                 # тривалість запиту (для вимірювань в експерименті)
    truncated: bool                # запит міг не вміститись у num_ctx і бути обрізаним


def _positive_float(raw: str | None, default: float) -> float:
    try:
        value = float(raw) if raw not in (None, "") else default
    except ValueError:
        return default
    return value if value > 0 else default


def _positive_int(raw: str | None, default: int) -> int:
    try:
        value = int(raw) if raw not in (None, "") else default
    except ValueError:
        return default
    return value if value > 0 else default


def load_config() -> OllamaConfig:
    """Читає налаштування щоразу, тож зміна .env підхоплюється після перезапуску без правок коду."""
    base_url = (os.getenv("OLLAMA_URL") or DEFAULT_URL).strip().rstrip("/")
    return OllamaConfig(
        base_url=base_url or DEFAULT_URL,
        model=(os.getenv("OLLAMA_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL,
        timeout=_positive_float(os.getenv("OLLAMA_TIMEOUT_SECONDS"), DEFAULT_TIMEOUT),
        num_ctx=_positive_int(os.getenv("OLLAMA_NUM_CTX"), DEFAULT_NUM_CTX),
        keep_alive=(os.getenv("OLLAMA_KEEP_ALIVE") or DEFAULT_KEEP_ALIVE).strip() or DEFAULT_KEEP_ALIVE,
    )


def _check_url(base_url: str) -> None:
    parts = urlsplit(base_url)
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ProviderError("connection", f"OLLAMA_URL має бути адресою http(s), отримано {base_url!r}")


def _error_text(raw: bytes) -> str:
    """Дістає текст помилки з тіла відповіді Ollama ({"error": "..."}), а якщо там не JSON — початок тіла."""
    text = raw.decode("utf-8", errors="replace").strip()
    try:
        data = json.loads(text)
        if isinstance(data, dict) and isinstance(data.get("error"), str):
            return data["error"][:MAX_ERROR_BODY]
    except ValueError:
        pass
    return text[:MAX_ERROR_BODY]


def _is_timeout(exc: BaseException) -> bool:
    return isinstance(exc, (socket.timeout, TimeoutError))


def clean_answer(text: str) -> str:
    """Прибирає блоки <think>…</think> і зайві пробіли по краях."""
    return _THINK_RE.sub("", text or "").strip()


def chat(system: str, user_content: str, max_tokens: int, cfg: OllamaConfig | None = None) -> ChatResult:
    """
    Один запит до моделі: системна інструкція + повідомлення користувача → текст відповіді.
    temperature=0 і seed=0 — щоб однакове питання давало однакову відповідь (потрібно для експерименту).
    Кидає ProviderError.
    """
    cfg = cfg or load_config()
    _check_url(cfg.base_url)

    body = json.dumps(
        {
            "model": cfg.model,
            "stream": False,
            "keep_alive": cfg.keep_alive,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            "options": {
                "temperature": 0,
                "seed": 0,
                "num_ctx": cfg.num_ctx,
                "num_predict": max_tokens,
            },
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        f"{cfg.base_url}/api/chat",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )

    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout) as resp:  # noqa: S310 — схема перевірена в _check_url
            raw = resp.read()
    except urllib.error.HTTPError as exc:
        text = _error_text(exc.read() if exc.fp else b"")
        if exc.code == 404:
            raise ProviderError("model_missing", f"модель {cfg.model!r} не знайдено: {text}") from exc
        raise ProviderError("upstream", f"HTTP {exc.code}: {text}") from exc
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, BaseException) and _is_timeout(reason):
            raise ProviderError("timeout", f"немає відповіді за {cfg.timeout:.0f} с") from exc
        raise ProviderError("connection", f"немає з'єднання з {cfg.base_url}: {reason}") from exc
    except OSError as exc:  # у т.ч. таймаут під час читання відповіді, обрив з'єднання
        if _is_timeout(exc):
            raise ProviderError("timeout", f"немає відповіді за {cfg.timeout:.0f} с") from exc
        raise ProviderError("connection", f"помилка з'єднання з {cfg.base_url}: {exc}") from exc
    seconds = time.monotonic() - started

    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise ProviderError("bad_response", f"відповідь не є JSON: {raw[:MAX_ERROR_BODY]!r}") from exc
    if not isinstance(data, dict):
        raise ProviderError("bad_response", "очікувався JSON-об'єкт")
    if isinstance(data.get("error"), str):
        raise ProviderError("upstream", data["error"][:MAX_ERROR_BODY])
    message = data.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    if not isinstance(content, str):
        raise ProviderError("bad_response", "у відповіді немає message.content")

    prompt_tokens = data.get("prompt_eval_count") if isinstance(data.get("prompt_eval_count"), int) else None
    completion_tokens = data.get("eval_count") if isinstance(data.get("eval_count"), int) else None
    # Якщо оброблено рівно стільки токенів, скільки вміщає вікно, — запит майже напевно було обрізано.
    truncated = prompt_tokens is not None and prompt_tokens >= cfg.num_ctx - 8
    if truncated:
        logger.warning(
            "Ollama: запит (%s токенів) не вміщається у вікно num_ctx=%s і обрізаний — збільшіть OLLAMA_NUM_CTX",
            prompt_tokens, cfg.num_ctx,
        )
    return ChatResult(
        text=clean_answer(content),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        seconds=seconds,
        truncated=truncated,
    )


@dataclass(frozen=True)
class OllamaStatus:
    reachable: bool
    model_present: bool
    models: tuple[str, ...]
    error: str | None = None


def _model_matches(wanted: str, installed: str) -> bool:
    """«llama3.1:8b» == «llama3.1:8b»; «llama3.1» == «llama3.1:latest»."""
    if wanted == installed:
        return True
    if ":" not in wanted:
        return installed == f"{wanted}:latest"
    return False


def ollama_status(cfg: OllamaConfig | None = None) -> OllamaStatus:
    """Швидка перевірка при старті: чи запущено Ollama і чи завантажена потрібна модель. Не кидає винятків."""
    cfg = cfg or load_config()
    try:
        _check_url(cfg.base_url)
        req = urllib.request.Request(f"{cfg.base_url}/api/tags", headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=STATUS_TIMEOUT) as resp:  # noqa: S310
            data = json.loads(resp.read())
    except (ProviderError, OSError, ValueError) as exc:
        return OllamaStatus(False, False, (), str(exc))
    names: list[str] = []
    for item in data.get("models", []) if isinstance(data, dict) else []:
        name = item.get("name") if isinstance(item, dict) else None
        if isinstance(name, str):
            names.append(name)
    present = any(_model_matches(cfg.model, n) for n in names)
    return OllamaStatus(True, present, tuple(names))
