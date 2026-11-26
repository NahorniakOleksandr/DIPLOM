"""
news_schemas.py — Pydantic-схеми модуля новин. Не імпортує models, тож перевіряються без БД.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

import news_rules as rules

Category = Literal["law_change", "taxes", "reporting", "esv", "other"]
Importance = Literal["normal", "important"]
Kind = Literal["article", "official"]


def _http_url_or_none(value: Optional[str]) -> Optional[str]:
    value = (value or "").strip()
    if not value:
        return None
    if not rules.valid_http_url(value):
        raise ValueError("Посилання має починатися з http:// або https://")
    return value


class NewsCreate(BaseModel):
    """Стаття спеціаліста."""

    title: str = Field(min_length=rules.TITLE_MIN, max_length=rules.TITLE_MAX)
    body: str = Field(min_length=rules.BODY_MIN, max_length=rules.BODY_MAX)
    category: Category = "law_change"
    importance: Importance = "normal"
    effective_date: Optional[date] = None
    source_url: Optional[str] = Field(default=None, max_length=1000, description="Посилання на закон або роз'яснення")

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v):
        return rules.clean_text(v) if isinstance(v, str) else v

    @field_validator("body", mode="before")
    @classmethod
    def _body(cls, v):
        return rules.clean_multiline(v) if isinstance(v, str) else v

    @field_validator("source_url")
    @classmethod
    def _url(cls, v):
        return _http_url_or_none(v)


class NewsUpdate(BaseModel):
    """Часткове оновлення: змінюються лише передані поля (model_fields_set); effective_date/source_url можна очистити."""

    title: Optional[str] = Field(default=None, min_length=rules.TITLE_MIN, max_length=rules.TITLE_MAX)
    body: Optional[str] = Field(default=None, min_length=rules.BODY_MIN, max_length=rules.BODY_MAX)
    category: Optional[Category] = None
    importance: Optional[Importance] = None
    effective_date: Optional[date] = None
    source_url: Optional[str] = Field(default=None, max_length=1000)

    @field_validator("title", mode="before")
    @classmethod
    def _title(cls, v):
        return rules.clean_text(v) if isinstance(v, str) else v

    @field_validator("body", mode="before")
    @classmethod
    def _body(cls, v):
        return rules.clean_multiline(v) if isinstance(v, str) else v

    @field_validator("source_url")
    @classmethod
    def _url(cls, v):
        return _http_url_or_none(v)

    @model_validator(mode="after")
    def _not_empty(self):
        if not self.model_fields_set:
            raise ValueError("Передайте хоча б одне поле для зміни")
        for required in ("title", "body", "category", "importance"):
            if required in self.model_fields_set and getattr(self, required) is None:
                raise ValueError(f"Поле «{required}» не можна очистити")
        return self


class NewsItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: Kind
    title: str
    summary: str
    category: Category
    category_label: str
    importance: Importance
    effective_date: Optional[date] = None
    author_id: Optional[int] = None
    author_name: Optional[str] = None
    author_specialization: Optional[str] = None
    source_name: Optional[str] = None
    source_url: Optional[str] = None
    published_at: datetime
    updated_at: datetime
    edited: bool = False       # статтю редагували після публікації
    is_read: bool = False
    is_mine: bool = False


class NewsDetailRead(NewsItemRead):
    body: str


class NewsUnreadRead(BaseModel):
    unread: int
    important_unread: int


class NewsSourceRead(BaseModel):
    name: str
    url: str
    filtered: bool
    last_attempt_at: Optional[datetime] = None
    last_success_at: Optional[datetime] = None
    last_error: Optional[str] = None
    last_fetched: int = 0
    last_added: int = 0


class NewsSyncSourceResult(BaseModel):
    name: str
    ok: bool
    fetched: int = 0
    matched: int = 0
    added: int = 0
    error: Optional[str] = None


class NewsSyncResult(BaseModel):
    configured: bool                # чи задано NEWS_FEEDS
    added_total: int
    sources: list[NewsSyncSourceResult]
