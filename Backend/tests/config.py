"""
Завантаження змінних оточення з backend/.env.

Імпортується першим (з database.py та ai_service.py), тож будь-який os.getenv(...)
в інших модулях уже бачить значення з .env. Шлях до файлу рахується від
розташування цього модуля, а не від поточної директорії — uvicorn можна
запускати звідки завгодно.

Змінні, задані в самому середовищі (Render, Docker, export), мають пріоритет
над .env.
"""
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
ENV_FILE = BASE_DIR / ".env"

load_dotenv(ENV_FILE, override=False)
