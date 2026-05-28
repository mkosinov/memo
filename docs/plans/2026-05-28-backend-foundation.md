# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the foundation of the FastAPI application (Feature-Based Clean Architecture) with async SQLite, TDD infrastructure, linters (ruff, mypy), and an initial Healthcheck endpoint.

**Architecture:** Hybrid Feature-based. Shared infrastructure in `core/` and `db/`. Routers isolated from DB. Session management via DatabaseSessionManager (Dependency Injection).

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (aiosqlite), Pydantic v2, pytest, ruff, mypy.

---

### Task 1: Project Initialization and Linters (Small)
**Goal:** Create directory structure and configure code quality tools.
- [ ] In `backend/` directory, create `pyproject.toml` (dependencies: `fastapi`, `uvicorn`, `sqlalchemy`, `aiosqlite`, `pydantic-settings`, `pytest`, `pytest-asyncio`, `httpx`, `ruff`, `mypy`).
- [ ] Configure `[tool.ruff]` and `[tool.mypy]` (strict type checking) in `pyproject.toml`.
- [ ] Create directory structure: `backend/app/core/`, `backend/app/db/`, `backend/app/domain/`, `backend/tests/`.
- [ ] Verify `uv sync` or `pip install` successfully sets up the environment.

### Task 2: Database Session Management (Standard)
**Goal:** Implement `DatabaseSessionManager` for async SQLite.
- [ ] Write a test in `backend/tests/test_database.py` (verify manager creates a session without crashing).
- [ ] Create `backend/app/db/database.py`: implement `DatabaseSessionManager` class with `init`, `close` methods and `@asynccontextmanager async def session()`.
- [ ] Create `backend/app/db/base.py`: initialize `Base = declarative_base()`.
- [ ] Setup DI function `async def get_db_session()` in `database.py`.
- [ ] Ensure `pytest` passes.

### Task 3: Configuration and Entrypoint (Small)
**Goal:** Configure `pydantic-settings` and `main.py` with lifespan events.
- [ ] Write a test `backend/tests/test_main.py` (start TestClient, expect 404 on root).
- [ ] Create `backend/app/core/config.py`: `Settings(BaseSettings)` class with `DATABASE_URL` field (default `sqlite+aiosqlite:///./memo.db`).
- [ ] Create `backend/app/main.py`: Implement `create_app()`. Add `@asynccontextmanager async def lifespan(app: FastAPI)` for DB initialization and teardown (`sessionmanager.init` and `close`).
- [ ] Ensure `pytest` passes.

### Task 4: System Domain / Healthcheck (Small)
**Goal:** Create the first valid route following Clean Architecture principles.
- [ ] Write a test `backend/tests/test_health.py` (request to `/api/health`, expect `{"status": "ok", "db": "connected"}`).
- [ ] Create `backend/app/domain/system/schemas.py` (`HealthResponse` schema).
- [ ] Create `backend/app/domain/system/service.py` (`HealthService` that executes `SELECT 1` via session/repository to check DB).
- [ ] Create `backend/app/domain/system/router.py` (`/api/health` endpoint, injects `HealthService`).
- [ ] Include the router in `main.py` with prefix `/api/health`.
- [ ] Ensure `pytest` passes.
