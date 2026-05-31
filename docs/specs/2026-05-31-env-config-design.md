# Multi-Environment Configuration Design

> Дата: 2026-05-31
> Статус: Design (pre-implementation)
> Связанные: `backend/src/core/config.py`, `backend/tests/conftest.py`, `dev.sh`, `.gitignore`

## 1. Проблема

Сейчас backend (FastAPI) использует `Settings` класс с pydantic-settings без подгрузки `.env` файлов. Конфигурация задаётся только через `os.environ` или дефолты в коде. Это приводит к:

- **Нет разделения сред** — dev, test и production используют одни и те же дефолты
- **CORS-проблема** — приходится вручную ставить `CORS_ORIGINS=*` при каждом запуске dev-окружения
- **Тесты используют monkeypatch** вместо изолированного конфига
- **Нет документации** — какие env-переменные существуют и зачем

## 2. Решение: ENV_FILE-based multi-env config

### 2.1. Файловая структура

```
backend/
├── .env.example        ✅ commit — шаблон со всеми переменными
├── .env.dev            ✅ commit — dev-конфигурация
├── .env.test           ✅ commit — test-конфигурация
├── .env                ❌ gitignored — production
```

### 2.2. Принцип работы

- Среда выбирается через переменную окружения `ENV_FILE`
- `Settings` читает `ENV_FILE` из `os.environ` при создании singleton
- Если `ENV_FILE` не задан — читает `.env` (production default)
- Если указанный файл не найден — ошибки нет, Settings читает из `os.environ`

### 2.3. Порядок приоритета (низкий → высокий)

1. Дефолты в коде (`DATABASE_URL: str = "sqlite+aiosqlite:///./memo.db"`)
2. Значения из `.env` / `.env.dev` / `.env.test` (зависит от `ENV_FILE`)
3. `os.environ` (самый высокий приоритет)

Это значит, что conftest может переопределить `DATABASE_URL` через `os.environ`, и это перекроет значение из `.env.test`.

## 3. Изменения в коде

### 3.1. `backend/src/core/config.py`

```python
"""Application settings loaded from environment variables."""

import os
from typing import Annotated

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic_settings.sources import NoDecode


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables and .env files."""

    model_config = SettingsConfigDict(extra="ignore")

    DATABASE_URL: str = "sqlite+aiosqlite:///./memo.db"
    PROJECT_NAME: str = "Memo Backend"
    CORS_ORIGINS: Annotated[list[str], NoDecode] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    LOG_LEVEL: str = "INFO"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: object) -> object:
        """Parse CORS_ORIGINS from a comma-separated string or ``\"*\"``."""
        if isinstance(v, str):
            if v == "*":
                return ["*"]
            return [origin.strip() for origin in v.split(",")]
        return v


_env_file = os.environ.get("ENV_FILE")
settings = Settings(_env_file=_env_file)
```

### 3.2. `backend/.env.example`

```bash
# ═══════════════════════════════════════════
# Memo Backend — Configuration Template
# ═══════════════════════════════════════════
# Copy to .env for production, or use
# .env.dev / .env.test for other environments.
# ───────────────────────────────────────────
# Usage:
#   ENV_FILE=.env.dev  uv run uvicorn ...
#   ENV_FILE=.env.test pytest

# String — SQLAlchemy async database URL
# Default: sqlite+aiosqlite:///./memo.db
# Example: postgresql+asyncpg://user:pass@host/db
DATABASE_URL=sqlite+aiosqlite:///./memo.db

# String — Application name (used in OpenAPI docs)
PROJECT_NAME=Memo Backend

# Comma-separated list or "*" — CORS allowed origins
# "*" allows all origins (dev only)
# Examples:
#   http://localhost:3000,http://127.0.0.1:3000
#   *
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000

# String — Logging level: DEBUG, INFO, WARNING, ERROR
LOG_LEVEL=INFO
```

### 3.3. `backend/.env.dev`

```bash
DATABASE_URL=sqlite+aiosqlite:///./memo.db
PROJECT_NAME=Memo Backend (Dev)
CORS_ORIGINS=*
LOG_LEVEL=DEBUG
```

### 3.4. `backend/.env.test`

```bash
DATABASE_URL=sqlite+aiosqlite:///./test_memo.db
PROJECT_NAME=Memo Backend (Test)
CORS_ORIGINS=*
LOG_LEVEL=DEBUG
```

### 3.5. `backend/tests/conftest.py`

Добавить:
```python
os.environ["ENV_FILE"] = ".env.test"
```

Существующая строка `os.environ["DATABASE_URL"] = ...` остаётся — она переопределит значение из `.env.test`.

### 3.6. `dev.sh`

Добавить перед запуском backend:
```bash
export ENV_FILE=.env.dev
```

Полный фрагмент:
```bash
# Start backend (FastAPI) on :8000
export ENV_FILE=.env.dev
(cd "$BACKEND_DIR" && uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload) &
```

### 3.7. `.gitignore` (root)

Убедиться, что `.env.dev`, `.env.test`, `.env.example` НЕ игнорятся.
Текущие правила уже корректны — они игнорят только `.env`, `.env.local`, `.env.production` и `.env*.local`. Новые файлы не подпадают под эти паттерны.

Изменений не требуется.

## 4. Миграция существующего кода

### 4.1. Что НЕ меняется (работает без изменений)

- Все существующие тесты (в том числе с `monkeypatch`)
- `os.environ["DATABASE_URL"]` в conftest (высший приоритет)
- Ручной запуск через `DATABASE_URL=... CORS_ORIGINS=... uv run uvicorn ...`

### 4.2. Test refactoring (опционально, можно позже)

Тест `test_cors_env_override` в `tests/test_cors.py` можно упростить:
```python
def test_cors_env_override(self, monkeypatch):
    """CORS_ORIGINS from .env.test are loaded correctly."""
    # Сейчас: monkeypatch.setenv + monkeypatch.setattr
    # После: Settings(_env_file=".env.test") напрямую
    from src.core.config import Settings
    s = Settings(_env_file=".env.test")
    assert s.CORS_ORIGINS == ["*"]
```

Это не обязательно делать сейчас — старый тест продолжает работать.

## 5. Acceptance Criteria

- [ ] `Settings` class загружает `.env` файл, указанный в `ENV_FILE` env var
- [ ] `.env.dev` создан, закоммичен, содержит dev-настройки (CORS=*, LOG_LEVEL=DEBUG)
- [ ] `.env.test` создан, закоммичен, содержит test-настройки
- [ ] `.env.example` создан, закоммичен, содержит документацию по всем переменным
- [ ] `conftest.py` устанавливает `ENV_FILE=.env.test`
- [ ] `dev.sh` экспортирует `ENV_FILE=.env.dev`
- [ ] Все существующие тесты проходят
- [ ] При `ENV_FILE=.env.dev curl -H "Origin: http://x.x.x.x:3000" ...` — 200 OK (CORS работает)
- [ ] При отсутствии `ENV_FILE` — читается `.env` (production behavior)

## 6. Visual Compliance Checks

N/A — конфигурация не имеет UI.

## 7. Open Questions

- Нужен ли `.env.local` для персональных оверрайдов? **Решено: не нужен.**
- Нужен ли `.env.production` отдельно? **Решено: нет, `.env` = production.**
