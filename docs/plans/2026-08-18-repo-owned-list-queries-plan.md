# GH #206 — Repo-Owned List Queries (Option C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all list-query SQL composition (filter→count→order→slice) from the service layer into `BaseRepository`/`ArchiveRepository`, retiring 5 scattered pagination implementations, plus consolidate pagination query-param schemas and collapse a duplicate response schema.

**Architecture:** Two repo methods — `list` (replaces the dead unbounded `list` in place; builds select+filters+count+slice for simple base-table lists) and `list_custom` (wraps any service-built statement with count+slice, for JOINs/dynamic sort). Both return `tuple[list[ModelType], int]` (ORM + count, never the Pydantic envelope). Services keep page↔offset conversion, ORM→Pydantic mapping, and the `PaginatedResponse` envelope. 10/12 list endpoints route through repo methods; clients stays service-owned (accepted concession, GH #217 follow-up); photos is unpaginated (out of scope, #211).

**Tech Stack:** FastAPI, SQLAlchemy 2.x async, Pydantic v2, pytest; api-client (hand-written Zod schemas), Next.js admin frontend.

**Spec:** `docs/specs/2026-08-18-repo-owned-list-queries-design.md` (commit `1c0b8a5`, pushed to main). Read it first — section references below (§5.1, §5.2, etc.) point into it.

**Baseline (main @ 1c0b8a5):** backend 1259p/6s; api-client 197p/4f (4 = known #188); admin vitest 1370p/0f; tsc clean.

---

## Behavioral Delta

This is a pure backend refactor with **zero user-visible behavior change**. Every list endpoint returns exactly the same data, envelope, ordering, defaults, and 422 validation as before. Mapped to spec acceptance criteria:

- **Repo methods exist, paginate_orm retired** → internal only; users see no change.
- **3 inline duplicators collapse; Record/Activity route via repo** → internal only; Services/Payments/Visits/Records/Activities lists behave identically (same totals, pages, ordering, eager-loaded tariffs/tags/visits).
- **10/12 endpoints via repo; clients concession** → Clients table unchanged (still stats-powered).
- **PaginationParams shared schema in 9 routers** → API query params `page`/`per_page` unchanged (same defaults 1/20, same limits, same 422 messages); OpenAPI shows identical parameters.
- **ClientListResponse → PaginatedResponse[ClientWithStats]** → API JSON identical (same 4 keys); only the OpenAPI schema name and the TS type name change; admin Clients page renders identically.
- **Suites green; domain docs synced** → no behavior change.

---

## File Map

| File | Change | Tasks |
|------|--------|-------|
| `backend/src/repositories/generic.py` | New `list`/`list_custom` on BaseRepository; `list` override on ArchiveRepository (dead `list`s replaced) | T1 |
| `backend/tests/test_soft_delete_repository.py` | 4 tests rewritten to new `list` contract | T1 |
| `backend/tests/test_repository_list.py` | NEW — unit tests for `list`/`list_custom` mechanics | T1 |
| `backend/src/services/generic.py` | `GenericService.list`/`ArchiveService.list` rewired; `_paginate` + `paginate_orm` deleted | T2, T6 |
| `backend/src/services/service.py` | `ServiceService.list` collapsed to `repo.list(..., options=[selectinload×2])` | T3 |
| `backend/src/services/payment.py` | `PaymentService.list` override **deleted** (inherits generic) | T4 |
| `backend/src/services/visit.py` | `VisitService` gains repo DI; `list` collapsed | T5 |
| `backend/tests/services/test_visit_service.py` | 9 instantiation sites updated | T5 |
| `backend/src/services/record.py` | `paginate_orm(...)` → `repo.list_custom(...)` | T6 |
| `backend/src/services/activity.py` | `_list_by_date` → `repo.list_custom(...)` | T6 |
| `backend/src/schemas/pagination.py` | NEW — `PaginationParams` | T7 |
| `backend/src/api/v1/{activities,payments,locations,visits,visitors,services,materials,masters,tags}.py` | 9 routers: `Depends(PaginationParams)` | T7 |
| `backend/src/schemas/{record,client}.py` | `RecordListParams`/`ClientListParams` inherit `PaginationParams`, drop redeclared fields | T7 |
| `backend/src/schemas/client.py` + `src/api/v1/clients.py` + `src/services/client.py` | `ClientListResponse` deleted → `PaginatedResponse[ClientWithStats]` | T8 |
| `backend/tests/test_client_stats.py` | `ClientListResponse` import/assertions updated | T8 |
| `packages/api-client/src/schemas.ts` | `ClientListResponseSchema` → paginated-envelope pattern | T9 |
| `frontend/admin/contexts/ClientsContext.tsx` | 2-line type rename | T9 |
| `docs/domain-rules/records.md` (+ grep sweep) | pagination mechanics synced to repo-owned design | T10 |

---

## Task 1: Repository `list` + `list_custom` (replace dead `list`s)
### Classification: standard
### Required Docs
- `docs/specs/2026-08-18-repo-owned-list-queries-design.md` §5.1, §5.2, §6, §9 — method semantics, count invariant, test-rewrite decision
- `.opencode/skills/pytest-patterns/SKILL.md` — fixtures, db_session usage
- `.opencode/skills/fastapi-clean-architecture/SKILL.md` L95-107 — layering (repo must NOT import `src.schemas`)

### Task Description

**Files:** modify `backend/src/repositories/generic.py`; rewrite `backend/tests/test_soft_delete_repository.py` (4 tests); create `backend/tests/test_repository_list.py`.

**Current code being replaced** (`repositories/generic.py`): `BaseRepository.list` (L29-41) and `ArchiveRepository.list` (L132-148) — both dead in prod (zero prod callers; only the 4 tests call the Archive variant). Module imports today: `from sqlalchemy import not_, select` (L14 area) — **`func` must be added**.

**New `BaseRepository.list`** (replaces old method, same name, new keyword-only signature):

```python
async def list(
    self,
    session: AsyncSession,
    table: type[ModelType],
    *,
    filters: dict | None = None,
    order_by=None,
    limit: int | None = None,
    offset: int = 0,
    options=None,
) -> tuple[list[ModelType], int]:
    """Return a paginated page of records plus the total count.

    Counts on the unordered statement (loader options are stripped by
    ``stmt.subquery()`` and never affect the count); ``order_by`` is
    applied AFTER the count, then limit/offset slice.
    ``limit=None`` means no LIMIT clause (not used by list endpoints).
    """
    stmt = select(table)
    if options:
        stmt = stmt.options(*options)
    for key, value in (filters or {}).items():
        if value is not None:
            stmt = stmt.where(getattr(table, key) == value)
    total = (
        await session.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    if order_by is not None:
        stmt = stmt.order_by(*order_by)
    if limit is not None:
        stmt = stmt.limit(limit)
    if offset:
        stmt = stmt.offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all()), total
```

**New `BaseRepository.list_custom`:**

```python
async def list_custom(
    self,
    session: AsyncSession,
    stmt,
    *,
    order_by=None,
    limit: int | None = None,
    offset: int = 0,
) -> tuple[list, int]:
    """Wrap a caller-built statement with count + slice.

    Precondition: ``stmt`` must carry NO pre-baked order_by/limit/offset —
    ordering and slicing are owned by this method. Count runs on the
    unordered statement so correlated sort-key subqueries are never
    evaluated inside the count query.
    """
    total = (
        await session.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    if order_by is not None:
        stmt = stmt.order_by(*order_by)
    if limit is not None:
        stmt = stmt.limit(limit)
    if offset:
        stmt = stmt.offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all()), total
```

**New `ArchiveRepository.list`** (replaces old override):

```python
async def list(
    self,
    session: AsyncSession,
    table: type[ModelType],
    *,
    status: ArchiveStatus = ArchiveStatus.ACTIVE,
    filters: dict | None = None,
    order_by=None,
    limit: int | None = None,
    offset: int = 0,
    options=None,
) -> tuple[list[ModelType], int]:
    """Return a paginated page filtered by archive status, plus total count."""
    stmt = select(table)
    if options:
        stmt = stmt.options(*options)
    if status == ArchiveStatus.ACTIVE:
        stmt = stmt.where(table.is_active)
    elif status == ArchiveStatus.ARCHIVED:
        stmt = stmt.where(not_(table.is_active))
    for key, value in (filters or {}).items():
        if value is not None:
            stmt = stmt.where(getattr(table, key) == value)
    total = (
        await session.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    if order_by is not None:
        stmt = stmt.order_by(*order_by)
    if limit is not None:
        stmt = stmt.limit(limit)
    if offset:
        stmt = stmt.offset(offset)
    result = await session.execute(stmt)
    return list(result.scalars().all()), total
```

`ArchiveRepository` does NOT override `list_custom` (inherited). The old docstrings of the dead methods go away with the bodies; class docstrings stay.

**Test rewrite** (`tests/test_soft_delete_repository.py`): keep `_seed_masters` helper and all 4 test functions with identical names/intent; change only the call + assertions. Pattern per test:

```python
rows, total = await repo.list(db_session, Master, status=ArchiveStatus.ACTIVE, limit=100)
assert total == 2
assert len(rows) == 2
assert all(m.is_active for m in rows)
```
(ARCHIVED variant expects total 3; ALL expects 4; default-status expects 2. Also update the module docstring first line: it now covers the paginated `ArchiveRepository.list` — GH #206.)

**New unit tests** (`tests/test_repository_list.py`, `pytestmark = pytest.mark.asyncio`, reuse `db_session` fixture and the `_seed_masters`-style seeding — import Master, seed via `db_session.add(...)` + `flush()`):

1. `test_list_filters_and_none_skip` — seed 3 masters (2 with `position="мастер"`, 1 with `position="senior"`); `repo.list(db, Master, filters={"position": "мастер", "last_name": None}, limit=100)` → 2 items, total 2 (None filter skipped).
2. `test_list_limit_offset_slice_and_total` — seed 5 masters; `limit=2, offset=2` → 2 items, total 5; `offset=4` → 1 item, total 5.
3. `test_list_order_by_applied` — seed 3 masters with distinct `first_name`; `order_by=[Master.first_name.desc()]`, `limit=100` → items in desc order, total 3.
4. `test_list_options_selectinload_does_not_break_count` — use Service with tariffs/tags if convenient, else Master with `options=[selectinload(Master.activities)]` is wrong (Master has no such rel) — simplest: seed 1 Service via the existing service fixture pattern from `tests/services/test_service_service.py` (or create Service directly with `title`, `duration`, `price`); call `repo.list(db, Service, limit=100, options=[selectinload(Service.tariffs), selectinload(Service.tags)])` → total 1, items 1, `items[0].tariffs` loaded without lazy IO.
5. `test_list_custom_count_excludes_order_by` — build `stmt = select(Master)`; `repo.list_custom(db, stmt, order_by=[Master.first_name], limit=2, offset=0)` on 3 seeded masters → 2 items ordered asc, total 3. Then a second case with a **correlated scalar-subquery order key**: `sub = select(func.count(Record.id)).where(Record.master_id == Master.id).correlate(Master).scalar_subquery()` — if Record has no master_id FK use Activity: `select(func.count(Activity.id)).where(Activity.master_id == Master.id).correlate(Master).scalar_subquery()`; `list_custom(db, select(Master), order_by=[sub.desc()], limit=100)` → total 3, items ordered by the subquery (proves count runs on unordered stmt — a count containing the subquery would still pass here, so the real guard is: this must not error and must return total 3).
6. `test_list_custom_limit_offset` — `stmt = select(Master)`, 4 seeded, `limit=1, offset=3` → 1 item, total 4.
7. `test_archive_list_status_default_and_override` — covered by the rewritten `test_soft_delete_repository.py` (do not duplicate).

**Steps:**
- [ ] RED: rewrite the 4 `test_soft_delete_repository.py` tests + create `test_repository_list.py` (tests 1-6). Run `pytest backend/tests/test_soft_delete_repository.py backend/tests/test_repository_list.py` → fail (new signature/return not implemented).
- [ ] GREEN: implement the three methods in `repositories/generic.py` (add `func` to the sqlalchemy import). Run both files → pass.
- [ ] REFACTOR: verify no other references to the old signature: `rg "\.list\(" backend/src/repositories/` and confirm `get_generic_repository` (dead) untouched.
- [ ] Run `pytest backend/tests/` → green, no regressions (nothing in prod calls repo `.list` yet).
- [ ] Commit: `feat(#206): repo-owned paginated list + list_custom on BaseRepository/ArchiveRepository`

---

## Task 2: Rewire `GenericService.list` / `ArchiveService.list`
### Classification: standard
### Required Docs
- Spec §5.3, §6 — service keeps page↔offset, mapping, envelope
- `.opencode/skills/pytest-patterns/SKILL.md`

### Task Description

**File:** `backend/src/services/generic.py`.

**New `GenericService.list`** (replaces L103-114 body):

```python
async def list(
    self,
    db_session: AsyncSession,
    page: int = 1,
    per_page: int = 20,
    order_by=None,
    **filters,
) -> PaginatedResponse[ResponseSchemaT]:
    """Return a paginated page of records, optionally filtered/ordered."""
    items_orm, total = await self._repository.list(
        db_session,
        self._model,
        filters=filters,
        order_by=order_by,
        limit=per_page,
        offset=(page - 1) * per_page,
    )
    items = [self._response_schema.model_validate(o) for o in items_orm]
    return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

**New `ArchiveService.list`** (replaces L242-254 body):

```python
async def list(
    self,
    db_session: AsyncSession,
    page: int = 1,
    per_page: int = 20,
    order_by=None,
    status: ArchiveStatus = ArchiveStatus.ACTIVE,
    **filters,
) -> PaginatedResponse[ResponseSchemaT]:
    """Return a paginated page filtered by archive status."""
    items_orm, total = await self._repository.list(
        db_session,
        self._model,
        status=status,
        filters=filters,
        order_by=order_by,
        limit=per_page,
        offset=(page - 1) * per_page,
    )
    items = [self._response_schema.model_validate(o) for o in items_orm]
    return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

Typing note: `ArchiveService` inherits `GenericService.__init__` typed `repository: BaseRepository`, but every Archive factory injects `get_archive_repository()` — the `status=` kwarg is valid at runtime. If the type checker complains, add `from src.repositories.generic import ArchiveRepository` and `cast(ArchiveRepository, self._repository)` at the call site. Do NOT change factories.

**Keep alive:** `_list_stmt` (used by `list_all`), `_paginate` (still used by `ActivityService._list_by_date` until Task 6), `paginate_orm` (still used by `RecordService.list` until Task 6). Do not delete anything in this task.

**Steps:**
- [ ] Apply both rewrites. No test changes needed — existing contract tests are the spec.
- [ ] Run `pytest backend/tests/services/test_generic_service_contract.py backend/tests/test_soft_delete_service.py backend/tests/test_generic_api_contract.py` → green.
- [ ] Run `pytest backend/tests/` → green.
- [ ] Commit: `refactor(#206): GenericService/ArchiveService list route through repository`

---

## Task 3: Collapse `ServiceService.list` (eager-load path)
### Classification: small
### Required Docs
- Spec §5.3 (services bullet), §6

### Task Description

**File:** `backend/src/services/service.py`. Replace the body of `ServiceService.list` (L40-76: signature stays identical; the inline select/status/filters/count/slice block at L56-76 goes away):

```python
async def list(
    self,
    db_session: AsyncSession,
    page: int = 1,
    per_page: int = 20,
    status: ArchiveStatus = ArchiveStatus.ACTIVE,
    order_by=None,
    **filters,
) -> PaginatedResponse[ServiceResponse]:
    """Return services filtered by archive status, with tariffs and tags."""
    items_orm, total = await self._repository.list(
        db_session,
        Service,
        status=status,
        filters=filters,
        order_by=order_by,
        limit=per_page,
        offset=(page - 1) * per_page,
        options=[selectinload(Service.tariffs), selectinload(Service.tags)],
    )
    items = [ServiceResponse.model_validate(s) for s in items_orm]
    return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

(`self._repository` is an `ArchiveRepository` via `get_service_service()` — `status=` valid; same cast note as Task 2 if the checker complains.)

**Untouched:** `ServiceService.list_all` (L78-111) keeps its inline eager-load probe (spec non-goal). Remove now-unused imports only if nothing else in the file uses them (`func` may become unused — check; `select`, `not_`, `selectinload` are still used by `list_all`).

**Steps:**
- [ ] Apply rewrite.
- [ ] Run `pytest backend/tests/services/test_service_service.py backend/tests/services/test_list_all.py backend/tests/test_generic_api_contract.py` → green.
- [ ] Run `pytest backend/tests/` → green.
- [ ] Commit: `refactor(#206): ServiceService.list via repo.list with selectinload options`

---

## Task 4: Delete `PaymentService.list` override (inherit generic)
### Classification: small
### Required Docs
- Spec §5.3 (payments bullet)

### Task Description

**File:** `backend/src/services/payment.py`. `PaymentService.list` (L30-49) is a field-for-field duplicate of the generic path — **delete the entire override** so `PaymentService` inherits `GenericService.list` (Task 2 version). Signature compatibility: the generic adds an optional `order_by=None` kwarg the old override lacked — harmless (callers don't pass it; routers that need sorting pass it and would previously have errored, which no router does for payments).

Check imports: after deletion, `func`, `select` may be unused in payment.py — remove them if so; keep anything still referenced. `PaginatedResponse` import stays only if used in remaining annotations — the deleted method was its only use; remove if unused.

**Steps:**
- [ ] Delete the override + clean imports.
- [ ] Run `pytest backend/tests/services/test_payment_service.py backend/tests/services/test_generic_service_contract.py backend/tests/test_generic_api_contract.py backend/tests/test_api_pagination_params.py` → green.
- [ ] Run `pytest backend/tests/` → green.
- [ ] Commit: `refactor(#206): drop PaymentService.list inline duplicator (inherit generic)`

---

## Task 5: `VisitService` repo DI + collapse `list`
### Classification: standard
### Required Docs
- Spec §5.3 (visits bullet), §5.4 — VisitService is the ONE service gaining new DI
- `.opencode/skills/pytest-patterns/SKILL.md`

### Task Description

**Files:** `backend/src/services/visit.py`, `backend/tests/services/test_visit_service.py`.

**1. Add DI** (`visit.py`): add import `from src.repositories.generic import BaseRepository, get_base_repository`; add:

```python
class VisitService:
    """Visit service — manual CRUD with record cascade domain hooks."""

    def __init__(self, repository: BaseRepository) -> None:
        self._repository = repository
```

Update factory (L176-179):

```python
@lru_cache
def get_visit_service() -> VisitService:
    """Returns a singleton VisitService."""
    return VisitService(get_base_repository())
```

**2. Collapse `list`** (L32-69): signature stays; replace stmt/count/slice block (L43-51) with repo call; KEEP the manual `VisitResponse(...)` field mapping (L55-68) — iterate over `items_orm` instead of `result.scalars().all()`:

```python
async def list(
    self,
    db_session: AsyncSession,
    page: int = 1,
    per_page: int = 20,
    record_id: str | None = None,
) -> PaginatedResponse[VisitResponse]:
    """Return visits (optionally filtered by record), paginated."""
    items_orm, total = await self._repository.list(
        db_session,
        Visit,
        filters={"record_id": record_id},
        limit=per_page,
        offset=(page - 1) * per_page,
    )
    items = [
        VisitResponse(  # keep the existing field-by-field mapping from L55-68
            id=v.id, record_id=v.record_id, visitor_id=v.visitor_id,
            # ... all other fields EXACTLY as the current code maps them — do
            # not re-derive; copy the current VisitResponse(...) constructor
            # args verbatim, only the loop variable source changes
            ...
        )
        for v in items_orm
    ]
    return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

(`filters={"record_id": None}` is safely skipped by repo when `record_id` is None — same semantics as today.) Clean unused imports (`func`, `select` if now unused elsewhere in the file — `select` IS still used by get/create/etc.; check `func`).

**3. Update 9 test instantiation sites** in `tests/services/test_visit_service.py`: every `VisitService()` → `VisitService(get_base_repository())`, adding `from src.repositories.generic import get_base_repository` to the test-file imports (the file currently imports VisitService inside each test — follow that existing local-import pattern: add the repo import alongside). Sites: L15, L26, L39, L62, L83, L101, L116, L127, L141, L147 (10 call sites in 9 tests).

**Steps:**
- [ ] Apply service changes.
- [ ] Apply test updates.
- [ ] Run `pytest backend/tests/services/test_visit_service.py backend/tests/test_api_pagination_params.py` → green.
- [ ] Run `pytest backend/tests/` → green.
- [ ] Commit: `refactor(#206): VisitService gains repository DI, list via repo.list`

---

## Task 6: Record/Activity → `list_custom`; delete `paginate_orm` + `_paginate`
### Classification: standard
### Required Docs
- Spec §5.3 (activity/record bullets), §6 — count invariant + `list_custom` precondition

### Task Description

**Files:** `backend/src/services/record.py`, `backend/src/services/activity.py`, `backend/src/services/generic.py`.

**1. `record.py`** — in `RecordService.list`, replace (L73-77):

```python
items, total = await paginate_orm(
    db_session, stmt, params.page, params.per_page,
    order_by=self._sort_columns(params),
)
```

with:

```python
items, total = await self._repository.list_custom(
    db_session,
    stmt,
    order_by=self._sort_columns(params),
    limit=params.per_page,
    offset=(params.page - 1) * params.per_page,
)
```

The stmt construction (L50-72: JOIN + `selectinload(Record.visits)` + filters) and `_sort_columns` are untouched — the stmt passed to `list_custom` carries no order_by/limit (precondition holds by construction). Remove the `paginate_orm` import from record.py.

**2. `activity.py`** — in `_list_by_date` (L54-69), replace `return await self._paginate(db_session, stmt, page, per_page)` with:

```python
items_orm, total = await self._repository.list_custom(
    db_session, stmt, limit=per_page, offset=(page - 1) * per_page
)
items = [ActivityResponse.model_validate(a) for a in items_orm]
return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

Ensure `PaginatedResponse` is imported in activity.py (check — likely already; add `from src.schemas.common import PaginatedResponse` if not).

**3. `generic.py`** — now that all callers are migrated: delete `paginate_orm` (L40-57) and `GenericService._paginate` (L96-101). Verify zero references first:

```
rg "paginate_orm|_paginate" backend/src backend/tests
```

Expected after deletion: zero hits. Clean now-unused imports in generic.py (`func` is still used? `_list_stmt` uses `select` only; check `func`, `delete`, `not_` usage — `not_` used by ArchiveService._list_stmt, `delete`/`func` used by delete/reorder paths — verify before removing anything).

**Steps:**
- [ ] Apply record.py + activity.py changes. Run `pytest backend/tests/services/test_record_service.py backend/tests/test_list_activities_query_count.py backend/tests/test_api_records.py backend/tests/test_custom_price.py` → green.
- [ ] Delete `paginate_orm` + `_paginate`; grep-verify zero references.
- [ ] Run `pytest backend/tests/` → green.
- [ ] Commit: `refactor(#206): record/activity via repo.list_custom; retire paginate_orm and _paginate`

---

## Task 7: `PaginationParams` schema + 9 routers + params-model inheritance
### Classification: standard
### Required Docs
- Spec §5.5 — injection idiom rationale (Depends uniformly; fastapi PR #12481), inheritance trap
- `.opencode/skills/pytest-patterns/SKILL.md`

### Task Description

**1. Create `backend/src/schemas/pagination.py`:**

```python
"""Shared pagination query parameters (GH #206)."""

from pydantic import BaseModel, Field


class PaginationParams(BaseModel):
    """page/per_page query params for list endpoints.

    Injected in routers as ``pagination: PaginationParams = Depends()``
    (Depends, not ``Annotated[..., Query()]``: a query-param model cannot
    coexist with other scalar query params in one handler — fastapi PR
    #12481 — and 8 of 9 list routers mix pagination with filters/sort).
    """

    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
```

**2. Migrate 9 routers** (`backend/src/api/v1/`): activities.py, payments.py, locations.py, visits.py, visitors.py, services.py, materials.py, masters.py, tags.py. In each:
- Add import `from src.schemas.pagination import PaginationParams` (and `from fastapi import Depends` if not already imported).
- Replace the two params `page: int = Query(1, ge=1), per_page: int = Query(20, ge=1, le=100),` with `pagination: PaginationParams = Depends(),`.
- Update the service call: `page=page, per_page=per_page` → `page=pagination.page, per_page=pagination.per_page`.
- Keep all other params (`status`, `sort_by`, `sort_order`, `date_from`, `date_to`, `record_id`, `record_ids`) exactly as-is.
- If `Query` becomes unused in a router file, drop it from the fastapi import.

Example (visitors.py L26-34 before → after):

```python
@router.get("", response_model=PaginatedResponse[VisitorResponse])
async def list_visitors(
    service: _ServiceDep,
    session: SessionDep,
    pagination: PaginationParams = Depends(),
) -> PaginatedResponse[VisitorResponse]:
    """Return all visitors, paginated."""
    return await service.list(
        db_session=session, page=pagination.page, per_page=pagination.per_page
    )
```

**3. Inheritance** (`schemas/record.py`, `schemas/client.py`):
- `class RecordListParams(PaginationParams):` — DELETE its `page`/`per_page` field declarations (L129-130); keep everything else incl. the `model_validator`. Update the class docstring: replace the fastapi#4974 sentence with: "Injected as ``Annotated[RecordListParams, Query()]`` (Query, not Depends: this model is the sole query-param carrier for the records endpoint — no scalar-param mixing; Depends-with-model is discouraged upstream)."
- `class ClientListParams(PaginationParams):` — DELETE its `page`/`per_page` declarations (L100-101); keep all filter/sort fields. Injection stays `Depends()` in clients.py.
- Both files: add `from src.schemas.pagination import PaginationParams`; remove `Field` from the pydantic import if now unused (record.py still uses Field? check — likely not after removal; client.py: check).

**Contract risk:** OpenAPI output must be unchanged (flat `page`/`per_page` query params, same defaults/constraints, same 422s). The existing contract tests assert exactly this.

**Steps:**
- [ ] Create schema, migrate 9 routers, apply inheritance.
- [ ] Run `pytest backend/tests/test_generic_api_contract.py backend/tests/test_api_pagination_params.py backend/tests/test_record_list_params.py backend/tests/test_client_stats.py backend/tests/test_schemas_client.py` → green (422s, defaults, envelope echo unchanged).
- [ ] Run `pytest backend/tests/` → green.
- [ ] Commit: `refactor(#206): shared PaginationParams in 9 list routers; params models inherit it`

---

## Task 8: Collapse `ClientListResponse` → `PaginatedResponse[ClientWithStats]` (backend)
### Classification: small
### Required Docs
- Spec §5.6

### Task Description

**Files:** `backend/src/schemas/client.py`, `backend/src/api/v1/clients.py`, `backend/src/services/client.py`, `backend/tests/test_client_stats.py` (and grep-sweep `backend/tests` for other refs).

- `schemas/client.py`: **delete** `ClientListResponse` (L118-124).
- `services/client.py`: return type of `list_clients_with_stats` `ClientListResponse` → `PaginatedResponse[ClientWithStats]`; construction at L257 `ClientListResponse(items=..., total=..., page=..., per_page=...)` → `PaginatedResponse(items=..., total=..., page=..., per_page=...)`; update imports (`from src.schemas.common import PaginatedResponse`; drop `ClientListResponse` from the client-schema import).
- `api/v1/clients.py`: `response_model=ClientListResponse` → `response_model=PaginatedResponse[ClientWithStats]`; return annotation likewise; imports updated (add `PaginatedResponse` + `ClientWithStats` imports, drop `ClientListResponse`).
- `tests/test_client_stats.py` L42-43 (docstring mentioning ClientListResponse) and any import of `ClientListResponse` — update to `PaginatedResponse` wording/imports. Assertion bodies are envelope-shape based and should need no changes.
- Sweep: `rg "ClientListResponse" backend/` → zero hits when done (except none — frontend refs handled in Task 9).

**Steps:**
- [ ] Apply backend changes.
- [ ] Run `pytest backend/tests/test_client_stats.py backend/tests/test_schemas_client.py backend/tests/test_api_pagination_params.py` → green.
- [ ] Run `pytest backend/tests/` → green.
- [ ] Commit: `refactor(#206): collapse ClientListResponse into PaginatedResponse[ClientWithStats]`

---

## Task 9: Collapse `ClientListResponse` in api-client + frontend type rename
### Classification: small
### Required Docs
- Spec §5.6

### Task Description

**Files:** `packages/api-client/src/schemas.ts`, `frontend/admin/contexts/ClientsContext.tsx`, possibly `packages/api-client/src/schemas.test.ts` + `endpoints.ts`/`endpoints.test.ts` (grep first).

**1. api-client** (`packages/api-client/src/schemas.ts` L307-316): mirror the existing per-entity paginated-envelope pattern used for other list responses in that file (e.g. how `PaginatedResponse`X schemas are declared — follow the file's own convention exactly: if it uses a `paginatedResponse(itemSchema)` factory or per-entity `z.object({items, total, page, per_page})` blocks, do the same). Replace the `ClientListResponseSchema` block with a `ClientListResponse` typed via the paginated pattern over `ClientWithStatsSchema`. **Decision:** keep the exported NAME `ClientListResponse` as an alias only if other consumers use it — grep `rg "ClientListResponse" packages/ frontend/` first; the only consumer is `ClientsContext.tsx`, which this task updates — so rename to whatever the file's paginated convention produces (e.g. `PaginatedClientWithStats` / inline generic), preferring consistency with sibling types.
- Update `packages/api-client/src/schemas.test.ts` refs if any.
- Update `packages/api-client/src/endpoints.ts` return-type annotation of `getClientsWithStats` if it names `ClientListResponse`.

**2. frontend** (`frontend/admin/contexts/ClientsContext.tsx`): L19 import — replace `ClientListResponse` with the new type name; L103 `useQuery<ClientListResponse>` → `useQuery<NewType>`. No runtime/visual change.

**Steps:**
- [ ] Grep all `ClientListResponse` refs across `packages/` and `frontend/`; apply renames per above.
- [ ] Run `cd packages/api-client && npm test` → green (4 pre-existing #188 failures stay exactly as-is).
- [ ] Run `cd frontend/admin && npm run test` (no UI change — vitest + tsc only; skip test:all/Playwright) → green, tsc clean.
- [ ] Commit: `refactor(#206): api-client/frontend ClientListResponse type collapse`

---

## Task 10: Domain-rules sync
### Classification: small
### Required Docs
- `docs/domain-rules/records.md` L148-187 — pagination mechanics section being updated
- Spec §6, §8 step 8

### Task Description

**Files:** `docs/domain-rules/records.md` + grep sweep.

- `records.md` (~L187): the pagination mechanics wording references `paginate_orm` — rewrite to describe repo-owned pagination: `BaseRepository.list_custom` wraps the record stmt (JOIN Activity + selectinload visits), count runs on the unordered stmt (correlated sort subqueries never evaluated in count), sort whitelist stays in `RecordService._sort_columns`, repo owns order/limit/offset.
- Sweep: `rg -l "paginate_orm" docs/` — update every hit (expected: records.md only; if others, apply the same mechanic rename).
- Sweep: `rg -l "_paginate|_list_stmt" docs/domain-rules/` — update wording where the generic path is described (services keep page↔offset + envelope; repo owns SQL).
- No other domain-rules content changes (fields/endpoints unchanged).

**Steps:**
- [ ] Apply doc updates.
- [ ] `rg "paginate_orm" docs/ backend/` → zero hits.
- [ ] Commit: `docs(#206): sync domain-rules pagination mechanics with repo-owned list`

---

## Self-Review Notes (architect)

- Spec coverage: §5.1/§5.2 → T1; §5.3 generic → T2; Service → T3; Payment → T4; Visit → T5; Record/Activity + retirement → T6; §5.5 → T7; §5.6 → T8/T9; §8 step 8 → T10; §9 test rewrite → T1. Full coverage.
- Order safety: T1 adds repo API (nobody calls it) → T2-T6 migrate callers → retirement inside T6 after last caller → T7/T8 orthogonal → T9 depends on T8 (type name) → T10 last. Each task lands green.
- Known non-goal confirmed: `ServiceService.list_all`, `PhotoService.list`, `get_generic_repository`, `list_clients_with_stats` internals untouched.
