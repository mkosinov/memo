---
name: fastapi-clean-architecture
description: Use when designing or implementing backend data flow with clean layer separation (Router, Service, Repository, Domain) in FastAPI/Python
---

# FastAPI Clean Architecture (Data Flow)

> Version: 1.0 — 2026
> Targets: FastAPI, SQLAlchemy 2.0 (async), Pydantic v2, SQLite

---

## When to Use

Use this skill when:
- Creating new API endpoints in the backend
- Designing database models and Pydantic schemas
- Implementing business logic in FastAPI
- Refactoring existing backend code to separate concerns

---

## API Versioning

All endpoints MUST be versioned. The current version is `/api/v1/`.

**Rules:**
- All routers are mounted with `/api/v1/` prefix in `main.py`
- Never add endpoints without a version prefix
- When breaking changes are needed, create `/api/v2/` — never modify v1 in-place
- Old versions are kept until all consumers migrate

**Example main.py:**
```python
app.include_router(masters_router, prefix="/api/v1/masters")
app.include_router(locations_router, prefix="/api/v1/locations")
app.include_router(system_router, prefix="/api/v1")
```

**Client code:**
- Frontend hits `/api/v1/<resource>`
- Tests use `/api/v1/` URLs

---

## Layered Structure (Layer-Based)

We use a layer-based structure where each layer is a flat directory, NOT grouped by domain/feature. This keeps imports predictable and files easy to find as the project grows.

```text
backend/src/
├── main.py              ← FastAPI app factory, all routers included here
├── core/                ← Config, security, exceptions
│   └── config.py
├── db/                  ← Session manager, Base model, GenericRepository
│   ├── base.py          ← DeclarativeBase + AbstractModel
│   ├── database.py      ← DBManager 
│   ├── repository.py    ← GenericRepository
│   └── __init__.py      ← db_manager singleton + SessionDep
├── models/              ← SQLAlchemy ORM models (flat, one file per entity)
│   ├── abstract.py
│   ├── activity.py
│   ├── master.py
│   └── ...
├── schemas/             ← Pydantic v2 schemas (flat, one file per entity)
│   ├── activity.py
│   ├── master.py
│   └── ...
├── services/            ← Business logic (flat, one file per entity)
│   ├── generic.py       ← GenericService[CreateT, UpdateT, ResponseT]
│   ├── activity_service.py
│   ├── master_service.py
│   └── ...
├── api/
│   └── v1/              ← FastAPI routers (flat, one file per resource)
│       ├── activities.py
│       ├── masters.py
│       └── ...
├── admin/               ← SQLAdmin setup
│   └── setup.py
├── seed/                ← Mock data seeder
│   └── seed.py
├── migrations/          ← Alembic migrations (future)
└── util/                ← Helper functions (future)
```

---

## Dependency Rule (Strict!)

```text
Client (HTTP) → [Router] → [Service] → [Repository] → [Database]
```

| Layer | Responsibility | May Import | Forbidden |
|-------|----------------|------------|-----------|
| **Router** | HTTP endpoints, Request/Response validation via Pydantic | `src.schemas.*`, `src.services.*`, FastAPI `Depends` | `src.models.*` (ORM), DB queries, business logic |
| **Service** | Orchestration, business rules, **mapping ORM ↔ Pydantic** | `src.db.repository`, `src.schemas.*`, `src.models.*` | FastAPI HTTP classes (Request, Response) |
| **Repository**| SQLAlchemy CRUD, queries, `flush()` | `src.models.*`, `src.db.database` | `src.schemas.*`, `src.services.*`, FastAPI |
| **Schemas** | Pydantic v2 schemas | nothing external | everything else |

---

## Key Patterns

### 1. ORM to Pydantic Mapping
**Rule:** Map ORM objects to Pydantic objects **in the Service layer**. Do not leak ORM objects to the Router.

```python
# schemas.py
from pydantic import BaseModel, ConfigDict

class ItemResponse(BaseModel):
    id: int
    name: str
    model_config = ConfigDict(from_attributes=True) # Required for ORM mapping

# service.py
class ItemService:
    async def get_item(self, item_id: int) -> ItemResponse:
        item_orm = await self.repo.get_by_id(item_id)
        # Mapping happens here:
        return ItemResponse.model_validate(item_orm) 
```

### 2. Session Management and Dependency Injection
**Rule:** Use Dependency Injection for services and repositories. Do `commit()` in the session manager context, not inside the repository. Use `flush()` in repositories.

```python
# db/database.py
# (Assume DatabaseSessionManager exists that provides get_db_session)

# router.py
@router.post("/")
async def create_something(
    data: SomeCreateSchema,
    service: SomeService = Depends(get_some_service)
):
    return await service.create(data)

# service.py
class SomeService:
    def __init__(self, repo: SomeRepository):
        self.repo = repo

def get_some_service(session: AsyncSession = Depends(get_db_session)) -> SomeService:
    repo = SomeRepository(session)
    return SomeService(repo)
```

### 3. Error Handling
- Throw custom Domain Exceptions from the `Service` layer (e.g. `ItemNotFoundError`).
- Catch them in the `Router` or global Exception Handlers and convert them to `HTTPException`.

---

## Before Coding
Remember to apply `test-driven-development`! Write your `pytest` tests before implementing the endpoint.