# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать фундамент FastAPI приложения (Feature-Based Clean Architecture) с асинхронным SQLite, TDD инфраструктурой, линтерами (ruff, mypy) и первым эндпоинтом для Healthcheck.

**Architecture:** Hybrid Feature-based. Общая инфраструктура в `core/` и `db/`. Роутеры изолированы от БД. Управление сессиями через DatabaseSessionManager (Dependency Injection).

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (aiosqlite), Pydantic v2, pytest, ruff, mypy.

---

### Task 1: Инициализация проекта и линтеры (Small)
**Цель:** Создать структуру папок и настроить качество кода.
- [ ] В папке `backend/` создать файлы: `pyproject.toml` (с зависимостями: `fastapi`, `uvicorn`, `sqlalchemy`, `aiosqlite`, `pydantic-settings`, `pytest`, `pytest-asyncio`, `httpx`, `ruff`, `mypy`).
- [ ] Настроить в `pyproject.toml` секции `[tool.ruff]` и `[tool.mypy]` (strict type checking).
- [ ] Создать структуру директорий: `backend/app/core/`, `backend/app/db/`, `backend/app/domain/`, `backend/tests/`.
- [ ] Убедиться, что `uv sync` или `pip install` успешно устанавливает окружение.

### Task 2: Управление сессиями БД (Standard)
**Цель:** Реализовать `DatabaseSessionManager` для асинхронного SQLite.
- [ ] Написать тест в `backend/tests/test_database.py` (проверка, что менеджер создаёт сессию и не падает).
- [ ] Создать `backend/app/db/database.py`: реализовать класс `DatabaseSessionManager` с методами `init`, `close` и асинхронным контекстным менеджером `@asynccontextmanager async def session()`.
- [ ] Создать `backend/app/db/base.py`: инициализировать `Base = declarative_base()`.
- [ ] Настроить DI функцию `async def get_db_session()` в `database.py`.
- [ ] Убедиться, что `pytest` проходит.

### Task 3: Конфигурация и точка входа (Small)
**Цель:** Настроить `pydantic-settings` и `main.py` с lifespan-событиями.
- [ ] Написать тест `backend/tests/test_main.py` (запуск тестового клиента, ожидание 404 на пустой роут).
- [ ] Создать `backend/app/core/config.py`: класс `Settings(BaseSettings)` с полем `DATABASE_URL` (по умолчанию `sqlite+aiosqlite:///./memo.db`).
- [ ] Создать `backend/app/main.py`: Реализовать `create_app()`. Добавить `@asynccontextmanager async def lifespan(app: FastAPI)` для инициализации и закрытия БД (`sessionmanager.init` и `close`).
- [ ] Убедиться, что `pytest` проходит.

### Task 4: Домен System / Healthcheck (Small)
**Цель:** Создать первый валидный роут по принципам Clean Architecture.
- [ ] Написать тест `backend/tests/test_health.py` (запрос на `/api/health`, ожидание `{"status": "ok", "db": "connected"}`).
- [ ] Создать `backend/app/domain/system/schemas.py` (`HealthResponse` схема).
- [ ] Создать `backend/app/domain/system/service.py` (`HealthService`, который выполняет `SELECT 1` через репозиторий или сессию для проверки БД).
- [ ] Создать `backend/app/domain/system/router.py` (эндпоинт `/api/health`, DI сервиса).
- [ ] Подключить роутер в `main.py` с префиксом `/api/health`.
- [ ] Убедиться, что `pytest` проходит.
