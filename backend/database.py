import os
from typing import Iterator

import config  # noqa: F401  — завантажує backend/.env до читання os.getenv

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

# SQLite за замовчуванням. Для PostgreSQL:
# export DATABASE_URL="postgresql+psycopg2://user:pass@localhost:5432/fop_platform"
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fop_platform.db")

# Heroku/Render-style URL fix
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+psycopg2://", 1)

IS_SQLITE = DATABASE_URL.startswith("sqlite")

engine: Engine = create_engine(
    DATABASE_URL,
    echo=os.getenv("SQL_ECHO", "0") == "1",
    pool_pre_ping=True,
    connect_args={"check_same_thread": False} if IS_SQLITE else {},
)

if IS_SQLITE:
    # SQLite за замовчуванням ігнорує FOREIGN KEY — вмикаємо
    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency: db: Session = Depends(get_db)"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Створює таблиці (для продакшну використовуйте Alembic)."""
    import models  # noqa: F401  — реєстрація моделей у metadata

    Base.metadata.create_all(bind=engine)
