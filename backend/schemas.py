from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from models import BookingStatus, UserRole


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth / User ----------
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=255)
    role: UserRole


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
