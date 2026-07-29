# GenericService.list() Mandatory Pagination + API & Frontend Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `GenericService.list()` paginated (`{items, total, page, per_page}`), migrate all 9 bare-list endpoints and all frontend consumers atomically, fix the `getClients()` 20-item truncation bug.

**Architecture:** Backend: new generic `PaginatedResponse[ItemT]` schema + `page`/`per_page` params on `GenericService.list()` (and paginated overrides for the 4 services with custom list logic: ServiceService, RecordService, ActivityService, VisitService). Endpoints gain `page`/`per_page` query params (422 on out-of-bounds). Frontend: api-client adds a `paginatedSchema()` factory, list methods gain optional `{page, per_page}` params returning the envelope; context/hook layers unwrap `.items` (with `per_page=100` where full datasets are needed), keeping all downstream component signatures unchanged.

**Tech Stack:** FastAPI 0.115+, SQLAlchemy 2.0 async, Pydantic v2, pytest; Next.js 14, React Query 5, zod, vitest, pnpm monorepo (`@memo/api-client`).

**Spec:** `docs/specs/2026-07-28-list-pagination-migration-design.md` (G1b approved with amendments: per_page cap 100, 422 on violation, no barelist endpoint, no pagination UI).

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **GenericService.list() paginated** → invisible to the user; API responses now carry `{items, total, page, per_page}` instead of a bare array.
- **All 9 list endpoints migrated** → identical admin UI: masters/locations/tags/materials/services tables, schedule, records table all show the same rows as before.
- **`/clients` unchanged** → Clients page with stats works byte-identically.
- **Frontend consumers migrated** → record/booking form dropdowns (master, location, service, client selects) are populated exactly as before — including clients dropdowns now showing **all** clients instead of silently stopping at 20.
- **per_page ≤ 100 enforced with 422** → no user-visible change; API misuse now fails loudly instead of truncating.
- **Tests green** → backend `pytest` and frontend `pnpm test:all` pass.

---

## File Structure

**Backend — create:**
- `backend/src/schemas/common.py` — `PaginatedResponse` generic schema
- `backend/tests/services/test_generic_service_list.py` — contract tests for paginated list (mirrors `test_generic_service_patch.py` structure from PR #181)

**Backend — modify:**
- `backend/src/services/generic.py` — `list()` signature + pagination
- `backend/src/services/service.py` — paginated override (eager tariffs/tags)
- `backend/src/services/record.py` — paginated override (eager visits, client_id)
- `backend/src/services/activity.py` — paginated override (date range branch)
- `backend/src/services/visit.py` — paginated standalone list
- `backend/src/api/v1/{masters,locations,tags,materials,services,payments,visits,records,activities}.py` — query params + response_model
- `backend/tests/test_api_{masters,locations,tags,materials,services,payments,visits,records,activities}.py`, `test_location_short_title.py`, `test_sort_order.py`, `test_custom_price.py`, `test_coverage_boost.py`, `test_list_activities_query_count.py`, `services/test_visit_service.py` — envelope assertions

**Frontend — create:** none

**Frontend — modify:**
- `packages/api-client/src/schemas.ts` — `PaginatedResponse` type + per-entity list schemas
- `packages/api-client/src/endpoints.ts` — 8 list functions (`getMasters`, `getLocations`, `getTags`, `getMaterials`, `getServices`, `getActivities`, `getPayments`, `getRecords`, `getClients`)
- `packages/api-client/src/endpoints.test.ts` — envelope mocks/URL assertions
- `frontend/admin/contexts/RecordsContext.tsx`, `ScheduleContext.tsx` — unwrap `.items`
- `frontend/admin/hooks/useRecordData.ts` — unwrap `.items`
- `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx` — unwrap `.items`
- `frontend/admin/__tests__/` — mocks returning envelopes (~13 files, mechanical)

---

## Task 1: PaginatedResponse schema + paginated GenericService.list() (RED→GREEN)

### Classification: standard

### Required Docs
- `docs/specs/2026-07-28-list-pagination-migration-design.md` §4.1–4.2 — contract shape and behavior
- `docs/domain-rules/_overview.md` — naming conventions
- Skill: `pytest-patterns` — fixture/factory conventions

### Task Description

Create the generic pagination schema and change `GenericService.list()` to return it.

**Create `backend/src/schemas/common.py`:**

```python
"""Shared Pydantic schemas used across domains."""

from typing import Generic, TypeVar

from pydantic import BaseModel

ItemT = TypeVar("ItemT", bound=BaseModel)


class PaginatedResponse(BaseModel, Generic[ItemT]):
    """Paginated list response envelope."""

    items: list[ItemT]
    total: int
    page: int
    per_page: int
```

**Modify `backend/src/services/generic.py` — replace the `list()` method:**

```python
    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        **filters,
    ) -> PaginatedResponse[ResponseSchemaT]:
        """Return a paginated page of active records, optionally filtered/ordered."""
        stmt = select(self._model)
        if not include_inactive:
            stmt = stmt.where(self._model.is_active)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(self._model, key) == value)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items = [self._response_schema.model_validate(o) for o in result.scalars().all()]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

Important implementation notes:
- Add imports: `from sqlalchemy import func, select` and `from src.schemas.common import PaginatedResponse`.
- The current `GenericService.list()` delegates to `self._repository.list(...)`. The repository pattern for soft-delete entities (`SoftDeleteRepository.list()`) adds `where(table.is_active)`. **All GenericService instances in the codebase use `GenericRepository = SoftDeleteRepository`** — replicate the `is_active` filter inline as shown above (with a plain `stmt = stmt.where(self._model.is_active)`; there is no `include_inactive` usage through GenericService.list in the codebase — verify by grepping for `include_inactive` before writing; if a caller exists, keep an `include_inactive: bool = False` kwarg mirroring the repository). Remove the `if not include_inactive` line if you confirm no such param is needed.
- **Do not delete `BaseRepository.list()` / `SoftDeleteRepository.list()`** — other code may use repositories directly (e.g. coverage tests, photo service). Leave repository layer untouched.
- `page`/`per_page` bounds are NOT validated in the service (type-level only); HTTP 422 validation happens at the endpoint layer via `Query(ge=1, le=100)`.

**Tests — create `backend/tests/services/test_generic_service_list.py`** mirroring the structure of `backend/tests/services/test_generic_service_patch.py` (read it first; reuse its `EntityConfig`/`CONTRACT_CONFIG` approach but simplified — only fields needed for list):

```python
"""Contract tests for GenericService.list() pagination (#182)."""

import pytest

from src.services.master import MasterService, get_master_service
from src.services.location import LocationService, get_location_service
from src.services.tag import TagService, get_tag_service
from src.services.material import MaterialService, get_material_service
from src.services.payment import get_payment_service

pytestmark = pytest.mark.asyncio


async def _create_masters(db_session, n: int) -> None:
    from src.models.master import Master
    for i in range(n):
        db_session.add(Master(
            first_name=f"M{i}", last_name="T", color="#000000",
            position="p", specialty="s",
        ))
    await db_session.flush()
```

Contract test cases (parameterize across at least MasterService + one more simple service; use the `make_entity`-style fixture approach from the patch contract test if practical, otherwise direct model creation as sketched above):

```python
async def test_list_returns_paginated_envelope(db_session):
    """list() returns PaginatedResponse with items/total/page/per_page."""
    await _create_masters(db_session, 3)
    service = get_master_service()
    result = await service.list(db_session, page=1, per_page=20)
    assert result.total == 3
    assert result.page == 1
    assert result.per_page == 20
    assert len(result.items) == 3


async def test_list_total_independent_of_per_page(db_session):
    """total reflects ALL matching rows, items only the requested page."""
    await _create_masters(db_session, 5)
    service = get_master_service()
    page1 = await service.list(db_session, page=1, per_page=2)
    page2 = await service.list(db_session, page=2, per_page=2)
    page3 = await service.list(db_session, page=3, per_page=2)
    assert page1.total == 5 and len(page1.items) == 2
    assert page2.total == 5 and len(page2.items) == 2
    assert page3.total == 5 and len(page3.items) == 1
    ids_p1 = {m.id for m in page1.items}
    ids_p2 = {m.id for m in page2.items}
    assert ids_p1.isdisjoint(ids_p2)


async def test_list_out_of_range_page_returns_empty_items(db_session):
    """Page beyond the end → empty items, correct total."""
    await _create_masters(db_session, 2)
    service = get_master_service()
    result = await service.list(db_session, page=5, per_page=20)
    assert result.total == 2
    assert result.items == []


async def test_list_excludes_inactive(db_session):
    """Soft-deleted (is_active=False) rows are excluded from items AND total."""
    from src.models.master import Master
    await _create_masters(db_session, 2)
    inactive = Master(first_name="X", last_name="Y", color="#111111",
                      position="p", specialty="s", is_active=False)
    db_session.add(inactive)
    await db_session.flush()
    service = get_master_service()
    result = await service.list(db_session, page=1, per_page=20)
    assert result.total == 2
    assert all(m.is_active for m in result.items)


async def test_list_filters_apply_to_total(db_session):
    """Filters narrow both items and total."""
    await _create_masters(db_session, 2)
    service = get_master_service()
    result = await service.list(db_session, page=1, per_page=20, first_name="M0")
    assert result.total == 1
    assert result.items[0].first_name == "M0"
```

NOTE for implementer: check the actual `Master` model required fields (`docs/domain-rules/masters.md` and `backend/src/models/master.py`) — adjust `_create_masters` fields to match (e.g. if `avatar_url` or others are NOT NULL). Same for any second entity you parameterize. Also verify `db_session` fixture name in `backend/tests/conftest.py` (the patch contract test uses `db_session`).

### Steps
- [ ] Read `backend/tests/services/test_generic_service_patch.py` for fixture conventions
- [ ] RED: write `backend/tests/services/test_generic_service_list.py` with the 5 tests above; run `cd backend && pytest tests/services/test_generic_service_list.py -x` → fails (list returns bare list, no page/per_page kwargs)
- [ ] Create `backend/src/schemas/common.py` with `PaginatedResponse`
- [ ] Implement the new `GenericService.list()` in `backend/src/services/generic.py`
- [ ] GREEN: `cd backend && pytest tests/services/test_generic_service_list.py -x` → 5 passed
- [ ] Regression check (expect SOME failures in callers — that's fine at this stage, callers are migrated in Tasks 2-4): `cd backend && pytest tests/services/ -x`
- [ ] Commit: `feat(backend): paginate GenericService.list() with PaginatedResponse (#182)`

---

## Task 2: Paginated list overrides for ServiceService, RecordService, ActivityService, VisitService

### Classification: standard

### Required Docs
- `docs/specs/2026-07-28-list-pagination-migration-design.md` §4.2
- Skill: `pytest-patterns`

### Task Description

Four services have custom list logic that bypasses or wraps `GenericService.list()`. Migrate each to the envelope, preserving eager loading and filters.

**2a. `backend/src/services/service.py`** — replace `list()`:

```python
    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        **filters,
    ) -> PaginatedResponse[ServiceResponse]:
        """Return a paginated page of active services with tariffs/tags eagerly loaded."""
        stmt = (
            select(Service)
            .where(Service.is_active)
            .options(selectinload(Service.tariffs), selectinload(Service.tags))
        )
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Service, key) == value)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items = [ServiceResponse.model_validate(s) for s in result.scalars().all()]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

Notes: current override returns raw ORM `list[Service]` (endpoint validates). New version validates into `ServiceResponse` like the base class — the endpoint already calls `ServiceResponse.model_validate(s)` and will be simplified in Task 3. Add imports `from sqlalchemy import func` and `from src.schemas.common import PaginatedResponse` (`select`, `selectinload` already imported; check `ServiceResponse` import exists).

**2b. `backend/src/services/record.py`** — replace `list()` (keep `client_id` filter, eager visits):

```python
    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        client_id: str | None = None,
        **filters,
    ) -> PaginatedResponse[RecordResponse]:
        """Return a paginated page of active records with visits eagerly loaded."""
        stmt = (
            select(Record)
            .where(Record.is_active)
            .options(selectinload(Record.visits))
        )
        if client_id:
            stmt = stmt.where(Record.client_id == client_id)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(Record, key) == value)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items = [RecordResponse.model_validate(r) for r in result.scalars().all()]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

Note: endpoint currently maps ORM via `_map_record(r)` (which handles nested visits mapping). Check whether `RecordResponse.model_validate(r)` on an ORM object with eager-loaded visits produces the identical shape as `_map_record` — read the current `_map_record` in `backend/src/api/v1/records.py` and `RecordResponse` schema. If `_map_record` does extra work (e.g. computing fields), then keep returning raw ORM from the service and let the endpoint map items; in that case use `PaginatedResponse[Record]`-style construction at the endpoint (see Task 3 note) OR keep service returning `PaginatedResponse[RecordResponse]` only if validation is equivalent. Decide by reading the code; the invariant is: **response JSON identical shape to before, wrapped in envelope**.

**2c. `backend/src/services/activity.py`** — paginate both branches:

```python
    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        date_from: str | None = None,
        date_to: str | None = None,
        **filters,
    ) -> PaginatedResponse[ActivityResponse]:
        """List activities with optional date range filter, paginated."""
        if date_from or date_to:
            return await self._list_by_date(db_session, date_from, date_to, page, per_page)
        return await super().list(db_session, page=page, per_page=per_page, **filters)
```

Rewrite `_list_by_date` to paginate its date-filtered statement the same way (count via subquery, limit/offset, validate to `ActivityResponse`). Read the current `_list_by_date` body first and preserve its exact date-filter WHERE logic. Note: the endpoint separately computes `occupied` per activity via `sum_active_seats_bulk` and `_map_response` — the service returning validated `ActivityResponse` items is fine because the endpoint re-maps them (Task 3); ensure `ActivityResponse.model_validate` on ORM keeps working as it does in the current `super().list()` path (base class already validates, so no change).

**2d. `backend/src/services/visit.py`** — VisitService is standalone (not GenericService). Replace `list()`:

```python
    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        record_id: str | None = None,
    ) -> PaginatedResponse[VisitResponse]:
        """Return a paginated page of visits, optionally filtered by record_id."""
        stmt = select(Visit)
        if record_id is not None:
            stmt = stmt.where(Visit.record_id == record_id)
        total = (
            await db_session.execute(select(func.count()).select_from(stmt.subquery()))
        ).scalar_one()
        result = await db_session.execute(
            stmt.limit(per_page).offset((page - 1) * per_page)
        )
        items = [VisitResponse.model_validate(v) for v in result.scalars().all()]
        return PaginatedResponse(items=items, total=total, page=page, per_page=per_page)
```

Note: the visits endpoint currently maps ORM via `_map_visit(v)`. Same invariant as records: read `_map_visit` first; if it computes extra fields, keep service returning ORM and map at endpoint instead. **Decide per-entity after reading the mappers; document the choice in your report.**

Also check current visit list soft-delete semantics: the existing test `test_list_visits_excludes_deleted` asserts deleted visits are absent. If the current `VisitService.list()` has no `is_active` filter but the test passes, deletion may hard-delete or the ORM default filters — read `VisitService.delete()` and the Visit model; preserve whatever semantics exist today.

**Tests** — add to `backend/tests/services/test_generic_service_list.py` (or per-service test files following existing layout, e.g. extend `tests/services/test_visit_service.py`):

```python
async def test_service_service_list_paginated(db_session):
    """ServiceService.list returns envelope with eager-loaded tariffs/tags."""
    # create 3 services via service.create() with valid ServiceCreate payloads
    # (read backend/src/schemas/service.py for required fields and
    #  docs/domain-rules/services.md)
    result = await get_service_service().list(db_session, page=1, per_page=2)
    assert result.total == 3
    assert len(result.items) == 2
    assert hasattr(result.items[0], "tariffs")
    assert hasattr(result.items[0], "tags")


async def test_record_service_list_paginated_with_client_filter(db_session, create_record):
    """RecordService.list paginates and filters by client_id."""
    record = create_record()  # API-level fixture; inspect conftest for exact fixture shape
    service = get_record_service()
    result = await service.list(db_session, page=1, per_page=20,
                                client_id=record["client_id"])
    assert result.total >= 1
    result_other = await service.list(db_session, page=1, per_page=20,
                                      client_id="nonexistent")
    assert result_other.total == 0


async def test_visit_service_list_paginated(db_session, sample_visits):
    """VisitService.list returns envelope; record_id filter still works."""
    service = VisitService()
    result = await service.list(db_session, page=1, per_page=2)
    assert result.total == len(sample_visits)
    assert len(result.items) == 2
    filtered = await service.list(
        db_session, page=1, per_page=20, record_id=sample_visits[0].record_id
    )
    assert all(v.record_id == sample_visits[0].record_id for v in filtered.items)
```

Update `backend/tests/services/test_visit_service.py` existing 2 tests to use `.items` / `.total` (`len(result.items)`, iterate `result.items`).

### Steps
- [ ] Read `_map_record`/`_map_visit` endpoint mappers and `RecordResponse`/`VisitResponse` schemas; decide ORM-vs-validated return per the invariants above
- [ ] RED: write the 3 new service tests + update 2 visit tests; run `cd backend && pytest tests/services/ -x` → fails
- [ ] Implement 2a–2d
- [ ] GREEN: `cd backend && pytest tests/services/ -x` → all pass
- [ ] Commit: `feat(backend): paginated list overrides for services/records/activities/visits (#182)`

---

## Task 3: Migrate 9 list endpoints (query params + response_model) + update API tests

### Classification: large

### Required Docs
- `docs/specs/2026-07-28-list-pagination-migration-design.md` §4.3, §6
- Skill: `pytest-patterns`

### Task Description

**Endpoint changes (per file in `backend/src/api/v1/`):** add pagination query params and change `response_model`. Uniform params:

```python
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
```

| File | Endpoint | Change |
|---|---|---|
| `masters.py` | `list_masters` | `response_model=PaginatedResponse[MasterResponse]`; add params; pass `page=page, per_page=per_page` into `service.list(...)` (keep existing `order_by`) |
| `locations.py` | `list_locations` | same, keep `order_by` |
| `tags.py` | `list_tags` | `response_model=PaginatedResponse[TagResponse]`; add params; pass through |
| `materials.py` | `list_materials` | `response_model=PaginatedResponse[MaterialResponse]`; same |
| `services.py` | `list_services` | `response_model=PaginatedResponse[ServiceResponse]`; service now returns validated envelope → **return it directly**, delete the `[ServiceResponse.model_validate(s) for s in services]` line |
| `payments.py` | `list_payments` | `response_model=PaginatedResponse[PaymentResponse]`; keep `record_id` filter building; pass page/per_page |
| `visits.py` | `list_visits` | `response_model=PaginatedResponse[VisitResponse]`; if Task 2 kept ORM return: `result = await service.list(...)` then `PaginatedResponse(items=[_map_visit(v) for v in result.items], total=result.total, page=result.page, per_page=result.per_page)`; if validated: return directly (with `_map_visit` applied to items if it adds computed fields) |
| `records.py` | `list_records` | same pattern as visits with `_map_record` |
| `activities.py` | `list_activities` | `response_model=PaginatedResponse[ActivityResponse]`; add params; `result = await service.list(db_session=session, page=page, per_page=per_page, date_from=date_from, date_to=date_to)`; `occupied_map = await service.sum_active_seats_bulk(db_session=session, activity_ids=[a.id for a in result.items])`; return `PaginatedResponse(items=[_map_response(a, occupied=occupied_map.get(a.id, 0)) for a in result.items], total=result.total, page=result.page, per_page=result.per_page)`. Note `_map_response` currently takes ORM; items may now be `ActivityResponse` — adjust `_map_response` to accept the validated schema (set `.occupied` on it) — read the code and keep it minimal |

Imports per router: `from fastapi import Query` (where missing) and `from src.schemas.common import PaginatedResponse`.

**API test updates** — for every list assertion change bare-array access to envelope:

- `test_api_masters.py::test_list_masters_includes_created`:
```python
        response = api_client.get("/api/v1/masters")
        assert response.status_code == 200
        body = response.json()
        masters = body["items"]
        assert body["total"] >= 1
        assert body["page"] == 1
        assert body["per_page"] == 20
        ids = [m["id"] for m in masters]
        assert master_id in ids
```
- `test_api_locations.py`, `test_location_short_title.py` — same pattern (`body["items"]`).
- `test_api_tags.py` (2 tests: empty → `body["items"] == []`, `body["total"] == 0`; after_create → items contain created).
- `test_api_materials.py` (2 tests), `test_api_services.py` (1 test) — same pattern.
- `test_api_activities.py` (3 tests): `activities = response.json()["items"]`; the date-range test keeps `len(activities) == 2` and adds `assert response.json()["total"] == 2`.
- `test_api_payments.py::test_list_payments_includes_created` — same pattern.
- `test_api_visits.py` (3 tests): `data = response.json()["items"]`; `len(data) >= 1` becomes `response.json()["total"] >= 1` where appropriate; filtered test iterates `data` (now items).
- `test_api_records.py::test_list_records_includes_created` — `records = response.json()["items"]`.
- `test_custom_price.py::test_list_records_includes_custom_price` — items access.
- `test_sort_order.py` (4 tests: masters/locations sorted + reorder) — read each; list responses → `["items"]`. Note: `reorder` endpoints still return `list[...]` (NOT migrated — only GET list endpoints change). Only GET list assertions change.
- `test_coverage_boost.py` — update the list tests enumerated in the explore report (`test_list_masters`, `test_list_locations`, `test_list_services`, `test_list_tags`, `test_list_activities_date_from_only`, `test_list_activities_date_to_only`, `test_list_payments`): `resp.json()["items"]` and totals. Visitor/photo tests untouched (not migrated endpoints). For `TestActivityServiceDateFiltering` tests that call the SERVICE directly (read them: if they call `ActivityService.list()`), adapt to envelope (`result.items`, `result.total`).
- `test_list_activities_query_count.py` — read the test; it counts queries for the list endpoint. Pagination adds exactly ONE count query. Update the bound accordingly (e.g. if it asserts `<= N`, expect `N+1`); the bounded-ness property must still hold. If it asserts an exact count, set the new exact count from the GREEN run.

**New 422 tests** — add one parametrized test module or extend an existing file (`backend/tests/test_api_pagination_params.py`):

```python
"""Query-param validation for paginated list endpoints (#182)."""

import pytest

pytestmark = pytest.mark.api

ENDPOINTS = [
    "/api/v1/masters",
    "/api/v1/locations",
    "/api/v1/tags",
    "/api/v1/materials",
    "/api/v1/services",
    "/api/v1/activities",
    "/api/v1/payments",
    "/api/v1/visits",
    "/api/v1/records",
]


@pytest.mark.parametrize("endpoint", ENDPOINTS)
@pytest.mark.parametrize("params", [
    {"per_page": 101},
    {"per_page": 0},
    {"page": 0},
])
def test_invalid_pagination_params_return_422(api_client, endpoint, params):
    resp = api_client.get(endpoint, params=params)
    assert resp.status_code == 422


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_default_pagination_envelope(api_client, endpoint):
    resp = api_client.get(endpoint)
    assert resp.status_code == 200
    body = resp.json()
    assert body["page"] == 1
    assert body["per_page"] == 20
    assert isinstance(body["items"], list)
    assert isinstance(body["total"], int)
```

**Regression guards:** `test_api_clients.py`, `test_client_stats.py` must pass UNCHANGED (do not touch them).

### Steps
- [ ] RED: write `test_api_pagination_params.py`; run `cd backend && pytest tests/test_api_pagination_params.py -x` → fails (no params / 200 or wrong shape)
- [ ] Migrate the 9 endpoints per table above
- [ ] Update all listed API tests to envelope assertions
- [ ] GREEN: `cd backend && pytest` → full suite green (including untouched clients/photos/search tests)
- [ ] Verify `test_list_activities_query_count.py` bound updated by exactly the count delta observed
- [ ] Commit: `feat(backend): paginated response on all generic list endpoints (#182)`

---

## Task 4: api-client — paginated schemas + list method migration

### Classification: standard

### Required Docs
- `docs/specs/2026-07-28-list-pagination-migration-design.md` §4.4–4.5
- Skill: `vitest-playwright-patterns`

### Task Description

**4a. `packages/api-client/src/schemas.ts`** — add after `ClientListResponseSchema` block (keep it unchanged):

```typescript
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export function paginatedSchema<T extends z.ZodType>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    total: z.number(),
    page: z.number(),
    per_page: z.number(),
  });
}

export const MasterListResponseSchema = paginatedSchema(MasterResponseSchema);
export const LocationListResponseSchema = paginatedSchema(LocationResponseSchema);
export const TagListResponseSchema = paginatedSchema(TagResponseSchema);
export const MaterialListResponseSchema = paginatedSchema(MaterialResponseSchema);
export const ServiceListResponseSchema = paginatedSchema(ServiceResponseSchema);
export const ActivityListResponseSchema = paginatedSchema(ActivityResponseSchema);
export const PaymentListResponseSchema = paginatedSchema(PaymentResponseSchema);
export const RecordListResponseSchema = paginatedSchema(RecordResponseSchema);
```

(Place `paginatedSchema` near the top after imports if schemas are referenced before definition — check file organization; zod schemas are const-hoisted per module order, so put the factory BEFORE first use.)

**4b. `packages/api-client/src/endpoints.ts`** — migrate list functions. Uniform pattern: optional `page`/`per_page` params, return envelope.

```typescript
export interface ListParams {
  page?: number;
  per_page?: number;
}

function listQuery(params?: ListParams): string {
  const search = new URLSearchParams();
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function getMasters(params?: ListParams): Promise<PaginatedResponse<MasterResponse>> {
  return api(`/api/v1/masters${listQuery(params)}`, MasterListResponseSchema);
}

export async function getLocations(params?: ListParams): Promise<PaginatedResponse<LocationResponse>> {
  return api(`/api/v1/locations${listQuery(params)}`, LocationListResponseSchema);
}

export async function getTags(params?: ListParams): Promise<PaginatedResponse<TagResponse>> {
  return api(`/api/v1/tags${listQuery(params)}`, TagListResponseSchema);
}

export async function getMaterials(params?: ListParams): Promise<PaginatedResponse<MaterialResponse>> {
  return api(`/api/v1/materials${listQuery(params)}`, MaterialListResponseSchema);
}

export async function getServices(params?: ListParams): Promise<PaginatedResponse<ServiceResponse>> {
  return api(`/api/v1/services${listQuery(params)}`, ServiceListResponseSchema);
}

export async function getActivities(params: {
  date_from: string;
  date_to: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<ActivityResponse>> {
  const search = new URLSearchParams();
  search.set('date_from', params.date_from);
  search.set('date_to', params.date_to);
  if (params.page) search.set('page', String(params.page));
  if (params.per_page) search.set('per_page', String(params.per_page));
  return api(`/api/v1/activities?${search.toString()}`, ActivityListResponseSchema);
}

export async function getPayments(params?: {
  record_id?: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<PaymentResponse>> {
  const search = new URLSearchParams();
  if (params?.record_id) search.set('record_id', params.record_id);
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return api(`/api/v1/payments${qs ? `?${qs}` : ''}`, PaymentListResponseSchema);
}

export async function getRecords(params?: {
  date_from?: string;
  date_to?: string;
  client_id?: string;
  page?: number;
  per_page?: number;
}): Promise<PaginatedResponse<RecordResponse>> {
  const search = new URLSearchParams();
  if (params?.date_from) search.set('date_from', params.date_from);
  if (params?.date_to) search.set('date_to', params.date_to);
  if (params?.client_id) search.set('client_id', params.client_id);
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  const qs = search.toString();
  return api(`/api/v1/records${qs ? `?${qs}` : ''}`, RecordListResponseSchema);
}
```

**Bug fix — `getClients()`:**

```typescript
export async function getClients(): Promise<ClientWithStats[]> {
  return api('/api/v1/clients?per_page=100', ClientListResponseSchema).then(r => r.items);
}
```

Return type corrected `ClientResponse[]` → `ClientWithStats[]` (that's what the endpoint actually returns). Check `ClientWithStats` type is exported from schemas.ts (it is — `ClientWithStatsSchema` exists; export the inferred type if not already). **Check downstream type breakage**: `RecordsContext` types `clientsRaw` as `ClientResponse[]` — `ClientWithStats` extends the client fields so structural typing should be compatible; fix type annotations where tsc complains (Task 5).

**4c. `packages/api-client/src/endpoints.test.ts`** — update list-function tests:

- Mock resolution values become envelopes: `vi.mocked(api).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 })`.
- URL assertions: `getMasters()` → `'/api/v1/masters'`; `getMasters({ per_page: 100 })` → `'/api/v1/masters?per_page=100'`; `getActivities({date_from:'2024-01-01', date_to:'2024-01-07'})` → `'/api/v1/activities?date_from=2024-01-01&date_to=2024-01-07'`; with pagination → `'...&per_page=100'`.
- New test: `getClients` calls `'/api/v1/clients?per_page=100'` and returns `items` array (mock envelope with 1 item, assert result equals items array).

### Steps
- [ ] RED: update `endpoints.test.ts` mocks/assertions + new getClients test; run `cd packages/api-client && pnpm vitest run` → fails
- [ ] Implement 4a + 4b
- [ ] GREEN: `cd packages/api-client && pnpm vitest run` → all pass
- [ ] Type-check the workspace: `cd frontend/admin && pnpm tsc --noEmit` → expect errors in consumers (fixed in Task 5); api-client itself must have no errors
- [ ] Commit: `feat(api-client): paginated list methods + getClients per_page fix (#182)`

---

## Task 5: frontend consumers — unwrap envelopes (RecordsContext, ScheduleContext, useRecordData, ClientCardModal)

### Classification: standard

### Required Docs
- `docs/specs/2026-07-28-list-pagination-migration-design.md` §4.5
- Skill: `vitest-playwright-patterns`

### Task Description

Only 4 source files consume migrated list functions. Unwrap `.items` at the query layer; **downstream types (`ActivityResponse[]` etc.) stay unchanged** so no component/table/modal changes are needed.

**5a. `frontend/admin/contexts/RecordsContext.tsx`** (6 queries):

```typescript
  const { data: records = [] } = useQuery<RecordResponse[]>({
    queryKey: ['records', dateFrom, dateTo],
    queryFn: () => getRecords({ date_from: dateFrom, date_to: dateTo, per_page: 100 }).then(r => r.items),
  });
```
Apply the same `.then(r => r.items)` + `per_page: 100` to: activities query (keep date params), masters, services, locations (`staleTime: Infinity` queries), clients (`getClients()` — **no change needed**, it now returns all clients itself), payments (`getPayments({ per_page: 100 })`).

Note: records/activities are date-ranged already; `per_page: 100` preserves current full-list behavior within the range. Read the actual current code around lines 40-100 and apply minimal edits; keep queryKeys unchanged (cache shape stays `RecordResponse[]` etc.).

**5b. `frontend/admin/contexts/ScheduleContext.tsx`** (4 queries, lines ~268-292): same pattern — `.then(r => r.items)` on activities (keep week params, add `per_page: 100`), masters, services, locations. Generic param of `useQuery<ActivityResponse[]>` etc. unchanged.

**5c. `frontend/admin/hooks/useRecordData.ts`** (4 queries, lines ~31-50):

```typescript
  const { data: services = [] } = useQuery({
    queryKey: ['services'],
    queryFn: () => getServices({ per_page: 100 }).then(r => r.items),
  });
```
Same for masters, locations. Payments query: `getPayments({ record_id: recordId, per_page: 100 }).then(r => r.items)` (keep `enabled: !!recordId`).

**5d. `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx`** (line ~56):

```typescript
    queryFn: () => getRecords({ client_id: client?.id!, per_page: 100 }).then(r => r.items),
```

**5e. Verify nothing else consumes migrated functions:** `cd frontend/admin && rg "getMasters|getLocations|getTags|getMaterials|getServices|getActivities|getPayments|getRecords|getClients\b" --type ts --type tsx -l` (excluding `__tests__`) — every hit must be one of the 4 files above or a hook (useMasters/useLocations/useServices/useActivities delegate to... check: these hooks call `getMasters()` etc. directly!). **Hooks `useMasters.ts`, `useLocations.ts`, `useServices.ts`, `useActivities.ts` also need migration:**

```typescript
export function useMasters() {
  return useQuery<MasterResponse[], Error, Master[]>({
    queryKey: ['masters'],
    queryFn: () => getMasters({ per_page: 100 }).then(r => r.items),
    select: (raw) => raw.map(transformMaster),
    staleTime: 5 * 60 * 1000,
  });
}
```
Same for useLocations/useServices. useActivities: `getActivities({ date_from: weekStart, date_to: weekEnd, per_page: 100 }).then(r => r.items)`.

So full consumer list: RecordsContext, ScheduleContext, useRecordData, ClientCardModal, useMasters, useLocations, useServices, useActivities (8 files). MastersTable/LocationsTable/TagsTable/ServicesTable/MaterialsTable — check whether they call `getMasters()` directly via useQuery (explore report says "direct import + useQuery") — **read each table file; if it has its own `useQuery({queryFn: getMasters})`, apply the same unwrap**. Update the list before starting.

**Tests** (`frontend/admin/__tests__/`): mocks of api-client functions must return envelopes. Files to update (verify by grep for `mockResolvedValue` near these function names):

- `RecordsContext.test.tsx`: `vi.mocked(getRecords).mockResolvedValue({ items: [], total: 0, page: 1, per_page: 100 })` etc. — for getRecords/getPayments/getActivities/getMasters/getServices/getLocations. `getClients` stays `mockResolvedValue([])` (it still returns an array). Note one assertion uses `getQueryData<RecordResponse[]>(['records', ...])` — cache still holds arrays, unchanged. Where a test does `vi.mocked(getRecords).mockResolvedValue([rec1])` → `{ items: [rec1], total: 1, page: 1, per_page: 100 }`.
- `ScheduleContext.test.tsx` — same pattern for its 4 mocked functions.
- `useRecordData.test.tsx` — same for getServices/getMasters/getLocations/getPayments.
- `useReactQueryHooks.test.tsx` — `vi.mocked(getMasters).mockResolvedValue(mastersFixture)` → envelope with `items: mastersFixture`; transformer assertions unchanged (select still receives array).
- Any other test mocking these functions (Menubar, StampPanel, CellHeight, ServicesTable, MastersTable, LocationsTable, RecordsTable, WeekView, DayView, ClientsContext) — grep and update identically. Tests mocking `useQuery`/contexts directly (MastersTable.test.tsx mocks `@tanstack/react-query`; ActivityDetailsModal.test.tsx mocks contexts) need NO changes.

DoD includes: `cd frontend/admin && pnpm tsc --noEmit` clean, `pnpm test` (vitest) green.

### Steps
- [ ] Inventory: run the grep above; list every consumer file (expect the 8 named + possibly 5 table files); report the list before editing
- [ ] RED: update `RecordsContext.test.tsx` mocks to envelopes → `pnpm vitest run __tests__/RecordsContext.test.tsx` fails
- [ ] Migrate RecordsContext.tsx → that test green
- [ ] Repeat per file: update test mocks (where they exist) → migrate source → verify its tests
- [ ] `cd frontend/admin && pnpm tsc --noEmit` → clean
- [ ] `cd frontend/admin && pnpm test` → full vitest green
- [ ] Commit: `feat(admin): unwrap paginated list responses in contexts/hooks (#182)`

---

## Task 6: Full verification — e2e + backend suite + visual spot check

### Classification: small

### Required Docs
- `docs/specs/2026-07-28-list-pagination-migration-design.md` §8 (visual compliance checks)
- `docs/plans/2026-06-17-e2e-fix-and-speedup-plan.md` — only if e2e invocation is unclear; otherwise use package.json scripts

### Task Description

Final gate before review: prove the visible behavior is unchanged.

### Steps
- [ ] `cd backend && pytest` → full suite green
- [ ] `cd frontend/admin && pnpm test` (vitest) → green
- [ ] `cd frontend/admin && pnpm test:e2e` → green (Playwright suite exercises dropdowns, tables, schedule, records — it IS the visual regression check; note in report which spec files cover: master/location/service selects, payments list, ActivityDetailsModal)
- [ ] Manual seed check for the getClients bug: if an e2e or seed path exists with >20 clients (check `backend/src/seed/seed.py` client count), note it; if seed has <20 clients, the bug fix is covered by the api-client unit test asserting `per_page=100` — acceptable
- [ ] If any e2e fails: diagnose whether it's migration-related (response shape) or pre-existing flake (check against baseline on main); report, do not fix unrelated flakes
- [ ] No commit unless fixes were needed: `test: verify pagination migration e2e (#182)`

---

## Self-Review Notes (architect)

- Spec coverage: §4.1→Task 1, §4.2→Tasks 1-2, §4.3→Task 3, §4.4→Task 4, §4.5→Tasks 4-5, §5 tests→Tasks 1-6, §6 AC→Tasks 3,5,6, §8 visual→Task 6. G1b amendments: per_page cap 100 + 422→Task 3, no barelist→(nothing to do), getClients fix→Task 4.
- Type consistency: `PaginatedResponse[T]` backend ↔ `PaginatedResponse<T>` + `paginatedSchema()` frontend — envelope fields identical (`items, total, page, per_page`).
- Out of scope (spec §3): `/photos`, `/search/*`, `/clients/{id}/visitors`, `/visitors/{id}`, reorder endpoints — untouched.
- Known risk: Task 2 ORM-vs-validated decisions for records/visits mappers — flagged with explicit invariants for the implementer.
