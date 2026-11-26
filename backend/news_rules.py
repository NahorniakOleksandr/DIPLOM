"""
news_rules.py — чисті правила модуля новин (без імпорту models і без БД, тож легко тестуються).

Тут: довідники категорій, очищення тексту, ліміти публікацій, добір офіційних новин за ключовими словами,
визначення категорії. Мережі й БД цей модуль не торкається.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from typing import Iterable, Optional
from urllib.parse import urlparse

# ---------- Довідники ----------
KIND_ARTICLE = "article"    # стаття спеціаліста
KIND_OFFICIAL = "official"  # підтягнуто з офіційної стрічки
KINDS = (KIND_ARTICLE, KIND_OFFICIAL)

NORMAL = "normal"
IMPORTANT = "important"
IMPORTANCES = (NORMAL, IMPORTANT)

CATEGORY_LABEL: dict[str, str] = {
    "law_change": "Зміни в законах",
    "taxes": "Податки",
    "reporting": "Звітність",
    "esv": "ЄСВ і зарплата",
    "other": "Інше",
}
CATEGORIES = tuple(CATEGORY_LABEL)
DEFAULT_CATEGORY = "other"

# ---------- Ліміти ----------
TITLE_MIN, TITLE_MAX = 5, 200
BODY_MIN, BODY_MAX = 20, 10_000
SUMMARY_MAX = 300

MAX_IMPORTANT_PER_DAY = 3   # «спливаюче вікно» бачать усі, тож ним не можна зловживати
MAX_ARTICLES_PER_DAY = 15
UNREAD_WINDOW_DAYS = 14     # лічильник непрочитаних і «позначити все» враховують лише свіже
POPUP_WINDOW_DAYS = 30      # важливе повідомлення спливає, доки його не позначили прочитаним (до 30 днів)
POPUP_MAX_ITEMS = 5

# Ключові слова для відбору офіційних новин, що стосуються ФОП і бухгалтерії (регістр не важливий).
DEFAULT_KEYWORDS: tuple[str, ...] = (
    "податк", "єдин", "фоп", "підприємц", "єсв", "внесок", "військов", "збір", "ставк",
    "декларац", "звітн", "рро", "пдв", "мінімальн", "заробітн", "бухгалтер",
    "ліміт", "штраф", "перевірк", "квед", "пільг", "нарахуван",
)

# Підказки для категорії: перший збіг виграє, порядок важливий.
_CATEGORY_HINTS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("esv", ("єсв", "єдиний внесок", "заробітн", "мінімальн", "працівник", "відпуст", "лікарнян")),
    ("reporting", ("декларац", "звітн", "звіт ", "рро", "прро", "термін подання", "граничн")),
    ("taxes", ("податк", "ставк", "пдв", "єдин", "військов", "збір", "знижк")),
    ("law_change", ("закон", "постанов", "наказ", "кодекс", "набирає чинності", "зміни до", "законопроєкт")),
)


@dataclass(frozen=True)
class Violation:
    code: str
    message: str


# ---------- Текст ----------
class _TextExtractor(HTMLParser):
    """Лишає лише текст: теги викидаються, блочні елементи дають переноси рядків."""

    _BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "table"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self._skip += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self._skip = max(0, self._skip - 1)
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self._skip:
            self.parts.append(data)


def strip_html(raw: Optional[str]) -> str:
    """HTML із зовнішньої стрічки → безпечний простий текст (абзаци зберігаються порожнім рядком)."""
    if not raw:
        return ""
    parser = _TextExtractor()
    try:
        parser.feed(raw)
        parser.close()
        text = "".join(parser.parts)
    except Exception:  # зламана розмітка: лишаємо те, що є, без тегів
        text = re.sub(r"<[^>]*>", " ", raw)
    text = html.unescape(text).replace("\xa0", " ").replace("\r", "")
    return clean_multiline(text)


def clean_text(value: Optional[str]) -> str:
    """Однорядковий текст (заголовок): пробіли зводяться до одного."""
    return re.sub(r"\s+", " ", (value or "")).strip()


def clean_multiline(value: Optional[str]) -> str:
    """Багаторядковий текст: прибирає хвостові пробіли, не більше однієї порожньої лінії поспіль."""
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def make_summary(body: str, limit: int = SUMMARY_MAX) -> str:
    """Короткий анонс для списку: перші речення без обрізання посеред слова."""
    flat = re.sub(r"\s+", " ", body or "").strip()
    if len(flat) <= limit:
        return flat
    cut = flat[:limit]
    # Краще закінчити на кінці речення, інакше — на пробілі
    sentence_end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if sentence_end >= limit * 0.5:
        return cut[: sentence_end + 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > 0 else cut).rstrip(" ,;:-—") + "…"


def valid_http_url(value: Optional[str], max_len: int = 1000) -> bool:
    """Лише http(s) із хостом: javascript: та data: у посилання потрапити не можуть."""
    if not value or len(value) > max_len:
        return False
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc) and " " not in value


# ---------- Офіційні новини ----------
def matches_keywords(text: str, keywords: Iterable[str]) -> bool:
    low = (text or "").lower()
    return any(k and k.lower() in low for k in keywords)


def guess_category(title: str, text: str = "", default: str = DEFAULT_CATEGORY) -> str:
    low = f"{title} {text}".lower()
    for category, hints in _CATEGORY_HINTS:
        if any(h in low for h in hints):
            return category
    return default


def parse_keywords(raw: Optional[str]) -> tuple[str, ...]:
    """NEWS_KEYWORDS=слово1,слово2 → кортеж; порожнє значення — типовий список."""
    items = tuple(k.strip().lower() for k in (raw or "").split(",") if k.strip())
    return items or DEFAULT_KEYWORDS


def is_fresh(published_at: datetime, now: datetime, max_age_days: int) -> bool:
    """Чи не старіша новина за допустимий вік (майбутні дати до доби вперед вважаємо свіжими)."""
    return now - timedelta(days=max_age_days) <= published_at <= now + timedelta(days=1)


# ---------- Ліміти публікацій ----------
def check_publish_quota(
    importance: str, articles_last_24h: int, important_last_24h: int,
) -> Optional[Violation]:
    """None — можна публікувати. Рахуються статті цього автора за останню добу."""
    if articles_last_24h >= MAX_ARTICLES_PER_DAY:
        return Violation(
            "articles_quota",
            f"Забагато публікацій за добу (не більше {MAX_ARTICLES_PER_DAY}). Спробуйте пізніше.",
        )
    if importance == IMPORTANT and important_last_24h >= MAX_IMPORTANT_PER_DAY:
        return Violation(
            "important_quota",
            f"Важливі повідомлення з вікном можна публікувати не більше {MAX_IMPORTANT_PER_DAY} на добу. "
            "Опублікуйте як звичайну новину.",
        )
    return None


def as_aware_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
