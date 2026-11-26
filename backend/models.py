import enum
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    JSON, Boolean, CheckConstraint, Date, DateTime, Enum, ForeignKey, Index, Integer, Numeric, String, Text,
    Time, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, enum.Enum):
    fop = "fop"
    expert = "expert"


class BookingStatus(str, enum.Enum):
    """
    Потік: pending (очікує підтвердження) → confirmed (підтверджено) → completed (завершено).
    Альтернативи: rejected (відхилив спеціаліст), cancelled (скасував ФОП).
    paid лишився для сумісності зі старим ендпоінтом /fop/bookings/{id}/pay.
    Усі значення ≤ 9 символів — вміщаються в існуючу колонку VARCHAR(9).
    PostgreSQL з native enum: ALTER TYPE booking_status ADD VALUE 'confirmed' (так само rejected, cancelled).
    """
    pending = "pending"
    paid = "paid"
    completed = "completed"
    confirmed = "confirmed"
    rejected = "rejected"
    cancelled = "cancelled"


class Specialization(str, enum.Enum):
    accountant = "accountant"
    lawyer = "lawyer"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    services: Mapped[list["Service"]] = relationship(
        back_populates="expert", cascade="all, delete-orphan"
    )
    expert_profile: Mapped[Optional["ExpertProfile"]] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )

    # Зручні читання для публічної картки спеціаліста (pydantic from_attributes)
    @property
    def specialization(self) -> Optional[Specialization]:
        return self.expert_profile.specialization if self.expert_profile else None

    @property
    def headline(self) -> str:
        return (self.expert_profile.headline if self.expert_profile else "") or ""

    @property
    def bio(self) -> str:
        return (self.expert_profile.bio if self.expert_profile else "") or ""


class Service(Base):
    __tablename__ = "services"
    __table_args__ = (CheckConstraint("price >= 0", name="ck_service_price_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    expert_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2))

    expert: Mapped["User"] = relationship(back_populates="services")


class Booking(Base):
    __tablename__ = "bookings"
    __table_args__ = (Index("ix_bookings_expert_slot", "expert_id", "slot_datetime"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    fop_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expert_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id", ondelete="RESTRICT"))
    slot_datetime: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[BookingStatus] = mapped_column(
        Enum(BookingStatus, name="booking_status"), default=BookingStatus.pending, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    fop: Mapped["User"] = relationship(foreign_keys=[fop_id])
    expert: Mapped["User"] = relationship(foreign_keys=[expert_id])
    service: Mapped["Service"] = relationship()


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_pair_created", "sender_id", "receiver_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    receiver_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    sender: Mapped["User"] = relationship(foreign_keys=[sender_id])
    receiver: Mapped["User"] = relationship(foreign_keys=[receiver_id])


class LawArticle(Base):
    __tablename__ = "law_articles"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(500), index=True)
    source_url: Mapped[str] = mapped_column(String(1000))
    content: Mapped[str] = mapped_column(Text)


# =====================================================================
# Профіль ФОПа та ШІ-помічник
# Нові таблиці створюються через create_all — існуючі таблиці не змінюються.
# =====================================================================
class FopProfile(Base):
    """Параметри підприємця, що передаються в контекст ШІ та фахівцю."""

    __tablename__ = "fop_profiles"
    __table_args__ = (
        CheckConstraint("tax_group IS NULL OR tax_group IN (1, 2, 3)", name="ck_fop_profile_group"),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    tax_group: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Ставка у відсотках (для III групи — 3 або 5; для I/II — відсоток від ПМ/МЗП, якщо відомий)
    tax_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(5, 2), nullable=True)
    kveds: Mapped[list] = mapped_column(JSON, default=list)  # ["62.01", "63.11"]
    has_employees: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class AiConversation(Base):
    __tablename__ = "ai_conversations"
    __table_args__ = (Index("ix_ai_conv_user_updated", "user_id", "updated_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200), default="Нова розмова")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    messages: Mapped[list["AiMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan", order_by="AiMessage.id"
    )


class AiMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("ai_conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # "user" | "assistant"
    content: Mapped[str] = mapped_column(Text)
    # Лише для відповідей помічника: яку норму використано
    found: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    article_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # без FK: статтю можуть видалити
    article_title: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    conversation: Mapped["AiConversation"] = relationship(back_populates="messages")


class BookingAiContext(Base):
    """Короткий висновок діалогу з ШІ, прикріплений до заявки на консультацію."""

    __tablename__ = "booking_ai_contexts"

    id: Mapped[int] = mapped_column(primary_key=True)
    booking_id: Mapped[int] = mapped_column(
        ForeignKey("bookings.id", ondelete="CASCADE"), unique=True, index=True
    )
    conversation_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("ai_conversations.id", ondelete="SET NULL"), nullable=True
    )
    summary: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# =====================================================================
# Етап 2: трекер доходу, календар, профіль і розклад спеціаліста
# (нові таблиці; існуючі не змінюються)
# =====================================================================
class IncomeEntry(Base):
    """Надходження ФОПа — основа особистого лічильника ліміту доходу."""

    __tablename__ = "income_entries"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_income_amount_positive"),
        Index("ix_income_user_date", "user_id", "received_on"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    received_on: Mapped[date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DeadlineCompletion(Base):
    """Позначка «виконано» для податкового строку (ключ — з tax_rules, напр. eu-2026Q3)."""

    __tablename__ = "deadline_completions"
    __table_args__ = (UniqueConstraint("user_id", "deadline_key", name="uq_deadline_user_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    deadline_key: Mapped[str] = mapped_column(String(64))
    completed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ExpertProfile(Base):
    __tablename__ = "expert_profiles"
    __table_args__ = (
        CheckConstraint("slot_minutes BETWEEN 15 AND 240", name="ck_expert_slot_minutes"),
    )

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    specialization: Mapped[Optional[Specialization]] = mapped_column(
        Enum(Specialization, name="specialization"), nullable=True, index=True
    )
    headline: Mapped[str] = mapped_column(String(255), default="")
    bio: Mapped[str] = mapped_column(Text, default="")
    experience_years: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    slot_minutes: Mapped[int] = mapped_column(Integer, default=60)

    user: Mapped["User"] = relationship(back_populates="expert_profile")


class ExpertAvailability(Base):
    """Робоче вікно спеціаліста в місцевому часі (Europe/Kyiv): день тижня + години."""

    __tablename__ = "expert_availability"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_avail_weekday"),
        CheckConstraint("end_time > start_time", name="ck_avail_time_order"),
        Index("ix_avail_expert_weekday", "expert_id", "weekday"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    expert_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    weekday: Mapped[int] = mapped_column(Integer)  # 0 = понеділок
    start_time: Mapped[time] = mapped_column(Time)
    end_time: Mapped[time] = mapped_column(Time)


class BookingDetail(Base):
    """Додаткові дані консультації: посилання на зустріч, причина відхилення, нотатки й підсумок спеціаліста."""

    __tablename__ = "booking_details"

    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), primary_key=True)
    meeting_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    rejection_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    expert_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)    # приватні, ФОП не бачить
    expert_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # підсумок для ФОПа
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


# =====================================================================
# Етап 4: новини (статті спеціалістів і офіційні стрічки)
# Лише нові таблиці — існуючі не змінюються.
# =====================================================================
class NewsPost(Base):
    """Новина: стаття спеціаліста (kind='article') або запис із офіційної стрічки (kind='official')."""

    __tablename__ = "news_posts"
    __table_args__ = (
        Index("ix_news_published", "published_at", "id"),
        Index("ix_news_importance_published", "importance", "published_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(10), index=True)            # article | official
    title: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str] = mapped_column(String(320), default="")        # анонс для списку
    body: Mapped[str] = mapped_column(Text)                              # простий текст (без HTML)
    category: Mapped[str] = mapped_column(String(12), default="other", index=True)
    importance: Mapped[str] = mapped_column(String(10), default="normal")  # normal | important
    effective_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)  # коли зміна набирає чинності
    author_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True)  # sha1 для дедуплікації
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    author: Mapped[Optional["User"]] = relationship(foreign_keys=[author_id])


class NewsRead(Base):
    """Позначка «користувач прочитав / підтвердив повідомлення» — за нею гасне спливаюче вікно."""

    __tablename__ = "news_reads"
    __table_args__ = (UniqueConstraint("news_id", "user_id", name="uq_news_read"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    news_id: Mapped[int] = mapped_column(ForeignKey("news_posts.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class NewsFeedState(Base):
    """Стан останнього оновлення кожної офіційної стрічки — щоб помилки було видно, а не ховати."""

    __tablename__ = "news_feed_states"

    url: Mapped[str] = mapped_column(String(500), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    last_attempt_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    last_fetched: Mapped[int] = mapped_column(Integer, default=0)   # записів у стрічці
    last_added: Mapped[int] = mapped_column(Integer, default=0)     # нових збережено
