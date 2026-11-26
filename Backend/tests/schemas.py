import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional

from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator

from models import BookingStatus, Specialization, UserRole


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth / User ----------
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    role: UserRole
    # Для спеціалістів: «specialization» або «profession» ("Юрист", "Бухгалтер", "lawyer"…)
    specialization: Optional[Specialization] = Field(
        default=None, validation_alias=AliasChoices("specialization", "profession")
    )

    @field_validator("specialization", mode="before")
    @classmethod
    def normalize_specialization(cls, v):
        if v is None or isinstance(v, Specialization):
            return v
        text = str(v).strip().lower()
        if any(k in text for k in ("юрист", "адвокат", "lawyer", "legal")):
            return Specialization.lawyer
        if any(k in text for k in ("бухгал", "accountant", "accounting")):
            return Specialization.accountant
        return None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserRead(ORMModel):
    id: int
    email: EmailStr
    full_name: str
    role: UserRole
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    # Додатково для фронтенду, щоб одразу вести ФОПа й спеціаліста у свій кабінет
    role: Optional[UserRole] = None
    full_name: Optional[str] = None


# ---------- Service ----------
class ServiceBase(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    description: str = ""
    price: Decimal = Field(ge=0, max_digits=10, decimal_places=2)


class ServiceCreate(ServiceBase):
    pass


class ServiceUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=255)
    description: Optional[str] = None
    price: Optional[Decimal] = Field(default=None, ge=0, max_digits=10, decimal_places=2)


class ServiceRead(ServiceBase, ORMModel):
    id: int
    expert_id: int


# ---------- Booking ----------
class BookingCreate(BaseModel):
    # fop_id — з токена, expert_id — з обраної послуги
    service_id: int
    slot_datetime: datetime
    # Ескалація з ШІ-чату: короткий висновок діалогу (ФОП може відредагувати перед відправкою)
    ai_summary: Optional[str] = Field(default=None, max_length=2000)
    ai_conversation_id: Optional[int] = Field(default=None, ge=1)

    @field_validator("slot_datetime")
    @classmethod
    def must_be_future(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            v = v.replace(tzinfo=timezone.utc)
        if v <= datetime.now(timezone.utc):
            raise ValueError("slot_datetime must be in the future")
        return v


class BookingStatusUpdate(BaseModel):
    status: BookingStatus
    meeting_url: Optional[str] = Field(default=None, max_length=500, description="При підтвердженні")
    reason: Optional[str] = Field(default=None, max_length=500, description="При відхиленні")

    @field_validator("meeting_url")
    @classmethod
    def valid_url(cls, v: Optional[str]) -> Optional[str]:
        v = (v or "").strip()
        if not v:
            return None
        if not re.match(r"^https?://\S+$", v, flags=re.IGNORECASE):
            raise ValueError("Посилання має починатися з http:// або https://")
        return v


class BookingRead(ORMModel):
    id: int
    fop_id: int
    expert_id: int
    service_id: int
    slot_datetime: datetime
    status: BookingStatus
    created_at: datetime


# ---------- Message ----------
class MessageCreate(BaseModel):
    receiver_id: int
    content: str = Field(min_length=1, max_length=5000)


class MessageRead(ORMModel):
    id: int
    sender_id: int
    receiver_id: int
    content: str
    created_at: datetime


# ---------- LawArticle ----------
class LawArticleBase(BaseModel):
    title: str = Field(min_length=3, max_length=500)
    source_url: str = Field(max_length=1000)
    content: str = Field(min_length=1)


class LawArticleCreate(LawArticleBase):
    pass


class LawArticleRead(LawArticleBase, ORMModel):
    id: int


class LawArticleSearchParams(BaseModel):
    q: str = Field(min_length=2, max_length=200)
    limit: int = Field(default=10, ge=1, le=50)


# ---------- Профіль ФОПа ----------
_KVED_RE = re.compile(r"^\d{2}\.\d{2}$")


class FopProfileUpdate(BaseModel):
    tax_group: Optional[int] = Field(default=None, ge=1, le=3, description="Група єдиного податку (1–3)")
    tax_rate: Optional[Decimal] = Field(
        default=None, ge=0, le=100, max_digits=5, decimal_places=2, description="Ставка, %"
    )
    kveds: list[str] = Field(default_factory=list, max_length=20)
    has_employees: bool = False

    @field_validator("kveds")
    @classmethod
    def normalize_kveds(cls, v: list[str]) -> list[str]:
        result: list[str] = []
        for item in v:
            code = item.strip().replace(",", ".")
            if not _KVED_RE.match(code):
                raise ValueError(f"Некоректний КВЕД «{item}». Очікуваний формат — 62.01")
            if code not in result:
                result.append(code)
        return result

    @model_validator(mode="after")
    def check_consistency(self) -> "FopProfileUpdate":
        if self.tax_group == 1 and self.has_employees:
            raise ValueError("Платники єдиного податку I групи не можуть мати найманих працівників")
        if self.tax_group == 3 and self.tax_rate is not None and self.tax_rate not in (Decimal(3), Decimal(5)):
            raise ValueError("Для III групи ставка становить 5% (або 3% для платників ПДВ)")
        return self


class FopProfileRead(ORMModel):
    tax_group: Optional[int] = None
    tax_rate: Optional[Decimal] = None
    kveds: list[str] = Field(default_factory=list)
    has_employees: bool = False
    updated_at: Optional[datetime] = None


# ---------- Контекст заявки для спеціаліста ----------
class BookingContextRead(BaseModel):
    booking_id: int
    fop_name: str
    profile: Optional[FopProfileRead] = None
    ai_summary: Optional[str] = None
    ai_summary_created_at: Optional[datetime] = None


# ---------- Етап 2: трекер доходу, календар, слоти, консультації ----------
class IncomeCreate(BaseModel):
    amount: Decimal = Field(gt=0, max_digits=14, decimal_places=2, description="Сума надходження, грн")
    received_on: date
    note: str = Field(default="", max_length=255)


class IncomeRead(BaseModel):
    id: int
    amount: float
    received_on: date
    note: str
    created_at: datetime


class IncomeListRead(BaseModel):
    year: int
    total: float
    count: int
    entries: list[IncomeRead]


class LimitRead(BaseModel):
    group: Optional[int] = None
    year: int
    configured: bool
    min_wage: Optional[int] = None
    limit: Optional[int] = None
    used: float
    remaining: Optional[float] = None
    percent: Optional[float] = None
    status: str  # no_group | not_configured | ok | warning | exceeded
    message: str


class DeadlineRead(BaseModel):
    key: str
    kind: str          # eu | esv | vz | decl | employees
    badge: str
    title: str
    period: Optional[str] = None
    due_date: Optional[date] = None
    days_left: Optional[int] = None
    status: str        # done | verify | overdue | soon | planned
    done: bool
    advice: Optional[str] = None
    suggest_specialist: bool = False


class DashboardRead(BaseModel):
    today: date
    year: int
    profile: FopProfileRead
    profile_complete: bool
    limit: LimitRead
    deadlines: list[DeadlineRead]
    disclaimer: str


class DeadlineDoneUpdate(BaseModel):
    done: bool


class SlotRead(BaseModel):
    start: datetime
    end: datetime


class SlotsRead(BaseModel):
    expert_id: int
    slot_minutes: int
    timezone: str
    slots: list[SlotRead]


class BookingDetailRead(BaseModel):
    id: int
    status: BookingStatus
    slot_datetime: datetime
    slot_end: datetime
    created_at: datetime
    expert_id: int
    expert_name: str
    expert_specialization: Optional[Specialization] = None
    service_id: int
    service_title: str
    service_price: float
    meeting_url: Optional[str] = None
    rejection_reason: Optional[str] = None
    expert_summary: Optional[str] = None
    has_ai_summary: bool = False
