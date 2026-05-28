# Backend Architecture Design (FastAPI)

> Date: 2026-05-28
> Status: Approved

## 1. Overview
The backend will be built with FastAPI, SQLite, SQLAlchemy 2.0 (async), and Pydantic v2.

## 2. Directory Structure (Hybrid Feature-Based)
```text
backend/app/
├── core/                # Config, exceptions, security
├── db/                  # Async session manager, Base model, migrations (Alembic)
├── domain/              # Feature modules
│   ├── activities/
│   │   ├── router.py    # FastAPI HTTP endpoints
│   │   ├── service.py   # Business logic and ORM<->Pydantic mapping
│   │   ├── repository.py# SQLAlchemy queries (CRUD)
│   │   ├── models.py    # SQLAlchemy ORM models
│   │   └── schemas.py   # Pydantic v2 schemas
│   └── bookings/        # ...
└── main.py              # Application entrypoint
```

## 3. Dependency Rule
- **Router** depends on **Service**. (No DB queries in Router).
- **Service** depends on **Repository** and does the mapping from ORM to Pydantic.
- **Repository** handles DB operations (`flush`, no `commit`).

## 4. Session Management
- `DatabaseSessionManager` handles `AsyncSession`.
- Unit of Work pattern: `commit()` is called at the DI level (in `get_db_session`), not inside the repository.
