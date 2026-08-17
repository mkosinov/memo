# GH #205 — Dictionaries: bare `/all` endpoint + server-side pagination for dictionary tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in bare `GET /api/v1/{entity}/all` endpoints (full array, 1000-row protective limit → 422) for the 5 dictionaries (masters, locations, services, tags, materials); migrate the 5 dictionary admin tables to server-side pagination + sorting (Clients/Records pattern); migrate dictionary dropdowns/lookup-maps to `/all`.

**Architecture:** Backend — `GenericService.list_all()` with a shared limit+1 probe (single choke point), per-router `/all` routes declared before `/{id}` (str path params!), per-entity sort whitelists as `Literal` query params resolved to `order_by` in the routers (records idiom). api-client — bare-array zod schemas + `getAllX` methods, `ListParams` gains sort params. Frontend — one `createPagedListContext` factory + 5 thin per-entity context wrappers (Clients/Records shape; `setSort`/`setPerPage`/`setStatus` reset page to 1), tables consume contexts, lookups switch to `getAllX` with unchanged cache keys.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (async) + SQLite + Pydantic v2 (backend); Next.js 14 + TypeScript + Zod + @tanstack/react-query v5 (api-client + admin).

**Spec:** `docs/specs/2026-08-17-dictionaries-all-server-pagination-design.md` (all § refs point there). G1b amendments are in spec §6 — search boxes stay client-side (untouched), `/all` is per-router, limit message in English.

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Bare `/all` for 5 dictionaries (AC1)** → API consumers can fetch the full master/location/service/tag/material list in one call (`GET /api/v1/masters/all`), always in a stable deterministic order, active rows by default (`?status=all/archived` on archive entities; tags have no status).
- **Protective limit (AC2)** → if a dictionary ever exceeds 1000 rows, `/all` fails loudly with a 422 and an English message pointing to the paginated endpoint — never a silently truncated list. Exactly 1000 rows still works.
- **Dictionaries-only guard (AC3)** → `/all` does not exist for clients/records/activities/visits/payments/visitors (404).
- **Server-side sorting (AC4)** → clicking a sortable column header in a dictionary table re-fetches sorted data from the server; an invalid sort key is a 422, not a silent fallback. Default row order in services/tags/materials lists becomes deterministic (was: unspecified DB order).
- **Server-paginated tables (AC6)** → Masters/Locations/Services/Materials/Tags tables page through server data: the pager (10/20/50/100 per page, numbered pages, prev/next, "всего" label) reflects the real server total; changing page, page size, sort, or status tab issues a new parametrized request and returns to page 1 where relevant. No more hidden 100-row cap.
- **Lookups via `/all` (AC7)** → record/schedule pages and form dropdowns load complete dictionaries via `/all`; `per_page=100` disappears for masters/services/locations everywhere in the frontend.
- **Search boxes unchanged (G1b Q1)** → the search inputs in dictionary tables keep filtering the currently loaded page client-side (accepted temporary degradation until #212's server `?q=`).
- **No other visible change** → CRUD, modals, archive/restore, delete-deps UX, page URLs all behave as before.

---

## File Map

**Backend:**
- `backend/src/domain/errors.py` — NEW: `BareListLimitExceededError` (Task 1)
- `backend/src/services/generic.py` — `BARE_LIST_MAX_ROWS`, `GenericService.list_all()`, `ArchiveService.list_all()` (Task 1)
- `backend/src/services/service.py` — `ServiceService.list_all()` override with selectinload (Task 1)
- `backend/src/schemas/common.py` — `SortOrder = Literal["asc","desc"]` (Task 3)
- `backend/src/schemas/{master,location,service,material,tag}.py` — per-entity `XSortBy` Literals (Task 3)
- `backend/src/api/v1/{masters,locations,services,tags,materials}.py` — `/all` routes (Task 2); `sort_by`/`sort_order` params + SORT_MAPs + deterministic default orders (Task 3)
- `backend/tests/services/test_list_all.py` — NEW: service-level tests (Task 1)
- `backend/tests/generic_contract.py` — `BARE_ALL_ENTITIES` + `_all_params()` + `earlier_create_data` on 5 configs (Task 4)
- `backend/tests/test_generic_api_contract.py` — `TestGenericApiAllContract` + non-dictionary 404 test (Task 4)
- `backend/tests/test_api_{masters,locations,services,materials}.py` — sort/default-order tests (Task 3); `backend/tests/test_api_tags.py` — NEW (tags smoke + sort tests, Tasks 2–3)

**api-client:**
- `packages/api-client/src/schemas.ts` — 5 `XAllResponseSchema = z.array(XResponseSchema)` (Task 5)
- `packages/api-client/src/endpoints.ts` — `ListParams` + `listQuery` sort params; `AllParams`; 5 `getAllX` (Task 5)
- `packages/api-client/src/endpoints.test.ts` — new method + sort serialization tests (Task 5)

**Frontend admin:**
- `frontend/admin/contexts/createPagedListContext.tsx` — NEW factory (Task 6)
- `frontend/admin/__tests__/createPagedListContext.test.tsx` — NEW (Task 6)
- `frontend/admin/contexts/{Masters,Locations,Services,Materials,Tags}Context.tsx` — NEW thin wrappers (Tasks 7–11)
- `frontend/admin/app/(main)/{masters,locations,services,tags}/page.tsx` + `services/page.tsx` (+ materials page wherever MaterialsTable is embedded) — wrap with providers (Tasks 7–11)
- `frontend/admin/app/(main)/{masters,locations,tags}/components/{Masters,Locations,Tags}Table.tsx`, `services/components/{Services,Materials}Table.tsx` — migrate to contexts (Tasks 7–11)
- `frontend/admin/__tests__/{MastersTable,LocationsTable,ServicesTable,MaterialsTable}.test.tsx` + `tags/TagsTable.test.tsx` — rewrite/extend (Tasks 7–11)
- `frontend/admin/contexts/RecordsContext.tsx` (:143-159), `ScheduleContext.tsx` (:271-287), `hooks/useRecordData.ts` (:33-48), `hooks/{useMasters,useLocations,useServices}.ts` (:11) — `/all` migration (Task 12)
- `frontend/admin/__tests__/` — invalidation prefix test (Task 12)

**Domain docs:**
- `docs/domain-rules/{masters,locations,services,tags,materials}.md` — "List contract" sections (Task 13)

No DB schema changes → no migrations, no seed changes.

---

## Task 1: `GenericService.list_all()` + `BareListLimitExceededError` + `ServiceService` override
### Classification: standard

### Required Docs
- Spec §4.1, §4.3, §4.4 (list_all contract, limit error, orders)
- `backend/src/services/generic.py` — `_list_stmt` (:83-89), `_paginate` (:91-96), `list` (:98-109), `ArchiveService._list_stmt`/`list` (:205-224)
- `backend/src/services/service.py` — `ServiceService.list` override (:39-67) — the eager-load pattern to mirror
- Skill: pytest-patterns (fixtures, db_session usage)

### Task Description
Create the shared unpaginated list path. New domain error in a NEW module `backend/src/domain/errors.py`. `BARE_LIST_MAX_ROWS = 1000` module-level constant in `generic.py`. `GenericService.list_all()` runs `_list_stmt(**filters)` + optional `order_by` + `LIMIT 1001` probe; >1000 rows → raise; else validate into response schema (same idiom as `_paginate`). `ArchiveService.list_all()` passes `status` through (its `_list_stmt` override already handles the status filter). `ServiceService.list_all()` mirrors its `list()` override with `selectinload(Service.tariffs), selectinload(Service.tags)` — MANDATORY, else async lazy-load crash (spec §4.1).

### Steps
- [ ] **RED:** Create `backend/tests/services/test_list_all.py` with failing tests. NOTE: the `create_master`/`create_service` conftest fixtures are SYNC factory callables (`factory(**overrides)` wrapping `api_client.post`, returning plain dicts) — no `await`, access ids via `["id"]`. Async tests follow the project's existing async-test idiom (check how other `db_session`-based tests are declared/marked).
  ```python
  """Service-level tests for GenericService.list_all (#205)."""
  import pytest
  from sqlalchemy import insert, asc
  from src.domain.errors import BareListLimitExceededError
  from src.models.enums import ArchiveStatus
  from src.models.master import Master
  from src.models.tag import Tag
  from src.services.generic import BARE_LIST_MAX_ROWS
  from src.services.master import get_master_service
  from src.services.tag import get_tag_service
  from src.services.service import get_service_service

  # 1. returns full list, no envelope
  async def test_list_all_returns_all_rows(db_session, create_master):
      created = create_master()
      result = await get_master_service().list_all(db_session)
      assert isinstance(result, list) and [m.id for m in result] == [created["id"]]

  # 2. ArchiveService status filter parity
  async def test_list_all_status_filter(db_session, create_master):
      m = create_master()
      svc = get_master_service()
      await svc.archive(db_session, m["id"])  # ArchiveService.archive(db_session, id) — generic.py:227
      assert await svc.list_all(db_session) == []
      assert len(await svc.list_all(db_session, status=ArchiveStatus.ALL)) == 1
      assert len(await svc.list_all(db_session, status=ArchiveStatus.ARCHIVED)) == 1

  # 3. order_by applied
  async def test_list_all_order_by(db_session, create_master):
      b = create_master(first_name="Boris")
      a = create_master(first_name="Anna")
      result = await get_master_service().list_all(db_session, order_by=[asc(Master.first_name)])
      ids = [m.id for m in result]
      assert ids.index(a["id"]) < ids.index(b["id"])

  # 4. limit: 1001 rows → raise; message names table + limit
  async def test_list_all_limit_raises(db_session):
      rows = [{"tag": f"bulk-{i:05d}"} for i in range(BARE_LIST_MAX_ROWS + 1)]
      await db_session.execute(insert(Tag), rows)
      await db_session.commit()
      with pytest.raises(BareListLimitExceededError, match="tags.*1000"):
          await get_tag_service().list_all(db_session)

  # 5. boundary: exactly 1000 → OK
  async def test_list_all_boundary_ok(db_session):
      rows = [{"tag": f"bulk-{i:05d}"} for i in range(BARE_LIST_MAX_ROWS)]
      await db_session.execute(insert(Tag), rows)
      await db_session.commit()
      assert len(await get_tag_service().list_all(db_session)) == BARE_LIST_MAX_ROWS

  # 6. ServiceService: eager loads tariffs+tags (no MissingGreenlet)
  async def test_service_list_all_eager_loads(db_session, create_service):
      create_service()  # factory creates service with tariff+tag associations
      result = await get_service_service().list_all(db_session)
      assert result[0].tariffs is not None and result[0].tags is not None
  ```
  Note for the implementer: check the model `id` defaults before the bulk inserts (tests 4–5) — if `Tag.id` has no Python-side default, add `"id": uuid.uuid4().hex` to each row dict.
  Run `pytest backend/tests/services/test_list_all.py` → all fail (ImportError / AttributeError).
- [ ] **GREEN:** Create `backend/src/domain/errors.py`:
  ```python
  """Shared domain errors raised by services (non-deletion; deletion errors live in deletion.py)."""


  class BareListLimitExceededError(Exception):
      """Raised when a bare /all dictionary list exceeds the protective row limit.

      Message assumption: the API router prefix equals the model tablename
      (true for all 5 dictionaries: masters/locations/services/tags/materials).
      """

      def __init__(self, table_name: str, limit: int) -> None:
          super().__init__(
              f"Dictionary '{table_name}' exceeded the /all limit of {limit} rows — "
              f"use the paginated GET /api/v1/{table_name} endpoint"
          )
  ```
- [ ] In `backend/src/services/generic.py` add the constant and methods:
  ```python
  # module level, near the TypeVars
  BARE_LIST_MAX_ROWS = 1000  # protective limit for bare /all lists (#205)
  ```
  ```python
  # on GenericService, after list()
  async def list_all(
      self,
      db_session: AsyncSession,
      order_by=None,
      **filters,
  ) -> list[ResponseSchemaT]:
      """Unpaginated list for dictionary /all endpoints, capped by BARE_LIST_MAX_ROWS.

      Raises BareListLimitExceededError when the limit is exceeded (limit+1 probe,
      single query, never materializes unbounded rows).
      """
      stmt = self._list_stmt(**filters)
      if order_by is not None:
          stmt = stmt.order_by(*order_by)
      result = await db_session.execute(stmt.limit(BARE_LIST_MAX_ROWS + 1))
      rows = list(result.scalars().all())
      if len(rows) > BARE_LIST_MAX_ROWS:
          raise BareListLimitExceededError(self._model.__tablename__, BARE_LIST_MAX_ROWS)
      return [self._response_schema.model_validate(o) for o in rows]
  ```
  ```python
  # on ArchiveService, after its list()
  async def list_all(
      self,
      db_session: AsyncSession,
      order_by=None,
      status: ArchiveStatus = ArchiveStatus.ACTIVE,
      **filters,
  ) -> list[ResponseSchemaT]:
      return await super().list_all(db_session, order_by=order_by, status=status, **filters)
  ```
  (This works because `ArchiveService._list_stmt(status=...)` already applies the status filter.)
  Add the import: `from src.domain.errors import BareListLimitExceededError`.
- [ ] In `backend/src/services/service.py` add the override (mirroring its `list()` at :39-67):
  ```python
  async def list_all(
      self,
      db_session: AsyncSession,
      order_by=None,
      status: ArchiveStatus = ArchiveStatus.ACTIVE,
      **filters,
  ) -> list[ServiceResponse]:
      stmt = select(Service).options(
          selectinload(Service.tariffs), selectinload(Service.tags)
      )
      if status == ArchiveStatus.ACTIVE:
          stmt = stmt.where(Service.is_active)
      elif status == ArchiveStatus.ARCHIVED:
          stmt = stmt.where(not_(Service.is_active))
      for key, value in filters.items():
          if value is not None:
              stmt = stmt.where(getattr(Service, key) == value)
      if order_by is not None:
          stmt = stmt.order_by(*order_by)
      result = await db_session.execute(stmt.limit(BARE_LIST_MAX_ROWS + 1))
      rows = list(result.scalars().all())
      if len(rows) > BARE_LIST_MAX_ROWS:
          raise BareListLimitExceededError(Service.__tablename__, BARE_LIST_MAX_ROWS)
      return [ServiceResponse.model_validate(s) for s in rows]
  ```
  Add imports: `BARE_LIST_MAX_ROWS` from `src.services.generic`, `BareListLimitExceededError` from `src.domain.errors`.
- [ ] Run `pytest backend/tests/services/test_list_all.py` → all pass.
- [ ] Run the full backend suite `pytest backend/tests/` → no regressions (nothing existing calls list_all yet).
- [ ] Commit: `feat(backend): GenericService.list_all with 1000-row protective limit + ServiceService eager-load override (#205)`

---

## Task 2: `/all` routes in the 5 dictionary routers
### Classification: standard

### Required Docs
- Spec §4.2, §4.3, §4.4 (route shape, error conversion, per-entity orders)
- `backend/src/api/v1/masters.py` (:31-52 list endpoint idiom), `backend/src/api/v1/tags.py` (:26-34 — no status variant)
- `backend/src/api/v1/photos.py` (:28 vs :55 — static-route-before-`/{id}` precedent)

### Task Description
Add `GET /all` to each of the 5 dictionary routers, declared IMMEDIATELY AFTER the `GET ""` list endpoint and BEFORE any `/{id}` route (path params are `str` — registration order decides). Archive entities take `status: ArchiveStatus = Query(ArchiveStatus.ACTIVE)`; tags take no params. `BareListLimitExceededError` → `HTTPException(422, detail=str(exc))` (the #207 `ResolutionError` idiom; the global handler in main.py wraps it into the standard `{"detail": {"code": "VALIDATION_ERROR", ...}}` envelope). Per-entity `order_by` per spec §4.4 (WITH `id ASC` tiebreaker).

### Steps
- [ ] **RED:** Add one smoke test per entity to the existing `backend/tests/test_api_{masters,locations,services,materials}.py`; for tags CREATE `backend/tests/test_api_tags.py` (does not exist today — mirror the masters file's fixture/style idiom):
  ```python
  def test_all_returns_bare_array(api_client, create_master):  # fixture per entity
      created = create_master()  # sync factory idiom as used in the file
      resp = api_client.get("/api/v1/masters/all")
      assert resp.status_code == 200
      body = resp.json()
      assert isinstance(body, list), "/all must return a bare array, not an envelope"
      assert any(item["id"] == created["id"] for item in body)
  ```
  For masters additionally: `test_all_status_filter` — create + archive one master; default → excluded; `?status=all` → present. (Full generic contract lands in Task 4; keep these minimal.)
  Run each → 404 (route missing).
- [ ] **GREEN:** masters.py — right after `list_masters` (:52), before `PUT /reorder` (:55):
  ```python
  @router.get("/all", response_model=list[MasterResponse])
  async def list_all_masters(
      service: _ServiceDep,
      session: SessionDep,
      status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
  ) -> list[MasterResponse]:
      try:
          return await service.list_all(
              db_session=session,
              status=status,
              order_by=[asc(Master.sort_order), asc(Master.first_name), asc(Master.id)],
          )
      except BareListLimitExceededError as exc:
          raise HTTPException(status_code=422, detail=str(exc)) from exc
  ```
  Add import `from src.domain.errors import BareListLimitExceededError`.
- [ ] locations.py — same, after its list endpoint: `order_by=[asc(Location.sort_order), asc(Location.name), asc(Location.id)]`, `LocationResponse`, status param present.
- [ ] services.py — same: `order_by=[asc(Service.title), asc(Service.id)]`, `ServiceResponse`, status param present.
- [ ] materials.py — same: `order_by=[asc(Material.title), asc(Material.id)]`, `MaterialResponse`, status param present.
- [ ] tags.py — NO status param:
  ```python
  @router.get("/all", response_model=list[TagResponse])
  async def list_all_tags(
      service: _ServiceDep,
      session: SessionDep,
  ) -> list[TagResponse]:
      try:
          return await service.list_all(
              db_session=session,
              order_by=[asc(Tag.tag), asc(Tag.id)],
          )
      except BareListLimitExceededError as exc:
          raise HTTPException(status_code=422, detail=str(exc)) from exc
  ```
- [ ] Run the 5 new smoke tests → pass. Run `pytest backend/tests/` → green.
- [ ] Commit: `feat(backend): bare GET /all endpoints for the 5 dictionaries with 422 limit guard (#205)`

---

## Task 3: `sort_by`/`sort_order` + deterministic default orders on the 5 dictionary list endpoints
### Classification: standard

### Required Docs
- Spec §4.4, §4.5 (default orders, whitelists, 422 on unknown key)
- Records sort idiom: `backend/src/schemas/record.py:114-140` (`Literal` sort params), `backend/src/services/record.py:116-132` (sort_map + nulls + id tiebreak)
- `backend/src/api/v1/masters.py:31-52` (list endpoint to extend)

### Task Description
The dictionary tables sort client-side today; server pagination requires server sort. Add `sort_by`/`sort_order` query params to the 5 paginated list endpoints. `sort_by` is a per-entity `Literal` type (FastAPI rejects unknown values with 422 for free — the explicit-validation requirement). Mapping sort key → columns lives in the ROUTER (masters/locations already pass `order_by` from the router; records put the map in the service — here the router is the established dictionary idiom). User sorts append `id ASC` tiebreak; nulls follow the records idiom (asc→`nullsfirst()`, desc→`nullslast()`). `sort_by=None` → spec §4.4 default order (services/tags/materials GAIN a deterministic default; masters/locations defaults gain the `id` tiebreak).

**Whitelists (keys = exactly the sortable column keys the table headers use today):**
- masters: `name` → `[Master.first_name, Master.last_name]`; `specialty`, `position`, `color`, `avatar` → same-named columns; `status` → `[Master.is_active]` (asc = `is_active ASC` = archived-first, preserving the old client boolean-sort semantics)
- locations: `name`, `short_title`, `capacity`, `address`, `location_hint`, `description`, `yandex_map_url`, `created_at` → same-named columns; `archived` → `[Location.is_active]` (same asc rule)
- services: `title`, `duration`, `material_hint`, `specialty`, `created_at` → same-named; `age` → `[Service.min_age]`; `tariffs` → tariff-count subquery (below); `archived` → `[Service.is_active]`
- materials: `title`, `description`, `created_at` → same-named; `archived` → `[Material.is_active]`
- tags: `tag` → `[Tag.tag]`

### Steps
- [ ] **RED:** Add tests to each `backend/tests/test_api_{masters,locations,services,materials}.py` and the NEW `backend/tests/test_api_tags.py` (created in Task 2):
  - `test_list_sort_<key>_asc/desc` for at least: the name/title/tag key, one composite (`masters name`), `archived`/`status`, and (services only) `tariffs` count — create 2-3 rows via the file's factories with known orderings, GET with `sort_by`/`sort_order`, assert the `items` id sequence.
  - `test_list_sort_invalid_key_422`: `GET {prefix}?sort_by=bogus` → 422.
  - `test_list_default_order_locked`: create rows whose insertion order differs from §4.4 default; GET without sort params → assert default order (services: `title ASC, id ASC`; tags: `tag ASC, id ASC`; materials: `title ASC, id ASC`; masters/locations: unchanged + id tiebreak).
  Run → fail (params unknown / ignored).
- [ ] **GREEN:** `backend/src/schemas/common.py` — add:
  ```python
  SortOrder = Literal["asc", "desc"]
  ```
  (import `Literal` from typing). Per-entity Literals in the schema files:
  ```python
  # schemas/master.py
  MasterSortBy = Literal["name", "specialty", "position", "color", "avatar", "status"]
  # schemas/location.py
  LocationSortBy = Literal["name", "short_title", "capacity", "address", "location_hint", "description", "archived", "yandex_map_url", "created_at"]
  # schemas/service.py
  ServiceSortBy = Literal["title", "duration", "age", "material_hint", "tariffs", "specialty", "archived", "created_at"]
  # schemas/material.py
  MaterialSortBy = Literal["title", "description", "archived", "created_at"]
  # schemas/tag.py
  TagSortBy = Literal["tag"]
  ```
- [ ] masters.py — add module-level map + builder, and wire the list endpoint:
  ```python
  _MASTER_SORT_MAP: dict[str, list] = {
      "name": [Master.first_name, Master.last_name],
      "specialty": [Master.specialty],
      "position": [Master.position],
      "color": [Master.color],
      "avatar": [Master.avatar_url],
      "status": [Master.is_active],
  }

  def _master_order_by(sort_by: MasterSortBy | None, sort_order: SortOrder) -> list:
      if sort_by is None:
          return [asc(Master.sort_order), asc(Master.first_name), asc(Master.id)]
      cols = _MASTER_SORT_MAP[sort_by]
      ordered = [c.desc().nullslast() if sort_order == "desc" else c.asc().nullsfirst() for c in cols]
      return [*ordered, asc(Master.id)]
  ```
  ```python
  async def list_masters(
      service: _ServiceDep,
      session: SessionDep,
      page: int = Query(1, ge=1),
      per_page: int = Query(20, ge=1, le=100),
      status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
      sort_by: MasterSortBy | None = Query(None),
      sort_order: SortOrder = Query("asc"),
  ) -> PaginatedResponse[MasterResponse]:
      return await service.list(
          db_session=session,
          page=page,
          per_page=per_page,
          status=status,
          order_by=_master_order_by(sort_by, sort_order),
      )
  ```
  Verify the actual column names (`position`, `color`, `avatar` etc.) against `backend/src/models/master.py` before writing the map — adjust to real columns.
- [ ] locations.py — same pattern; default unchanged + id tiebreak: `[asc(Location.sort_order), asc(Location.name), asc(Location.id)]`; `archived` → `Location.is_active`.
- [ ] services.py — same pattern; NEW default `[asc(Service.title), asc(Service.id)]`; the `tariffs` key uses a correlated count subquery (records idiom):
  ```python
  from sqlalchemy import func, select
  from src.models.tariff import Tariff
  _SERVICE_SORT_MAP = {
      ...
      "age": [Service.min_age],
      "tariffs": [select(func.count(Tariff.id)).where(Tariff.service_id == Service.id).correlate(Service).scalar_subquery()],
      "archived": [Service.is_active],
      ...
  }
  ```
  Verify the real FK column name on `Tariff` (`service_id`) against `backend/src/models/tariff.py`.
  NOTE: `ServiceService.list` applies its own statement and currently receives no `order_by` — its `list()` signature must accept `order_by=None` and apply `stmt = stmt.order_by(*order_by)` when given (same one-liner pattern as `list_all` in Task 1). Update the signature: `async def list(self, db_session, page=1, per_page=20, status=ArchiveStatus.ACTIVE, order_by=None, **filters)`.
- [ ] materials.py — same pattern; NEW default `[asc(Material.title), asc(Material.id)]`.
- [ ] tags.py — same pattern (no status param); NEW default `[asc(Tag.tag), asc(Tag.id)]`; whitelist just `"tag"`.
- [ ] Run the new sort tests → pass. Run `pytest backend/tests/` → green (watch for existing tests that asserted the old unspecified order for services/tags/materials — update those assertions to the new deterministic default; that is an intended change per spec §9).
- [ ] Commit: `feat(backend): sort_by/sort_order whitelists + deterministic default order on dictionary list endpoints (#205)`

---

## Task 4: `/all` contract tests via the generic contract infra
### Classification: standard

### Required Docs
- Spec §4.6 (contract test matrix)
- `backend/tests/generic_contract.py` — `EntityConfig` (:131-158), `CONTRACT_CONFIG` (:162-372), `_contract_params` (:376-386)
- `backend/tests/test_generic_api_contract.py` — helpers (:74-133), `TestGenericApiListContract` (:169-215)
- `backend/tests/conftest.py` — `api_client` (:100-108), `db_engine`, the `asyncio.run` idiom in `reset_db` (:145-156)

### Task Description
Wire `/all` into the #184/#185 contract infra as an opt-in set. Five entities only. Cover: bare-array shape + item schema, deterministic default order, status parity (archive entities; tags skipped), limit 422 + boundary (tags only — cheapest), and a negative route-presence guard for non-dictionaries.

### Steps
- [ ] **RED:** In `backend/tests/generic_contract.py`:
  - Add an optional field to `EntityConfig`: `earlier_create_data: dict | None = None` (field overrides that produce a row sorting BEFORE `create_data` per §4.4 default order).
  - Populate it on the 5 dictionary configs: masters `{"first_name": "!AAA-contract"}` (must sort BEFORE the config's existing `create_data` first_name `"A"` — `"!"` < `"A"` in ASCII); locations `{"name": "!AAA-contract"}`; services `{"title": "!AAA-contract"}`; tags `{"tag": "!aaa-contract"}`; materials `{"title": "!AAA-contract"}`. (Verify each sentinel against the existing `create_data` — the sentinel must sort first per §4.4.)
  - Add:
    ```python
    BARE_ALL_ENTITIES: list[type] = [MasterService, LocationService, ServiceService, TagService, MaterialService]

    def _all_params() -> list:
        """Opt-in parametrizer for the dictionary /all contract (#205)."""
        params = []
        for cls in BARE_ALL_ENTITIES:
            cfg = CONTRACT_CONFIG.get(cls)
            if cfg is None:
                params.append(pytest.param(cls, None, id=f"{cls.__name__}-all-MISSING-CONFIG"))
                continue
            params.append(pytest.param(cls, cfg, id=f"{cls.__name__}-all"))
        return params
    ```
    Note: `ServiceService` IS in `GENERIC_CONTRACT_EXCEPTIONS` for CRUD but has a `CONTRACT_CONFIG` entry — `_all_params` reads the config directly, so it joins the `/all` contract as intended (its `list_all` override is what we're guarding).
- [ ] In `backend/tests/test_generic_api_contract.py` add:
  ```python
  class TestGenericApiAllContract:
      @pytest.mark.parametrize("service_cls,cfg", _all_params())
      def test_all_returns_bare_array_with_valid_items(self, service_cls, cfg, api_client, request):
          assert cfg is not None
          fk_ids = _resolve_fk_ids(request, cfg)
          created = _create_entity(api_client, cfg, fk_ids)
          resp = api_client.get(cfg.router_prefix + "/all")
          assert resp.status_code == 200
          body = resp.json()
          assert isinstance(body, list), "/all must be a bare array, not an envelope"
          matches = [item for item in body if item["id"] == created["id"]]
          assert len(matches) == 1
          _validate_response_body(matches[0], cfg)

      @pytest.mark.parametrize("service_cls,cfg", _all_params())
      def test_all_deterministic_default_order(self, service_cls, cfg, api_client, request):
          assert cfg is not None and cfg.earlier_create_data is not None
          fk_ids = _resolve_fk_ids(request, cfg)
          later = _create_entity(api_client, cfg, fk_ids)
          earlier_data = {**cfg.create_data, **cfg.earlier_create_data}
          earlier = _create_entity(api_client, cfg, fk_ids, data=earlier_data)  # extend helper to accept data override if needed
          body = api_client.get(cfg.router_prefix + "/all").json()
          ids = [item["id"] for item in body]
          assert ids.index(earlier["id"]) < ids.index(later["id"]), "default order per spec §4.4"

      @pytest.mark.parametrize("service_cls,cfg", _all_params())
      def test_all_status_filter_parity(self, service_cls, cfg, api_client, request):
          assert cfg is not None
          if service_cls is TagService:
              pytest.skip("tags have no archive status")
          fk_ids = _resolve_fk_ids(request, cfg)
          created = _create_entity(api_client, cfg, fk_ids)
          archive = api_client.post(f"{cfg.router_prefix}/{created['id']}/archive")
          assert archive.status_code == 200
          assert all(item["id"] != created["id"] for item in api_client.get(cfg.router_prefix + "/all").json())
          assert any(item["id"] == created["id"] for item in api_client.get(cfg.router_prefix + "/all", params={"status": "all"}).json())
          assert any(item["id"] == created["id"] for item in api_client.get(cfg.router_prefix + "/all", params={"status": "archived"}).json())
  ```
  Extend the `_create_entity` helper with an optional `data` override param if it doesn't have one.
- [ ] Limit + boundary tests (tags only — cheapest bulk insert; enforcement is the single shared `list_all` choke point). Mirror conftest's `asyncio.run` idiom for seeding from a sync test:
  ```python
  def _bulk_seed_tags(db_engine, n: int) -> None:
      async def _seed() -> None:
          from sqlalchemy import insert
          from src.models.tag import Tag
          from sqlalchemy.ext.asyncio import async_sessionmaker
          factory = async_sessionmaker(db_engine, expire_on_commit=False)
          async with factory() as session:
              await session.execute(insert(Tag), [{"tag": f"bulk-{i:05d}"} for i in range(n)])
              await session.commit()
      asyncio.run(_seed())

  def test_all_limit_exceeded_422(api_client, db_engine):
      from src.services.generic import BARE_LIST_MAX_ROWS
      _bulk_seed_tags(db_engine, BARE_LIST_MAX_ROWS + 1)
      resp = api_client.get("/api/v1/tags/all")
      assert resp.status_code == 422
      detail = resp.json()["detail"]
      assert detail["code"] == "VALIDATION_ERROR"
      assert "tags" in detail["message"] and str(BARE_LIST_MAX_ROWS) in detail["message"]

  def test_all_limit_boundary_ok(api_client, db_engine):
      from src.services.generic import BARE_LIST_MAX_ROWS
      _bulk_seed_tags(db_engine, BARE_LIST_MAX_ROWS)
      resp = api_client.get("/api/v1/tags/all")
      assert resp.status_code == 200
      assert len(resp.json()) == BARE_LIST_MAX_ROWS
  ```
  (Check the Tag model's `id` default first; add explicit ids if the model doesn't generate them. Confirm the error-envelope key names against `backend/src/errors.py` `ErrorDetail` before asserting.)
- [ ] Negative guard:
  ```python
  @pytest.mark.parametrize("prefix", ["/api/v1/clients", "/api/v1/records", "/api/v1/activities", "/api/v1/visits", "/api/v1/payments", "/api/v1/visitors"])
  def test_all_absent_on_non_dictionaries(api_client, prefix):
      resp = api_client.get(prefix + "/all")
      assert resp.status_code == 404, f"{prefix}/all must not exist — /all is dictionaries-only (#205)"
  ```
- [ ] Run → all fail (helper/parametrizer missing pieces). Then implement the `generic_contract.py` changes (they ARE the implementation here) → tests pass against the Task 2 routes.
- [ ] Run `pytest backend/tests/test_generic_api_contract.py` → green; then full `pytest backend/tests/` → green.
- [ ] Commit: `test(backend): /all contract tests (bare array, order, status parity, limit, non-dictionary 404) (#205)`

---

## Task 5: api-client — `getAllX` methods + sort params on `ListParams`
### Classification: small

### Required Docs
- Spec §5.1
- `packages/api-client/src/endpoints.ts` — `ListParams`/`listQuery` (:85-100), `getMasters` (:104-106)
- `packages/api-client/src/schemas.ts` — `paginatedSchema` + list schemas (:542-566)

### Task Description
Add bare-array response schemas and `getAllX` methods for the 5 dictionaries; extend `ListParams`/`listQuery` with `sort_by`/`sort_order` (needed by the table contexts in Tasks 7–11).

### Steps
- [ ] **RED:** Add failing tests to `packages/api-client/src/endpoints.test.ts` (mirror the existing list-method tests at :29/:68/:99/:115):
  - `getAllMasters()` → GET `/api/v1/masters/all`, returns the parsed bare array (mock fetch returns `[{...master json}]`, assert deep-equal).
  - `getAllMasters({ status: 'all' })` → URL contains `status=all`.
  - `getAllTags()` → GET `/api/v1/tags/all` (no params variant).
  - `getAllServices/getAllLocations/getAllMaterials` → correct URLs.
  - `getMasters({ page: 2, per_page: 50, sort_by: 'name', sort_order: 'desc' })` → URL contains `sort_by=name&sort_order=desc`.
  Run `cd packages/api-client && npm test` → fail (methods missing).
- [ ] **GREEN:** `schemas.ts` — after the list schemas (:566):
  ```ts
  export const MasterAllResponseSchema = z.array(MasterResponseSchema);
  export const LocationAllResponseSchema = z.array(LocationResponseSchema);
  export const ServiceAllResponseSchema = z.array(ServiceResponseSchema);
  export const TagAllResponseSchema = z.array(TagResponseSchema);
  export const MaterialAllResponseSchema = z.array(MaterialResponseSchema);
  ```
- [ ] `endpoints.ts` — extend `ListParams` + `listQuery`:
  ```ts
  export interface ListParams {
    page?: number;
    per_page?: number;
    /** Archive filter — soft-delete entities only (masters/locations/services/materials). */
    status?: 'active' | 'all' | 'archived' | null;
    /** Server-side sort — dictionary list endpoints only (#205); must be in the endpoint's whitelist. */
    sort_by?: string;
    sort_order?: 'asc' | 'desc';
  }
  ```
  Add to `listQuery`: `if (params?.sort_by) search.set('sort_by', params.sort_by);` and `if (params?.sort_order) search.set('sort_order', params.sort_order);`
- [ ] `endpoints.ts` — new section after the dictionary list methods:
  ```ts
  /** Params for bare /all dictionary endpoints (#205). */
  export interface AllParams {
    status?: 'active' | 'all' | 'archived';
  }

  function allQuery(params?: AllParams): string {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    const qs = search.toString();
    return qs ? `?${qs}` : '';
  }

  export async function getAllMasters(params?: AllParams): Promise<MasterResponse[]> {
    return api(`/api/v1/masters/all${allQuery(params)}`, MasterAllResponseSchema);
  }
  export async function getAllLocations(params?: AllParams): Promise<LocationResponse[]> {
    return api(`/api/v1/locations/all${allQuery(params)}`, LocationAllResponseSchema);
  }
  export async function getAllServices(params?: AllParams): Promise<ServiceResponse[]> {
    return api(`/api/v1/services/all${allQuery(params)}`, ServiceAllResponseSchema);
  }
  export async function getAllMaterials(params?: AllParams): Promise<MaterialResponse[]> {
    return api(`/api/v1/materials/all${allQuery(params)}`, MaterialAllResponseSchema);
  }
  /** Tags have no archive status — no params. */
  export async function getAllTags(): Promise<TagResponse[]> {
    return api('/api/v1/tags/all', TagAllResponseSchema);
  }
  ```
  Import the 5 new schemas. Export all from the package barrel if one exists (check `packages/api-client/src/index.ts`).
- [ ] Run `cd packages/api-client && npm test` → green (including the 4 pre-existing failures from #188 staying exactly as they were — no new failures).
- [ ] Commit: `feat(api-client): getAll* bare-list methods + sort params on ListParams (#205)`

---

## Task 6: `createPagedListContext` factory + tests
### Classification: standard

### Required Docs
- Spec §5.2 (factory decision, page-reset semantics, keepPreviousData caveat)
- `frontend/admin/contexts/ClientsContext.tsx` (:92-123 — shape precedent)
- Skill: vitest-playwright-patterns (context mocking, test style)

### Task Description
Create the shared factory that Tasks 7–11 instantiate per entity. It reproduces the Clients/Records context SHAPE (items/total/page/perPage/sortBy/sortOrder/status + setters + useQuery with server-param queryKey + `placeholderData: keepPreviousData`) with two deliberate upgrades over the precedent: `setSort`, `setPerPage`, and `setStatus` all reset `page` to 1 (spec §5.2 — the existing contexts lack this for sort); `status` is opt-in (`withStatus`) so tags omit it from both state and queryKey.

### Steps
- [ ] **RED:** Create `frontend/admin/__tests__/createPagedListContext.test.tsx`:
  ```tsx
  // Probe pattern: render a test consumer inside the Provider with a mocked fetcher
  // (vi.fn returning a PaginatedResponse), assert behavior through the context value.
  ```
  Cases (each = one `it`):
  1. initial fetch called with `{ page: 1, per_page: 10, status: 'active' }` — NO `sort_by`/`sort_order` keys (initial `sortBy` is `null` → server §4.4 default order; this preserves today's behavior where tables render in server order with no initial client sort — important for masters/locations whose `sort_order` column drives a manual reorder feature); items/total in the context value come from the envelope;
  2. `setPage(3)` → refetch with `page: 3`;
  3. `setPerPage(50)` → refetch with `per_page: 50` AND `page` reset to 1 (call setPage(3) first);
  4. `setSort('title', 'desc')` → refetch with `sort_by: 'title', sort_order: 'desc'` AND `page` reset to 1;
  5. `setStatus('archived')` → refetch with `status: 'archived'` AND `page` reset to 1;
  6. `withStatus: false` config → fetcher params contain NO `status` key and queryKey has no status slot;
  7. queryKey shape: `['<prefix>', page, perPage, status, sortBy, sortOrder]` (withStatus; `sortBy` slot is `null` initially) — assert via a mocked useQuery capture or cache inspection (mirror how ClientsContext.test.tsx does it);
  8. `usePagedList` outside Provider → throws.
  Use the project's established react-query test wrapper (check `__tests__/ClientsContext.test.tsx` for the QueryClientProvider wrapper idiom). Run → fails (module missing).
- [ ] **GREEN:** Create `frontend/admin/contexts/createPagedListContext.tsx`:
  ```tsx
  'use client';

  import React, { createContext, useCallback, useContext, useState } from 'react';
  import { keepPreviousData, useQuery } from '@tanstack/react-query';
  import type { PaginatedResponse } from '@memo/api-client';

  export type ArchiveFilter = 'active' | 'all' | 'archived';
  export type SortOrder = 'asc' | 'desc';

  export interface PagedListFetcherParams {
    page: number;
    per_page: number;
    /** Present only after the user picks a sort — initial state sends neither (server default order). */
    sort_by?: string;
    sort_order?: SortOrder;
    status?: ArchiveFilter;
  }

  export interface PagedListContextValue<T> {
    items: T[];
    total: number;
    page: number;
    perPage: number;
    sortBy: string | null;
    sortOrder: SortOrder;
    status: ArchiveFilter;
    isLoading: boolean;
    isFetching: boolean;
    error: Error | null;
    setPage: (page: number) => void;
    setPerPage: (perPage: number) => void;
    setSort: (field: string, order: SortOrder) => void;
    setStatus: (status: ArchiveFilter) => void;
    refetch: () => void;
  }

  interface PagedListConfig<T> {
    queryKeyPrefix: string;
    fetcher: (params: PagedListFetcherParams) => Promise<PaginatedResponse<T>>;
    withStatus?: boolean;
    defaultPerPage?: number;
  }

  /**
   * Shared server-pagination context factory for dictionary tables (#205).
   * Shape mirrors ClientsContext; setSort/setPerPage/setStatus reset page to 1
   * (deliberate upgrade over the Clients/Records precedent, spec §5.2).
   * sortBy starts null → initial fetch omits sort params → server default order
   * (spec §4.4), preserving today's unsorted-initial-render behavior.
   */
  export function createPagedListContext<T>(config: PagedListConfig<T>) {
    const { queryKeyPrefix, fetcher, withStatus = false, defaultPerPage = 10 } = config;
    const Context = createContext<PagedListContextValue<T> | null>(null);

    function Provider({ children }: { children: React.ReactNode }) {
      const [page, setPage] = useState(1);
      const [perPage, setPerPageState] = useState(defaultPerPage);
      const [sortBy, setSortBy] = useState<string | null>(null);
      const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
      const [status, setStatusState] = useState<ArchiveFilter>('active');

      const queryKey = withStatus
        ? [queryKeyPrefix, page, perPage, status, sortBy, sortOrder]
        : [queryKeyPrefix, page, perPage, sortBy, sortOrder];

      const { data, isLoading, isFetching, error, refetch } = useQuery({
        queryKey,
        queryFn: () =>
          fetcher({
            page,
            per_page: perPage,
            ...(sortBy ? { sort_by: sortBy, sort_order: sortOrder } : {}),
            ...(withStatus ? { status } : {}),
          }),
        placeholderData: keepPreviousData,
      });

      const setPerPage = useCallback((n: number) => { setPerPageState(n); setPage(1); }, []);
      const setSort = useCallback((field: string, order: SortOrder) => { setSortBy(field); setSortOrder(order); setPage(1); }, []);
      const setStatus = useCallback((s: ArchiveFilter) => { setStatusState(s); setPage(1); }, []);

      const value: PagedListContextValue<T> = {
        items: data?.items ?? [],
        total: data?.total ?? 0,
        page, perPage, sortBy, sortOrder, status,
        isLoading, isFetching,
        error: (error as Error) ?? null,
        setPage, setPerPage, setSort, setStatus, refetch,
      };
      return <Context.Provider value={value}>{children}</Context.Provider>;
    }

    function usePagedList(): PagedListContextValue<T> {
      const ctx = useContext(Context);
      if (!ctx) throw new Error(`usePagedList(${queryKeyPrefix}) must be used within its Provider`);
      return ctx;
    }

    return { Provider, usePagedList };
  }
  ```
- [ ] Run `cd frontend/admin && npx vitest run __tests__/createPagedListContext.test.tsx` → pass. Run `npm run test` → no regressions.
- [ ] Commit: `feat(admin): createPagedListContext factory for server-paginated dictionary tables (#205)`

---

## Task 7: Masters — context wrapper + table migration + test rewrite
### Classification: standard

### Required Docs
- Spec §5.2, §5.3, §5.6 (context shape, table migration rules incl. KEPT search memo, test precedent)
- `frontend/admin/app/(main)/masters/components/MastersTable.tsx` (current impl; delete list at spec §5.3)
- `frontend/admin/__tests__/RecordsTable.test.tsx` (:275-284 — server-pagination test precedent) + `ClientsPage.test.tsx` (:130-162)
- `docs/domain-rules/masters.md`
- Skill: vitest-playwright-patterns

### Task Description
Migrate MastersTable to server pagination/sort via a `MastersContext` wrapper. Rules (all tables, spec §5.3): remove the local `useQuery`, local `page`/`pageSize`/`sortField`/`sortDir` state, the `.sort()` and `.slice()` memos and local `totalPages`; KEEP the `search` state + client `.filter()` memo applied to the context's `items` (G1b Q1 — search untouched); pager driven by context `total`; sort headers call `setSort`; status tabs call `setStatus`. The context hook is named `useMastersTable` — `useMasters` already exists in hooks/ (lookup hook, migrated in Task 12).

### Steps
- [ ] **RED:** Rewrite `frontend/admin/__tests__/MastersTable.test.tsx` around the context (mirror RecordsTable.test.tsx's mocking approach — mock `@/contexts/MastersContext`'s `useMastersTable`, or wrap in the real provider with `@memo/api-client` mocked; follow the RecordsTable precedent exactly). Core assertions:
  - fetch params: `getMasters` called with `{ page: 1, per_page: 10, status: 'active' }` initially — NO sort params (initial sortBy is null → server default `[sort_order, first_name, id]`, preserving today's render order incl. the manual reorder feature);
  - pager: with `total: 42` from the envelope → renders 5 numbered pages + "42" total label; clicking page 2 → `setPage(2)`; changing page-size select (`data-testid="page-size-select"`) → `setPerPage(20)`;
  - sort: clicking the "name" header → `setSort('name', 'asc')` (initial sortBy is null → any first click is a new key → asc); clicking it again → `setSort('name', 'desc')` (toggle);
  - status tabs → `setStatus('archived')` etc.;
  - search box still filters the loaded `items` client-side (type a query → non-matching rows of the loaded page disappear);
  - delete the old client-slice assertions (`624-648` pattern) and old query-param assertions expecting `per_page: 100`.
  Run → fail (context/component not migrated).
- [ ] **GREEN:** Create `frontend/admin/contexts/MastersContext.tsx`:
  ```tsx
  'use client';

  import { createPagedListContext } from './createPagedListContext';
  import { getMasters } from '@memo/api-client';
  import type { MasterResponse } from '@memo/api-client';

  const { Provider, usePagedList } = createPagedListContext<MasterResponse>({
    queryKeyPrefix: 'masters',
    fetcher: (p) =>
      getMasters({
        page: p.page,
        per_page: p.per_page,
        status: p.status,
        sort_by: p.sort_by,
        sort_order: p.sort_order,
      }),
    withStatus: true,
  });

  export const MastersProvider = Provider;
  /** Table list state (server-paginated). NOT the lookup hook — that's hooks/useMasters.ts. */
  export const useMastersTable = usePagedList;
  ```
- [ ] Wrap the page: `frontend/admin/app/(main)/masters/page.tsx` — wrap `<MastersTable />` in `<MastersProvider>` (import from `@/contexts/MastersContext`).
- [ ] Rewrite MastersTable: replace the fetch/state/memo block (:46-144 approx) with `const { items, total, page, perPage, sortBy, sortOrder, status, isLoading, isFetching, error, setPage, setPerPage, setSort, setStatus } = useMastersTable();`; keep the `search` useState + the filter memo over `items`; rows render from the filtered items directly (no sort/slice memos); `handleSort(col.key)` → toggle: same key → `setSort(key, sortOrder === 'asc' ? 'desc' : 'asc')`, new key → `setSort(key, 'asc')`; pager JSX reads context (`totalPages = Math.max(1, Math.ceil(total / perPage))`); status tab handler → `setStatus(...)` (replaces local status state — check how status currently flows into the `['masters', status]` queryKey and remove that useQuery entirely). Keep everything else (modals, mutations, column defs, DeleteDialog wiring) untouched.
- [ ] Sort key sanity: the COLUMNS keys (`name`, `specialty`, `position`, `color`, `avatar`, `status`) must all be in the backend masters whitelist (Task 3) — key SET matches; note the `avatar` UI key maps to the `avatar_url` column server-side (Task 3 map). Do not add new sortable columns.
- [ ] Run `npx vitest run __tests__/MastersTable.test.tsx` → pass. Then `npm run test:all` (UI change) → green + tsc clean.
- [ ] Commit: `feat(admin): MastersTable server pagination/sort via MastersContext (#205)`

---

## Task 8: Locations — context wrapper + table migration + test rewrite
### Classification: standard

### Required Docs
- Same as Task 7, mutatis mutandis: `locations/components/LocationsTable.tsx`, `__tests__/LocationsTable.test.tsx` (old slice test :396-424), `docs/domain-rules/locations.md`

### Task Description
Identical migration to Task 7 for Locations. No `defaultSortBy` (initial fetch unsorted → server default `[sort_order, name, id]` — preserves the manual reorder feature), `withStatus: true`, fetcher → `getLocations({...})`. Provider `LocationsProvider`, hook `useLocationsTable`, wrapper `frontend/admin/contexts/LocationsContext.tsx`. Sort keys must match the locations whitelist (`name`, `short_title`, `capacity`, `address`, `location_hint`, `description`, `archived`, `yandex_map_url`, `created_at`) — COLUMNS keys already align; verify while editing.

### Steps
- [ ] **RED:** Rewrite `__tests__/LocationsTable.test.tsx` per the Task 7 pattern (initial fetch params `{ page: 1, per_page: 10, status: 'active' }` with NO sort keys; `sort_by: 'name'` asserted only after a header click; pager from envelope `total`; setSort/setStatus/setPage/setPerPage assertions; search filters loaded items; remove slice assertions at :396-424 and `per_page: 100` expectations at :328-363). Run → fail.
- [ ] **GREEN:** Create `contexts/LocationsContext.tsx` (per Task 7 template, `getLocations`, no `defaultSortBy`); wrap `app/(main)/locations/page.tsx`; rewrite LocationsTable (same rules: keep search memo over items, drop sort/slice memos, pager from context, `handleSort` → `setSort`, tabs → `setStatus`).
- [ ] Run `npx vitest run __tests__/LocationsTable.test.tsx` → pass; `npm run test:all` → green.
- [ ] Commit: `feat(admin): LocationsTable server pagination/sort via LocationsContext (#205)`

---

## Task 9: Services — context wrapper + table migration + test rewrite
### Classification: standard

### Required Docs
- Same as Task 7: `services/components/ServicesTable.tsx` (sortable keys gated by `col.sortValue` :446; keys: `title`, `duration`, `age`, `material_hint`, `tariffs`, `specialty`, `archived`, `created_at`), `__tests__/ServicesTable.test.tsx` (:242-332 query-param assertions), `docs/domain-rules/services.md`

### Task Description
Identical migration for Services. No `defaultSortBy` (initial fetch unsorted → new server default `title ASC, id ASC`), `withStatus: true`, fetcher → `getServices({...})`. Provider `ServicesProvider`, hook `useServicesTable`, file `contexts/ServicesContext.tsx`. NOTE: the `age` column sorts via `min_age` and `tariffs` via the count subquery — the TABLE keeps sending `age`/`tariffs` as keys; the backend whitelist maps them (Task 3). Do not "fix" the keys client-side.

### Steps
- [ ] **RED:** Rewrite `__tests__/ServicesTable.test.tsx` per the Task 7 pattern (replace :242-332 param assertions; add sort assertions incl. `age` → `setSort('age', ...)` and `tariffs` → `setSort('tariffs', ...)`; keep search filtering loaded items). Run → fail.
- [ ] **GREEN:** Create `contexts/ServicesContext.tsx`; wrap `app/(main)/services/page.tsx` (verify how ServicesTable is embedded — if the services page hosts both ServicesTable and MaterialsTable, wrap each table in its own provider; MaterialsContext lands in Task 10, so wrap only ServicesTable now); rewrite ServicesTable per the rules.
- [ ] Run `npx vitest run __tests__/ServicesTable.test.tsx` → pass; `npm run test:all` → green.
- [ ] Commit: `feat(admin): ServicesTable server pagination/sort via ServicesContext (#205)`

---

## Task 10: Materials — context wrapper + table migration + test rewrite
### Classification: standard

### Required Docs
- Same as Task 7: `services/components/MaterialsTable.tsx` (sortable keys `title`, `description`, `archived`, `created_at`), `__tests__/MaterialsTable.test.tsx` (:169-191 param assertions), `docs/domain-rules/materials.md`

### Task Description
Identical migration for Materials. No `defaultSortBy` (initial fetch unsorted → new server default `title ASC, id ASC`), `withStatus: true`, fetcher → `getMaterials({...})`. Provider `MaterialsProvider`, hook `useMaterialsTable`, file `contexts/MaterialsContext.tsx`. MaterialsTable lives under `app/(main)/services/components/` — find its host page/embedding and wrap there.

### Steps
- [ ] **RED:** Rewrite `__tests__/MaterialsTable.test.tsx` per the Task 7 pattern. Run → fail.
- [ ] **GREEN:** Create `contexts/MaterialsContext.tsx`; wrap MaterialsTable's host with `<MaterialsProvider>` (if it shares the services page with ServicesTable, both providers wrap their own tables independently — no nesting conflicts); rewrite MaterialsTable per the rules.
- [ ] Run `npx vitest run __tests__/MaterialsTable.test.tsx` → pass; `npm run test:all` → green.
- [ ] Commit: `feat(admin): MaterialsTable server pagination/sort via MaterialsContext (#205)`

---

## Task 11: Tags — context wrapper + table migration + test extension
### Classification: standard

### Required Docs
- Same as Task 7: `tags/components/TagsTable.tsx` (no status filter; single sortable key `tag`), `__tests__/tags/TagsTable.test.tsx` (existing 88-line shallow file — EXTEND, don't replace), `docs/domain-rules/tags.md`

### Task Description
Identical migration for Tags with two differences: `withStatus: false` (no status anywhere — no param, no queryKey slot) and the existing test file is extended with pagination/sort cases (its current error-state and status-column regression tests stay). No `defaultSortBy` (initial fetch unsorted → new server default `tag ASC, id ASC`); the fetcher passes sort params through once set: `getTags({ page: p.page, per_page: p.per_page, sort_by: p.sort_by, sort_order: p.sort_order })` (undefined keys are skipped by `listQuery`). Provider `TagsProvider`, hook `useTagsTable`, file `contexts/TagsContext.tsx`.

### Steps
- [ ] **RED:** Extend `__tests__/tags/TagsTable.test.tsx` with the Task 7 pattern cases (fetch params WITHOUT a status key; pager from envelope total; `setSort('tag', 'desc')` on header click; search filters loaded items). Existing tests must keep passing after GREEN. Run → new cases fail.
- [ ] **GREEN:** Create `contexts/TagsContext.tsx`; wrap `app/(main)/tags/page.tsx`; rewrite TagsTable per the rules (no status tabs exist — nothing to remove there).
- [ ] Run `npx vitest run __tests__/tags/TagsTable.test.tsx` → pass; `npm run test:all` → green.
- [ ] Commit: `feat(admin): TagsTable server pagination/sort via TagsContext (#205)`

---

## Task 12: Lookup maps & dropdown hooks → `/all`
### Classification: standard

### Required Docs
- Spec §5.5 (consumer table, cache-key semantics, Menubar note)
- `frontend/admin/contexts/RecordsContext.tsx:137-205`, `ScheduleContext.tsx:269-292`, `hooks/useRecordData.ts:33-48`, `hooks/useMasters.ts` (whole file), `hooks/useLocations.ts`, `hooks/useServices.ts`

### Task Description
Switch every dictionary lookup-map/dropdown fetch from `per_page=100` paginated calls to the new `getAllX` bare-array methods. Cache keys and `staleTime` are UNCHANGED. Activities and payments are untouched (out of scope). Menubar needs no edit (it consumes `useMasters`). Prove cross-granularity invalidation: a mutation's `invalidateQueries({ queryKey: ['masters'] })` must refetch BOTH the `/all` lookup cache (`['masters']`) and the table cache (`['masters', page, ...]`) — react-query array-prefix matching.

### Steps
- [ ] **RED:** Update/add failing tests first:
  - `__tests__/useReactQueryHooks.test.tsx` (or the relevant existing hook test files): `useMasters`/`useServices`/`useLocations` now call `getAllMasters`/`getAllServices`/`getAllLocations` (mock `@memo/api-client`, assert the getAll fns are called and `getMasters` is NOT).
  - `__tests__/RecordsContext.test.tsx` / `ScheduleContext.test.tsx`: the masters/services/locations queries call the `getAllX` fns (keys unchanged: `['masters']` etc.).
  - `__tests__/useRecordData.test.tsx`: same for its three dictionary queries.
  - NEW invalidation test (add to `useReactQueryHooks.test.tsx` or a new `__tests__/dictionaryCacheInvalidation.test.tsx`): mount a QueryClient with two observer queries — `['masters']` and `['masters', 1, 10, 'active', 'name', 'asc']` (both `vi.fn` fetchers) → run `queryClient.invalidateQueries({ queryKey: ['masters'] })` → assert BOTH fetchers re-ran (prefix matching covers both granularities).
  Run → fail (getAll fns not called yet).
- [ ] **GREEN:** Edits (exact):
  - `RecordsContext.tsx` — masters query (:143-147): `queryFn: () => getAllMasters(),` (drop `.then(r => r.items)`); same for services (:149-153) → `getAllServices()` and locations (:155-159) → `getAllLocations()`. Activities (:137-141) and clients (:162-166) UNTOUCHED. Imports updated.
  - `ScheduleContext.tsx` — masters (:275), services (:280), locations (:285) queryFns → `getAllX()`; activities (:271) untouched; the `useMasters()/useServices()/useLocations()` usage at :290-292 unchanged (hooks updated below).
  - `hooks/useRecordData.ts` — services (:33), masters (:38), locations (:43) queryFns → `getAllX()`; payments (:48) untouched.
  - `hooks/useMasters.ts` :11 → `queryFn: () => getAllMasters(),` (keep `select`, `staleTime`); same for `useLocations.ts`/`useServices.ts`.
- [ ] Grep gate (must pass before commit): `grep -rn "per_page: 100\|per_page=100" frontend/admin --include="*.ts" --include="*.tsx"` → NO hits for masters/services/locations fetches (activities `getActivities(...per_page: 100)` and record-scoped queries like `getRecords({... per_page: 100 })` REMAIN — those are in scope to keep).
- [ ] Run `npm run test:all` (UI-adjacent: dropdown data sources) → green + tsc clean.
- [ ] Commit: `feat(admin): dictionary lookup maps and dropdown hooks fetch via /all (#205)`

---

## Task 13: Domain-rules updates for the 5 dictionaries
### Classification: small

### Required Docs
- `docs/domain-rules/{masters,locations,services,tags,materials}.md` (existing structure)
- Spec §4 (backend contract) + §6 (search matrix)

### Task Description
Living-docs update: each dictionary's domain-rules file gains a **"List contract"** section recording: (a) paginated list params (`page`/`per_page≤100`/`status`/whitelisted `sort_by` + `sort_order`, default order per §4.4); (b) `/all` contract (bare array, `BARE_LIST_MAX_ROWS = 1000` → 422 English message, deterministic order, status parity where applicable); (c) consumer map (tables = server-paginated; dropdowns/lookup maps = `/all`); (d) pointer to the search matrix in the spec §6 (table search → #212 `?q=`; dictionary dropdowns → #214 combobox over `/all`).

### Steps
- [ ] Add the section to all 5 files (same template, entity-specific whitelist/order). Keep each ≤15 lines.
- [ ] Commit: `docs(domain): list contract (/all, sort whitelist, default order) for the 5 dictionaries (#205)`

---

## Self-Review Checklist (architect, completed at plan save)

- Spec coverage: §4.1→T1, §4.2/4.3/4.4(routes)→T2, §4.4(defaults)/4.5→T3, §4.6→T4, §5.1→T5, §5.2→T6, §5.3/5.6→T7-11, §5.5→T12, §7 AC10 (domain rules)→T13. AC3 (404 guard) →T4. AC5 (contract tests) →T4. ✅
- No placeholders; every task has Required Docs + exact code + commands. ✅
- Type consistency: `getAllX` names match across T5/T12; context hook names (`useXTable`) consistent T6-T11; `BARE_LIST_MAX_ROWS`/`BareListLimitExceededError` consistent T1/T2/T4. ✅
- Cross-task dependency order: T1→T2→T3→T4 (backend), T5 (api-client, needs T2/T3 contracts), T6→T7-11 (factory before tables; tables need T3 sort + T5 params), T12 (needs T5), T13 last. ✅
