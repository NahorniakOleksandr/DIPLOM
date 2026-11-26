"""
FastAPI-бекенд платформи консультацій «ФОП ↔ спеціаліст».

Запуск:
    pip install -r requirements.txt
    export SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
    uvicorn main:app --reload

Swagger UI: http://127.0.0.1:8000/docs  (кнопка Authorize приймає email у полі username)
"""
import base64
import hashlib
import logging
import os
import threading
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Annotated, Iterator, Optional

import jwt
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy import and_, case, desc, event, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

import schemas
from ai_service import check_provider_at_startup, create_ai_router
from database import IS_SQLITE, SessionLocal, engine, get_db, init_db
from expert_cabinet import create_expert_cabinet_router
from news_api import create_news_router, start_news_sync
from fop_cabinet import (
    FREED_STATUSES,
    backfill_expert_profiles,
    create_fop_cabinet_router,
    ensure_expert_profile,
    load_schedule,
)
from models import (
    AiConversation,
    Booking,
    BookingAiContext,
    BookingStatus,
    ExpertProfile,
    FopProfile,
    LawArticle,
    Message,
    Service,
    Specialization,
    User,
    UserRole,
)
from scheduling import MIN_NOTICE_MINUTES, is_valid_slot

logger = logging.getLogger("fop_platform")

# =====================================================================
# Конфігурація
# =====================================================================
SECRET_KEY = os.getenv("SECRET_KEY", "")
if not SECRET_KEY:
    SECRET_KEY = "dev-insecure-secret-change-me"
    logger.warning(
        "SECRET_KEY не задано — використано небезпечний ключ для розробки. "
        "Для продакшну обов'язково задайте змінну оточення SECRET_KEY."
    )

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]
SEED_EXPERT_PASSWORD = os.getenv("SEED_EXPERT_PASSWORD", "Expert12345")


# =====================================================================
# SQLite: Unicode-коректний lower() для регістронезалежного пошуку кирилиці
# (вбудований lower() у SQLite працює лише з ASCII).
# =====================================================================
if IS_SQLITE:

    @event.listens_for(engine, "connect")
    def _sqlite_unicode_lower(dbapi_conn, _record) -> None:
        dbapi_conn.create_function(
            "lower", 1, lambda v: v.lower() if isinstance(v, str) else v, deterministic=True
        )


# =====================================================================
# Безпека: хешування паролів та JWT
# =====================================================================
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def _prehash(password: str) -> str:
    """
    bcrypt обробляє максимум 72 байти (кирилиця — 2 байти на символ, тож ліміт
    легко перевищити). SHA-256 + base64 дає рядок фіксованої довжини (44 символи)
    без нульових байтів — пароль не обрізається мовчки.
    """
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")


def hash_password(password: str) -> str:
    return pwd_context.hash(_prehash(password))


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(_prehash(password), password_hash)
    except ValueError:  # пошкоджений/невідомий формат хешу
        return False


# Хеш-пустушка: перевірка виконується навіть для неіснуючого email,
# щоб час відповіді не видавав, чи зареєстрований користувач.
_DUMMY_HASH = hash_password("dummy-password-for-timing")


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),  # за специфікацією JWT sub — рядок
        "role": user.role.value,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")

DbDep = Annotated[Session, Depends(get_db)]


def get_current_user(token: Annotated[str, Depends(oauth2_scheme)], db: DbDep) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Недійсний або прострочений токен",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "sub"]},
        )
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise credentials_error

    user = db.get(User, user_id)
    if user is None:
        raise credentials_error
    return user


def require_role(*allowed: UserRole):
    """RBAC: роль береться з БД (а не з токена), тож зміна ролі діє одразу."""

    def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in allowed:
            names = ", ".join(r.value for r in allowed)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Недостатньо прав. Доступно для ролей: {names}",
            )
        return user

    return checker


CurrentUser = Annotated[User, Depends(get_current_user)]
FopUser = Annotated[User, Depends(require_role(UserRole.fop))]
ExpertUser = Annotated[User, Depends(require_role(UserRole.expert))]


# =====================================================================
# Допоміжні функції
# =====================================================================
def as_utc(dt: datetime) -> datetime:
    """SQLite повертає naive-datetime (у UTC) — приводимо до aware."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def normalize_slot(dt: datetime) -> datetime:
    """Слот зберігається в UTC з точністю до хвилини — інакше 10:00:00 і 10:00:01 були б «різними»."""
    return as_utc(dt).replace(second=0, microsecond=0)


_SQLITE_BOOKING_LOCK = threading.Lock()


@contextmanager
def booking_critical_section(db: Session, expert_id: int) -> Iterator[None]:
    """
    Серіалізує бронювання одного спеціаліста, щоб «перевірка → вставка» була атомарною.

    * PostgreSQL (та інші СУБД з row-level locks): SELECT ... FOR UPDATE по рядку
      спеціаліста. Конкурентні транзакції чекають, поки перша зробить COMMIT, і
      після цього бачать уже збережений запис. Працює між процесами/воркерами.
    * SQLite: FOR UPDATE не підтримується, тому використовується процесний lock
      (достатньо для одного процесу; для кількох воркерів потрібна PostgreSQL).

    Блокування PostgreSQL знімається при commit()/rollback() у тілі with-блоку.
    """
    if IS_SQLITE:
        with _SQLITE_BOOKING_LOCK:
            yield
    else:
        db.execute(select(User.id).where(User.id == expert_id).with_for_update())
        yield


# Локальні схеми відповідей (щоб не віддавати ФОПам email спеціалістів)
class ExpertPublic(schemas.ORMModel):
    id: int
    full_name: str
    specialization: Optional[Specialization] = None
    headline: str = ""
    bio: str = ""
    services: list[schemas.ServiceRead] = []


class ChatPeer(BaseModel):
    id: int
    full_name: str
    role: UserRole
    last_message_at: datetime


# =====================================================================
# 1. Авторизація
# =====================================================================
auth_router = APIRouter(prefix="/auth", tags=["auth"])


def authenticate(db: Session, email: str, password: str) -> Optional[User]:
    user = db.scalar(select(User).where(User.email == email.strip().lower()))
    password_ok = verify_password(password, user.password_hash if user else _DUMMY_HASH)
    return user if (user is not None and password_ok) else None


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Невірний email або пароль",
        headers={"WWW-Authenticate": "Bearer"},
    )


@auth_router.post("/register", response_model=schemas.UserRead, status_code=status.HTTP_201_CREATED)
def register(payload: schemas.UserCreate, db: DbDep):
    email = payload.email.strip().lower()
    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Користувач із таким email уже існує")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role=payload.role,
    )
    db.add(user)
    try:
        if user.role == UserRole.expert:
            db.flush()  # отримуємо user.id
            ensure_expert_profile(db, user.id, payload.specialization)  # профіль + типовий розклад
        db.commit()
    except IntegrityError:  # гонка: паралельна реєстрація з тим самим email
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Користувач із таким email уже існує")
    return user


@auth_router.post("/login", response_model=schemas.Token)
def login(payload: schemas.UserLogin, db: DbDep):
    user = authenticate(db, payload.email, payload.password)
    if user is None:
        raise _invalid_credentials()
    return schemas.Token(access_token=create_access_token(user), role=user.role, full_name=user.full_name)


@auth_router.post("/token", response_model=schemas.Token, include_in_schema=True)
def login_for_swagger(form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DbDep):
    """OAuth2 form-login (username = email) — для кнопки Authorize у Swagger UI."""
    user = authenticate(db, form.username, form.password)
    if user is None:
        raise _invalid_credentials()
    return schemas.Token(access_token=create_access_token(user))


@auth_router.get("/me", response_model=schemas.UserRead)
def me(user: CurrentUser):
    return user


# =====================================================================
# 2. Кабінет спеціаліста: послуги та прайс
# =====================================================================
expert_router = APIRouter(prefix="/expert", tags=["expert cabinet"])


def _get_own_service(db: Session, expert: User, service_id: int) -> Service:
    service = db.scalar(
        select(Service).where(Service.id == service_id, Service.expert_id == expert.id)
    )
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Послугу не знайдено")
    return service


@expert_router.post("/services", response_model=schemas.ServiceRead, status_code=status.HTTP_201_CREATED)
def create_service(payload: schemas.ServiceCreate, db: DbDep, expert: ExpertUser):
    service = Service(
        expert_id=expert.id,
        title=payload.title.strip(),
        description=payload.description,
        price=payload.price,
    )
    db.add(service)
    db.commit()
    db.refresh(service)
    return service


@expert_router.get("/services", response_model=list[schemas.ServiceRead])
def list_my_services(db: DbDep, expert: ExpertUser):
    return list(
        db.scalars(select(Service).where(Service.expert_id == expert.id).order_by(Service.id))
    )


@expert_router.patch("/services/{service_id}", response_model=schemas.ServiceRead)
def update_service(service_id: int, payload: schemas.ServiceUpdate, db: DbDep, expert: ExpertUser):
    service = _get_own_service(db, expert, service_id)

    # Колонки не nullable, тому явні null ігноруємо
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Немає полів для оновлення")

    if "title" in changes:
        changes["title"] = changes["title"].strip()
    for field, value in changes.items():
        setattr(service, field, value)

    db.commit()
    db.refresh(service)
    return service


@expert_router.delete("/services/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(service_id: int, db: DbDep, expert: ExpertUser) -> None:
    service = _get_own_service(db, expert, service_id)

    has_bookings = db.scalar(select(func.count(Booking.id)).where(Booking.service_id == service.id))
    if has_bookings:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Не можна видалити послугу, за якою вже є записи. Змініть її опис або ціну.",
        )
    db.delete(service)
    try:
        db.commit()
    except IntegrityError:  # гонка: запис створили між перевіркою і видаленням (FK RESTRICT)
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Не можна видалити послугу, за якою вже є записи")


@expert_router.get("/bookings", response_model=list[schemas.BookingRead])
def list_expert_bookings(
    db: DbDep,
    expert: ExpertUser,
    status_filter: Annotated[Optional[BookingStatus], Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    stmt = select(Booking).where(Booking.expert_id == expert.id)
    if status_filter is not None:
        stmt = stmt.where(Booking.status == status_filter)
    stmt = stmt.order_by(Booking.slot_datetime, Booking.id).limit(limit).offset(offset)
    return list(db.scalars(stmt))


# Зміна статусу заявки (PATCH /expert/bookings/{id}/status), картка консультації, розклад і профіль
# живуть в expert_cabinet.py; правила переходів — у booking_rules.py.


# =====================================================================
# 3. Кабінет ФОПа: пошук, прайси, запис, оплата
# =====================================================================
fop_router = APIRouter(prefix="/fop", tags=["fop cabinet"])


@fop_router.get("/experts", response_model=list[ExpertPublic])
def search_experts(
    db: DbDep,
    fop: FopUser,
    q: Annotated[
        Optional[str],
        Query(min_length=2, max_length=200, description="Пошук за іменем, назвою або описом послуги"),
    ] = None,
    max_price: Annotated[
        Optional[Decimal], Query(ge=0, description="Є хоча б одна послуга не дорожча за цю ціну")
    ] = None,
    specialization: Annotated[
        Optional[Specialization], Query(description="accountant (бухгалтер) або lawyer (юрист)")
    ] = None,
    with_services: Annotated[
        bool, Query(description="Лише спеціалісти, у яких є хоча б одна послуга (до них можна записатись)")
    ] = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    stmt = select(User).where(User.role == UserRole.expert)

    term = q.strip() if q else ""
    if term:
        stmt = stmt.where(
            or_(
                User.full_name.icontains(term, autoescape=True),
                User.services.any(
                    or_(
                        Service.title.icontains(term, autoescape=True),
                        Service.description.icontains(term, autoescape=True),
                    )
                ),
            )
        )
    if max_price is not None:
        stmt = stmt.where(User.services.any(Service.price <= max_price))
    if specialization is not None:
        stmt = stmt.where(User.expert_profile.has(ExpertProfile.specialization == specialization))
    if with_services:
        stmt = stmt.where(User.services.any())

    stmt = (
        stmt.options(selectinload(User.services), selectinload(User.expert_profile))
        .order_by(User.full_name, User.id)
        .limit(limit)
        .offset(offset)
    )
    return list(db.scalars(stmt))


def _get_expert_or_404(db: Session, expert_id: int) -> User:
    expert = db.scalar(
        select(User)
        .where(User.id == expert_id, User.role == UserRole.expert)
        .options(selectinload(User.services), selectinload(User.expert_profile))
    )
    if expert is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Спеціаліста не знайдено")
    return expert


@fop_router.get("/experts/{expert_id}", response_model=ExpertPublic)
def get_expert(expert_id: int, db: DbDep, fop: FopUser):
    return _get_expert_or_404(db, expert_id)


@fop_router.get("/experts/{expert_id}/services", response_model=list[schemas.ServiceRead])
def get_expert_price_list(expert_id: int, db: DbDep, fop: FopUser):
    expert = _get_expert_or_404(db, expert_id)
    return sorted(expert.services, key=lambda s: (s.price, s.id))


@fop_router.post("/bookings", response_model=schemas.BookingRead, status_code=status.HTTP_201_CREATED)
def create_booking(payload: schemas.BookingCreate, db: DbDep, fop: FopUser):
    slot = normalize_slot(payload.slot_datetime)
    if slot <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Час консультації має бути в майбутньому")

    service = db.get(Service, payload.service_id)
    if service is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Послугу не знайдено")

    # Ескалація з ШІ-чату: діалог має належати цьому ФОПу
    ai_summary = (payload.ai_summary or "").strip()
    if payload.ai_conversation_id is not None:
        owns_conversation = db.scalar(
            select(AiConversation.id).where(
                AiConversation.id == payload.ai_conversation_id, AiConversation.user_id == fop.id
            )
        )
        if owns_conversation is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Розмову з ШІ-помічником не знайдено")

    # Час має бути реальним слотом із розкладу спеціаліста й не ближче ніж за MIN_NOTICE_MINUTES
    windows, slot_minutes = load_schedule(db, service.expert_id)
    if not windows:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Спеціаліст ще не налаштував розклад")
    if not is_valid_slot(slot, windows, slot_minutes):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Цей час недоступний для запису. Оберіть вільний слот зі списку.",
        )
    if slot < datetime.now(timezone.utc) + timedelta(minutes=MIN_NOTICE_MINUTES):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Записатися можна щонайменше за {MIN_NOTICE_MINUTES} хвилин до початку",
        )

    # Перевірка зайнятості слота і вставка виконуються в одній критичній секції:
    # конкурентний запит на той самий слот дочекається завершення цього і отримає 409.
    with booking_critical_section(db, service.expert_id):
        slot_taken = db.scalar(
            select(Booking.id)
            .where(
                Booking.expert_id == service.expert_id,
                Booking.slot_datetime == slot,
                Booking.status.notin_(FREED_STATUSES),  # відхилені/скасовані звільняють слот
            )
            .limit(1)
        )
        if slot_taken is not None:
            db.rollback()  # знімає row-lock у PostgreSQL
            raise HTTPException(status.HTTP_409_CONFLICT, "Цей час у спеціаліста вже зайнятий")

        booking = Booking(
            fop_id=fop.id,
            expert_id=service.expert_id,
            service_id=service.id,
            slot_datetime=slot,
            status=BookingStatus.pending,
        )
        db.add(booking)
        try:
            if ai_summary:
                db.flush()  # отримуємо booking.id
                db.add(
                    BookingAiContext(
                        booking_id=booking.id,
                        conversation_id=payload.ai_conversation_id,
                        summary=ai_summary,
                    )
                )
            db.commit()
        except IntegrityError:  # напр., послугу видалили між перевіркою і вставкою
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT, "Не вдалося створити запис. Спробуйте ще раз.")
    return booking


@fop_router.get("/bookings", response_model=list[schemas.BookingRead])
def list_fop_bookings(
    db: DbDep,
    fop: FopUser,
    status_filter: Annotated[Optional[BookingStatus], Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    stmt = select(Booking).where(Booking.fop_id == fop.id)
    if status_filter is not None:
        stmt = stmt.where(Booking.status == status_filter)
    stmt = stmt.order_by(Booking.slot_datetime, Booking.id).limit(limit).offset(offset)
    return list(db.scalars(stmt))


def _profile_read(profile: Optional[FopProfile]) -> schemas.FopProfileRead:
    return schemas.FopProfileRead.model_validate(profile) if profile else schemas.FopProfileRead()


@fop_router.get("/profile", response_model=schemas.FopProfileRead)
def get_fop_profile(db: DbDep, fop: FopUser):
    """Профіль підприємця. Якщо ще не заповнений — повертає порожні значення (не 404)."""
    return _profile_read(db.get(FopProfile, fop.id))


@fop_router.put("/profile", response_model=schemas.FopProfileRead)
def save_fop_profile(payload: schemas.FopProfileUpdate, db: DbDep, fop: FopUser):
    """Зберігає групу, ставку, КВЕДи та наявність працівників (повна заміна)."""
    profile = db.get(FopProfile, fop.id)
    if profile is None:
        profile = FopProfile(user_id=fop.id)
        db.add(profile)
    profile.tax_group = payload.tax_group
    profile.tax_rate = payload.tax_rate
    profile.kveds = payload.kveds
    profile.has_employees = payload.has_employees
    try:
        db.commit()
    except IntegrityError:  # гонка: паралельне створення профілю
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Не вдалося зберегти профіль. Спробуйте ще раз.")
    db.refresh(profile)
    return _profile_read(profile)


@fop_router.post("/bookings/{booking_id}/pay", response_model=schemas.BookingRead)
def pay_booking(booking_id: int, db: DbDep, fop: FopUser):
    """Імітація оплати: pending → paid. Реального платіжного шлюзу тут немає."""
    booking = db.scalar(select(Booking).where(Booking.id == booking_id, Booking.fop_id == fop.id))
    if booking is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Запис не знайдено")

    if as_utc(booking.slot_datetime) <= datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_409_CONFLICT, "Час консультації вже минув")

    current_status = booking.status.value
    # Атомарний перехід: UPDATE спрацює лише якщо статус досі 'pending' —
    # подвійний клік/повторний запит не «оплатить» двічі.
    result = db.execute(
        update(Booking)
        .where(Booking.id == booking_id, Booking.status == BookingStatus.pending)
        .values(status=BookingStatus.paid)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:  # type: ignore[attr-defined]
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Оплата неможлива: поточний статус запису — '{current_status}'",
        )

    db.commit()
    db.refresh(booking)
    return booking


# =====================================================================
# 4. Чат між ФОПом і спеціалістом
# =====================================================================
chat_router = APIRouter(prefix="/chat", tags=["chat"])


def _get_chat_peer(db: Session, me: User, peer_id: int) -> User:
    peer = db.get(User, peer_id)
    if peer is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Користувача не знайдено")
    if peer.role == me.role:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Чат доступний лише між ФОПом і спеціалістом"
        )
    return peer


@chat_router.post("/messages", response_model=schemas.MessageRead, status_code=status.HTTP_201_CREATED)
def send_message(payload: schemas.MessageCreate, db: DbDep, me: CurrentUser):
    peer = _get_chat_peer(db, me, payload.receiver_id)

    content = payload.content.strip()
    if not content:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Повідомлення не може бути порожнім")

    message = Message(sender_id=me.id, receiver_id=peer.id, content=content)
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


@chat_router.get("/messages/{peer_id}", response_model=list[schemas.MessageRead])
def get_history(
    peer_id: int,
    db: DbDep,
    me: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before_id: Annotated[
        Optional[int], Query(ge=1, description="Курсор: повернути повідомлення з id меншим за це значення")
    ] = None,
):
    """Історія діалогу з peer_id: останні `limit` повідомлень у хронологічному порядку."""
    peer = _get_chat_peer(db, me, peer_id)

    stmt = select(Message).where(
        or_(
            and_(Message.sender_id == me.id, Message.receiver_id == peer.id),
            and_(Message.sender_id == peer.id, Message.receiver_id == me.id),
        )
    )
    if before_id is not None:
        stmt = stmt.where(Message.id < before_id)

    rows = list(db.scalars(stmt.order_by(Message.id.desc()).limit(limit)))
    rows.reverse()
    return rows


@chat_router.get("/peers", response_model=list[ChatPeer])
def list_chat_peers(db: DbDep, me: CurrentUser):
    """Список співрозмовників (з ким є листування), найсвіжіші зверху."""
    peer_id_col = case((Message.sender_id == me.id, Message.receiver_id), else_=Message.sender_id)
    rows = db.execute(
        select(
            peer_id_col.label("peer_id"),
            func.max(Message.created_at).label("last_at"),
        )
        .where(or_(Message.sender_id == me.id, Message.receiver_id == me.id))
        .group_by("peer_id")
        .order_by(desc("last_at"))
    ).all()
    if not rows:
        return []

    users = {
        u.id: u
        for u in db.scalars(select(User).where(User.id.in_([r.peer_id for r in rows])))
    }
    return [
        ChatPeer(
            id=r.peer_id,
            full_name=users[r.peer_id].full_name,
            role=users[r.peer_id].role,
            last_message_at=r.last_at,
        )
        for r in rows
        if r.peer_id in users
    ]


# =====================================================================
# Довідник законів (дані з seed_data)
# =====================================================================
law_router = APIRouter(prefix="/laws", tags=["laws"])


@law_router.get("", response_model=list[schemas.LawArticleRead])
def list_laws(
    db: DbDep,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return list(db.scalars(select(LawArticle).order_by(LawArticle.id).limit(limit).offset(offset)))


@law_router.get("/search", response_model=list[schemas.LawArticleRead])
def search_laws(
    params: Annotated[schemas.LawArticleSearchParams, Query()], db: DbDep, user: CurrentUser
):
    term = params.q.strip()
    stmt = (
        select(LawArticle)
        .where(
            or_(
                LawArticle.title.icontains(term, autoescape=True),
                LawArticle.content.icontains(term, autoescape=True),
            )
        )
        .order_by(LawArticle.id)
        .limit(params.limit)
    )
    return list(db.scalars(stmt))


@law_router.get("/{article_id}", response_model=schemas.LawArticleRead)
def get_law(article_id: int, db: DbDep, user: CurrentUser):
    article = db.get(LawArticle, article_id)
    if article is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Статтю не знайдено")
    return article


# =====================================================================
# 5. Початкові (тестові) дані
# =====================================================================
LAW_NOTE = (
    "\n\nСтисла довідка власними словами, не є офіційним текстом норми. "
    "Показники наведено станом на листопад 2026 року; перед прийняттям рішень "
    "звіряйтеся з чинною редакцією на zakon.rada.gov.ua або проконсультуйтеся зі спеціалістом."
)

PKU_URL = "https://zakon.rada.gov.ua/laws/show/2755-17"
ESV_URL = "https://zakon.rada.gov.ua/laws/show/2464-17"

SEED_EXPERTS = [
    {
        "email": "buhgalter@example.com",
        "full_name": "Олена Коваленко",
        "services": [
            (
                "Консультація бухгалтера: вибір групи єдиного податку",
                "Підбір групи та ставки єдиного податку з урахуванням виду діяльності, "
                "очікуваного доходу та кількості працівників. Тривалість — 45 хв.",
                "700.00",
            ),
            (
                "Консультація бухгалтера: декларація та звітність ФОП",
                "Порядок складання й подання декларації платника єдиного податку, "
                "строки подання та сплати податку, типові помилки.",
                "900.00",
            ),
            (
                "Консультація бухгалтера: ЄСВ і військовий збір",
                "Розрахунок єдиного внеску за себе та військового збору, строки сплати, "
                "звільнення на час відпустки чи хвороби.",
                "600.00",
            ),
        ],
    },
    {
        "email": "yurist@example.com",
        "full_name": "Андрій Мельник",
        "services": [
            (
                "Консультація юриста: реєстрація та закриття ФОП",
                "Вибір КВЕД, документи для реєстрації, припинення підприємницької "
                "діяльності та розрахунки з бюджетом. Тривалість — 45 хв.",
                "800.00",
            ),
            (
                "Консультація юриста: договори з контрагентами",
                "Складання та аналіз договорів надання послуг і поставки, "
                "відповідальність сторін, умови оплати.",
                "1200.00",
            ),
            (
                "Консультація юриста: перевірка договору та претензійна робота",
                "Юридична експертиза готового договору, підготовка претензії "
                "та стратегія досудового врегулювання спору.",
                "1500.00",
            ),
        ],
    },
]

SEED_LAW_ARTICLES = [
    {
        "title": "Податковий кодекс України, ст. 291: платники єдиного податку та граничні обсяги доходу",
        "source_url": PKU_URL,
        "content": (
            "Граничний річний дохід на єдиному податку визначається у кратності до мінімальної "
            "заробітної плати (МЗП), встановленої на 1 січня податкового року. У 2026 році МЗП — 8 647 грн.\n"
            "• I група — до 167 МЗП (1 444 049 грн). Без найманих працівників; лише роздрібний продаж "
            "з торгових місць на ринках та/або побутові послуги населенню.\n"
            "• II група — до 834 МЗП (7 211 598 грн). До 10 осіб у трудових відносинах одночасно; "
            "послуги (зокрема побутові), виробництво, ресторанне господарство та ін.\n"
            "• III група — до 1 167 МЗП (10 091 049 грн). Кількість працівників не обмежена.\n"
            "Стаття 291 також містить перелік видів діяльності та суб'єктів, яким єдиний податок недоступний. "
            "Для 2027 року ліміти буде перераховано від МЗП, чинної на 1 січня 2027 року."
            + LAW_NOTE
        ),
    },
    {
        "title": "Податковий кодекс України, ст. 293: ставки єдиного податку",
        "source_url": PKU_URL,
        "content": (
            "Ставки залежать від групи та від соціальних показників року "
            "(2026: прожитковий мінімум для працездатних осіб — 3 328 грн, МЗП — 8 647 грн).\n"
            "• I група — фіксована ставка до 10% прожиткового мінімуму (до 332,80 грн на місяць).\n"
            "• II група — фіксована ставка до 20% МЗП (до 1 729,40 грн на місяць).\n"
            "• III група — 5% доходу, або 3% доходу, якщо платник є платником ПДВ.\n"
            "Конкретний розмір ставок для I та II груп у межах зазначених максимумів може встановлювати "
            "місцева рада залежно від виду діяльності та місця її провадження. "
            "Для I і II груп сума податку не залежить від фактичного доходу."
            + LAW_NOTE
        ),
    },
    {
        "title": "Податковий кодекс України, ст. 295: порядок і строки сплати єдиного податку",
        "source_url": PKU_URL,
        "content": (
            "• I та II групи сплачують єдиний податок авансом щомісяця — не пізніше 20 числа (включно) "
            "поточного місяця (п. 295.1). Можна заплатити наперед за квартал або рік, але не далі кінця "
            "поточного звітного року.\n"
            "• III група сплачує податок протягом 10 календарних днів після граничного строку подання "
            "декларації за квартал (п. 295.3). Декларація подається щокварталу протягом 40 днів після "
            "завершення кварталу.\n"
            "• Податок сплачується за місцем податкової адреси (п. 295.4).\n"
            "• Платники I та II груп без найманих працівників звільняються від сплати податку протягом "
            "одного календарного місяця на рік на час відпустки, а також за період хвороби, якщо вона "
            "триває 30 і більше календарних днів і підтверджена листком непрацездатності (п. 295.5)."
            + LAW_NOTE
        ),
    },
    {
        "title": "Податковий кодекс України, підрозд. 10 розд. XX «Перехідні положення», п. 16¹: військовий збір ФОП",
        "source_url": PKU_URL,
        "content": (
            "• ФОП на єдиному податку I, II та IV груп сплачують фіксований військовий збір — 10% від МЗП "
            "на 1 січня звітного року в розрахунку на місяць (2026 рік: 864,70 грн).\n"
            "• Строк сплати — щомісяця не пізніше 20 числа (включно) поточного місяця; допускається "
            "авансова сплата за квартал чи рік у межах поточного звітного року. Суми нараховує податкова "
            "служба, а в декларації платника єдиного податку вони відображаються окремо.\n"
            "• III група сплачує військовий збір у розмірі 1% доходу — протягом 10 календарних днів "
            "після граничного строку подання декларації за квартал.\n"
            "• За несплату або неповну сплату авансових внесків передбачено штраф у розмірі 50% ставки збору."
            + LAW_NOTE
        ),
    },
    {
        "title": "Закон України № 2464-VI «Про збір та облік єдиного внеску на загальнообов'язкове державне соціальне страхування», ст. 4 та 7: ЄСВ ФОП за себе",
        "source_url": ESV_URL,
        "content": (
            "• Ставка єдиного внеску — 22%.\n"
            "• Для ФОП на єдиному податку внесок «за себе» не може бути меншим за мінімальний: "
            "22% від МЗП на 1 січня (2026 рік: 8 647 грн × 22% = 1 902,34 грн на місяць, "
            "або 5 707,02 грн за квартал).\n"
            "• Максимальна база нарахування — 20 МЗП (2026 рік: 172 940 грн на місяць). "
            "ФОП може обрати базу в межах між мінімальною та максимальною.\n"
            "• ФОП-єдиноподатник зазвичай сплачує внесок щокварталу — не пізніше 20 числа місяця, "
            "що настає за кварталом; можлива й сплата частинами чи наперед.\n"
            "• Розмір внеску не залежить від групи єдиного податку та впливає на страховий стаж і пенсійні права."
            + LAW_NOTE
        ),
    },
]


def seed_data() -> None:
    """
    Заповнює БД тестовими даними при першому запуску:
      * спеціалісти (бухгалтер, юрист) з послугами — лише якщо в БД немає жодного користувача;
      * 5 статей законів для ФОП — лише якщо таблиця law_articles порожня.
    Пароль тестових спеціалістів: змінна SEED_EXPERT_PASSWORD (за замовчуванням Expert12345).
    """
    with SessionLocal() as db:
        try:
            if db.scalar(select(func.count(User.id))) == 0:
                password_hash = hash_password(SEED_EXPERT_PASSWORD)
                for item in SEED_EXPERTS:
                    expert = User(
                        email=item["email"],
                        password_hash=password_hash,
                        full_name=item["full_name"],
                        role=UserRole.expert,
                    )
                    expert.services = [
                        Service(title=title, description=description, price=Decimal(price))
                        for title, description, price in item["services"]
                    ]
                    db.add(expert)
                logger.info(
                    "Seed: створено тестових спеціалістів: %s",
                    ", ".join(i["email"] for i in SEED_EXPERTS),
                )

            if db.scalar(select(func.count(LawArticle.id))) == 0:
                db.add_all(LawArticle(**article) for article in SEED_LAW_ARTICLES)
                logger.info("Seed: додано %d статей законів", len(SEED_LAW_ARTICLES))

            db.commit()
        except IntegrityError:
            # Кілька воркерів стартували одночасно, і інший уже виконав seed
            db.rollback()
            logger.info("Seed пропущено: дані вже створено іншим процесом")


# =====================================================================
# Застосунок
# =====================================================================
@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    seed_data()
    with SessionLocal() as db:
        backfill_expert_profiles(db)  # профіль і розклад для спеціалістів, створених до Етапу 2
    await check_provider_at_startup()  # підказка в логах: чи запущено Ollama / чи є ключ Claude
    news_task = start_news_sync()  # фонове оновлення офіційних стрічок (NEWS_FEEDS у .env)
    try:
        yield
    finally:
        if news_task is not None:
            news_task.cancel()


app = FastAPI(
    title="FOP Consulting Platform API",
    description="Платформа консультацій: ФОП ↔ бухгалтери та юристи",
    version="1.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,  # авторизація через заголовок Bearer, а не cookie
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(expert_router)
app.include_router(fop_router)
app.include_router(chat_router)
app.include_router(law_router)
app.include_router(create_ai_router(get_current_user))  # /api/ai/*
app.include_router(create_fop_cabinet_router(get_current_user, require_role))  # /fop/dashboard, /fop/income, …
app.include_router(create_expert_cabinet_router(require_role))  # /expert/dashboard, /expert/consultations, …
app.include_router(create_news_router(get_current_user, require_role))  # /news/*
