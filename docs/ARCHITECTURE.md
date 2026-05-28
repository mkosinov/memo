# Архитектура Memo — Turborepo Monorepo

> Дата: 2026-05-19
> Статус: Активно (миграция завершена)

## Обзор

Проект Memo использует **Turborepo + npm workspaces** для управления множественными frontend-приложениями и shared packages.

**Почему Turborepo:**
- 3+ frontend приложения (admin, web, master) работают с одним backend
- Shared типы данных и API клиент без дублирования
- Изолированные бандлы — zero admin-кода в сайте colourmountains.ru
- Единый CI/CD pipeline

---

## Структура репозитория

```
memo/
├── apps/                          # Frontend приложения
│   ├── admin/                     # Админ-панель (Next.js 14)
│   │   ├── app/                   # App Router pages
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   └── package.json           # deps: @dnd-kit, @radix-ui
│   │
│   ├── web/                       # colourmountains.ru (Next.js 14)
│   │   ├── app/
│   │   ├── components/
│   │   └── package.json           # deps: framer-motion
│   │                              # НЕТ @dnd-kit, НЕТ admin-specific deps
│   │
│   └── master/                    # Приложение для мастеров (future)
│       └── package.json           # deps: mobile-first libs
│
├── packages/                      # Shared packages
│   ├── domain/                    # TypeScript типы + Zod схемы
│   │   ├── src/index.ts           # Artist, Activity, BookingRecord, etc.
│   │   └── package.json           # deps: zod
│   │                              # sideEffects: false, zero runtime
│   │
│   └── api-client/                # HTTP клиент к FastAPI
│       ├── src/client.ts          # fetch-обёртка с Zod-валидацией
│       ├── src/endpoints.ts       # getActivities, getBookings, etc.
│       └── package.json           # deps: zod, @memo/domain
│
├── backend/                       # FastAPI (отдельный сервис)
│   └── app/
│
├── turbo.json                     # Pipeline: build, dev, test
├── pnpm-workspace.yaml           # Workspace declaration
└── package.json                   # Root: workspaces + turbo
```

---

## Принципы разделения

### Что shared (packages/)

| Пакет | Что внутри | Почему shared |
|-------|-----------|---------------|
| `@memo/domain` | TypeScript интерфейсы + Zod схемы | Activity — это Activity в admin, web и master |
| `@memo/api-client` | Fetch-функции + runtime валидация | HTTP контракт один для всех |

### Что НЕ shared (каждый app сам)

| Компонент | Причина изоляции |
|-----------|-----------------|
| Button, Input, Card | Разный дизайн: admin (тёмный, плотный) ≠ web (светлый, визуальный) ≠ master (мобильный) |
| Layout (Sidebar, Header) | Разная структура навигации |
| @dnd-kit | Только admin нужен drag-n-drop |
| @radix-ui/react-dialog | Только admin использует сложные модалки |

---

## Зависимости между пакетами

```
@memo/domain              ← zero deps (только zod для схем)
    ↑
@memo/api-client          ← @memo/domain + zod
    ↑
apps/admin                ← @memo/domain + @memo/api-client + @dnd-kit
apps/web                  ← @memo/domain + @memo/api-client + framer-motion
apps/master               ← @memo/domain + @memo/api-client (future)
```

---

## TypeScript резолвинг

Каждое приложение имеет в `tsconfig.json`:

```json
"paths": {
  "@/*": ["./*"],
  "@memo/domain": ["../../packages/domain/src/index.ts"],
  "@memo/api-client": ["../../packages/api-client/src/index.ts"]
}
```

Это позволяет импортировать без билда packages:
```typescript
import { Activity, Artist } from '@memo/domain';
import { getActivities } from '@memo/api-client';
```

---

## Деплой

| App | URL | Vercel проект |
|-----|-----|---------------|
| admin | `admin.colourmountains.ru` или `/admin` | отдельный |
| web | `colourmountains.ru` | отдельный |
| master | `master.colourmountains.ru` | future |

---

## Backend — FastAPI + Clean Architecture

> Status: Foundation completed 2026-05-28

The backend is a separate FastAPI service living in `backend/`. It follows **Feature-Based Clean Architecture** — each domain module has its own `router.py`, `service.py`, `repository.py`, `models.py`, and `schemas.py`.

### Backend Directory Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                    # create_app() + lifespan (DB init/close)
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   └── config.py              # Settings (pydantic-settings, DATABASE_URL)
│   │
│   ├── db/
│   │   ├── __init__.py
│   │   ├── base.py                # DeclarativeBase
│   │   └── database.py            # DatabaseSessionManager + get_db_session DI
│   │
│   └── domain/
│       └── system/                # Healthcheck module
│           ├── __init__.py
│           ├── schemas.py         # HealthResponse (Pydantic v2)
│           ├── service.py         # HealthService (SELECT 1)
│           └── router.py          # GET /api/health
│
├── tests/
│   ├── __init__.py
│   ├── conftest.py                # In-memory SQLite fixture
│   ├── test_project_init.py       # 13 tests: structure, linters, imports
│   ├── test_database.py           # 6 tests: session lifecycle
│   ├── test_health.py             # 3 tests: health endpoint
│   └── test_main.py               # 6 tests: app lifecycle, lifespan
│
└── pyproject.toml                 # Dependencies + ruff + mypy strict
```

### Dependency Flow

```
HTTP Request
    │
    ▼
Router (endpoint)          ← FastAPI route, validates input via Pydantic
    │
    ▼
Service (business logic)    ← ORM → Pydantic mapping, calls repository
    │
    ▼
Session (DI)                ← DatabaseSessionManager.get_db_session()
    │
    ▼
SQLite (aiosqlite)          ← Async SQLAlchemy 2.0 engine
```

### Key Principles

| Principle | Implementation |
|-----------|---------------|
| **No DB in Router** | Router calls Service, never accesses session directly |
| **No commit in Repository** | Repository uses `flush()`; `commit()` at DI level (Unit of Work) |
| **Session per request** | `get_db_session` yields per-request session, commits on success |
| **Test purity** | In-memory SQLite (`:memory:`) for all tests |
| **TDD first** | Tests written before implementation for every module |

### Communication with Frontend

- Frontend apps → `packages/api-client` → HTTP → FastAPI backend
- `GET /api/health` returns `{"status": "ok", "db": "connected"}`
- Future endpoints follow RESTful conventions: `/api/activities`, `/api/bookings`, etc.

### Tech Stack

| Technology | Purpose |
|-----------|---------|
| FastAPI | Web framework |
| SQLAlchemy 2.0 | Async ORM |
| aiosqlite | Async SQLite driver |
| Pydantic v2 | Schema validation + Settings |
| pytest + httpx | Test runner + async client |
| ruff | Linter |
| mypy (strict) | Static type checking |

---

## История изменений

- **2026-05-28**: Added Backend section — FastAPI Clean Architecture foundation with Healthcheck module, TDD infrastructure, and DB session management.
- **2026-05-19**: Миграция из единого `frontend/` в Turborepo. Admin перенесён в `apps/admin/`. Созданы `packages/domain/` и `packages/api-client/`.
