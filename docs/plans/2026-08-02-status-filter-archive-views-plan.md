# GH #195 — `status` Filter Param + Frontend Archive Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `status=active|archived|all` filter (default `active`) to the list endpoints of masters, locations, services, materials, and clients, and wire server-side archive filtering into the 4 admin tables + clients filters.

**Architecture:** New `ArchiveStatus` StrEnum in `src/models/enums.py` shared across routers → services → repository. New `SoftDeleteService(GenericService)` owns the status filter via a template-method split of `GenericService.list`; base `GenericService` loses all is_active knowledge (tags/visitors/payments/records unaffected). Frontend: 4 tables switch from dead client-side status filters to server-side filtering (queryKey + queryFn + `keepPreviousData`); clients filters move from `is_active` bool to the `status` enum.

**Tech Stack:** FastAPI + Pydantic v2 + SQLAlchemy (async) + pytest · TypeScript api-client · Next.js admin + react-query v5 + vitest · Playwright (1 existing spec updated)

**Spec:** `docs/specs/2026-08-02-is-active-list-filters-design.md` (rev 6, approved G1b 2026-08-02)

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Scenario 1 (default view)** → On /masters, /locations, /services, /materials the status filter shows «Активные» selected; the table lists only active records — exactly as today. Switching filters no longer flashes a full-table "Загрузка…".
- **Scenario 2 («Все»)** → Selecting «Все» sends `?status=all`; the table shows active + archived records together (request goes to the server, not client-side filtering).
- **Scenario 3 («Архив» + restore)** → Selecting «Архив» sends `?status=archived`; only archived records appear; clicking «Восстановить» on a row restores it and the row disappears from the archive view.
- **Scenario 3a (inverse)** → Archiving a row from the «Активные» view makes it disappear after refresh (it appears under «Архив»).
- **Scenario 4 (all 4 pages)** → Identical behavior on all 4 pages; dropdowns have exactly 3 options: «Активные» / «Все» / «Архив».
- **Scenario 5 (clients)** → /clients default view unchanged (active only); «Все» now genuinely shows active + archived clients (previously silently broken); «Неактивные» keeps showing archived-only. Archived clients are visible but cannot be restored from the UI (known gap, follow-up issue).
- **Scenario 6 (API contract)** → `GET /api/v1/{masters,locations,services,materials,clients}` with no `status` returns active only — the public site schedule, booking forms, and phone search behave exactly as before. `?status=foo` → 422.
- **Editing an archived row** → Opening an archived record's edit modal and saving changes does NOT silently resurrect it (its archived state is preserved).

---

## Task 1: `ArchiveStatus` enum + SoftDeleteRepository.list rename

### Classification: small
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §4, §5.1

### Task Description

**Files:**
- Modify: `backend/src/models/enums.py`
- Modify: `backend/src/repositories/generic.py` (SoftDeleteRepository.list, lines 125–139)
- Modify: `backend/tests/test_repositories.py` (or create `backend/tests/test_soft_delete_repository.py` if no repository test file exists — check first)

**Context:** `SoftDeleteRepository.list` is dead code (zero callers — verified), but the rename keeps naming consistent per spec §5.1. The enum follows the existing `(str, enum.Enum)` project pattern (Python 3.12; stdlib `StrEnum` NOT used in this codebase).

**Steps:**
- [ ] Add to `backend/src/models/enums.py` (pattern copied from `Channel`, line 41–44):

```python
class ArchiveStatus(str, enum.Enum):
    """List filter for soft-delete entities: active (default), archived, or all."""

    ACTIVE = "active"
    ARCHIVED = "archived"
    ALL = "all"
```

- [ ] In `backend/src/repositories/generic.py`: change import to `from sqlalchemy import not_, select` and add `from src.models.enums import ArchiveStatus`; rewrite SoftDeleteRepository.list (lines 125–139) as:

```python
    async def list(
        self, session: AsyncSession, table: type[ModelType], order_by=None,
        status: ArchiveStatus = ArchiveStatus.ACTIVE, **filters
    ) -> list[ModelType]:
        """Return records filtered by archive status, optionally filtered and ordered."""
        stmt = select(table)
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(table.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(table.is_active))
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(table, key) == value)
        if order_by is not None:
            stmt = stmt.order_by(*order_by)
        result = await session.execute(stmt)
        return list(result.scalars().all())
```

- [ ] Write unit test (RED→GREEN) calling `SoftDeleteRepository.list` directly with each status on a soft-delete model (e.g. Master): ACTIVE → active only; ARCHIVED → archived only; ALL → both. Mark `pytest.mark.unit` if the file's convention allows (check neighboring repository tests for the marker/fixtures).
- [ ] Run: `cd backend && uv run pytest tests/ -k repository -v` → pass.
- [ ] Commit: `feat(backend): add ArchiveStatus enum, rename SoftDeleteRepository.list param (GH #195)`

---

## Task 2: `SoftDeleteService` + base GenericService cleanup + service migrations

### Classification: standard
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §5.2 (incl. plan-verification bullet)
- Skill: `pytest-patterns`

### Task Description

**Files:**
- Modify: `backend/src/services/generic.py` (split `list` into template method; add `SoftDeleteService`)
- Modify: `backend/src/services/master.py:11`, `location.py:11`, `material.py:11`, `client.py:27–28` (change base class)
- Modify: `backend/tests/` — add unit tests for SoftDeleteService.list (suggest `backend/tests/test_soft_delete_service.py`)

**Context:** Current `GenericService.list` (lines 50–79) has the `if self._model.soft_delete:` guard (line ~66). After this task: base has NO is_active knowledge; `SoftDeleteService` owns the filter. Template-method split avoids duplicating the pagination tail and keeps `status` out of `**filters` (double-where hazard, spec §5.2). `TagService`/`VisitorService`/`PaymentService`/`RecordService` stay on base `GenericService` (hard-delete models — guard never applied to them; Payment/Record override `list` anyway).

**Exact new code for `backend/src/services/generic.py`** (imports add `from sqlalchemy import func, not_, select` and `from src.models.enums import ArchiveStatus`):

```python
    # Base GenericService has NO is_active knowledge. Soft-delete filtering
    # lives in SoftDeleteService below (#195).
    def _list_stmt(self, **filters):
        """Build the base select with equality filters applied."""
        stmt = select(self._model)
        for key, value in filters.items():
            if value is not None:
                stmt = stmt.where(getattr(self._model, key) == value)
        return stmt

    async def _paginate(
        self, db_session: AsyncSession, stmt, page: int, per_page: int, order_by=None
    ) -> PaginatedResponse[ResponseSchemaT]:
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

    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        order_by=None,
        **filters,
    ) -> PaginatedResponse[ResponseSchemaT]:
        """Return a paginated page of records, optionally filtered/ordered."""
        return await self._paginate(
            db_session, self._list_stmt(**filters), page, per_page, order_by
        )


class SoftDeleteService(GenericService[CreateSchemaT, UpdateSchemaT, ResponseSchemaT]):
    """GenericService for soft-delete models (AbstractModelSoftDelete) with
    archive-status list filtering (#195)."""

    def _list_stmt(self, status: ArchiveStatus = ArchiveStatus.ACTIVE, **filters):
        stmt = super()._list_stmt(**filters)
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(self._model.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(self._model.is_active))
        return stmt

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
        return await self._paginate(
            db_session, self._list_stmt(status=status, **filters), page, per_page, order_by
        )
```

(Remove the old NOTE comment at lines 50–53 and the `if self._model.soft_delete:` guard — they are replaced by the above.)

**Migrations (4 files, one-line change + import each):** e.g. `master.py`:

```python
from src.services.generic import SoftDeleteService

class MasterService(SoftDeleteService[MasterCreate, MasterUpdate, MasterResponse]):
```

Same for `LocationService`, `MaterialService`, `ClientService`.

**Steps:**
- [ ] Plan verification (spec §5.2): `grep -rn "AbstractModelSoftDelete" backend/src/models/` → models are Material, Master, Location, User, Service, Tariff, Client. Confirm: User and Tariff have NO service whose inherited `GenericService.list` lists them (User has no service; Tariff is nested under ServiceService). Record the conclusion in the commit message. If a missed listing path exists → STOP and report.
- [ ] RED: write `test_soft_delete_service.py` — unit tests for `SoftDeleteService.list` on a soft-delete model (e.g. via `MasterService` or a direct instance): status ACTIVE (default) → active only; ARCHIVED → archived only; ALL → both; `status` never leaks into `**filters` (calling `list(status=..., phone=...)` style with an extra filter works and doesn't raise AttributeError).
- [ ] Implement the generic.py rewrite + 4 migrations (GREEN).
- [ ] Regression: `cd backend && uv run pytest tests/test_api_tags.py tests/test_api_visitors.py tests/test_api_masters.py tests/test_api_locations.py tests/test_api_materials.py -v` → pass (tags/visitors structurally unaffected; masters/locations/materials default active unchanged).
- [ ] Full backend suite: `cd backend && uv run pytest -v --tb=short -x -q` → pass (3 known skips OK).
- [ ] Commit: `feat(backend): introduce SoftDeleteService with ArchiveStatus filtering (GH #195)`

---

## Task 3: ServiceService migration + eager-load override update

### Classification: small
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §5.3
- Skill: `pytest-patterns`

### Task Description

**Files:**
- Modify: `backend/src/services/service.py` (class def line 21, list override lines 31–54; imports line 7 add `not_`, add `from src.models.enums import ArchiveStatus`, change import line 17 to `from src.services.generic import SoftDeleteService`)
- Modify: `backend/tests/test_api_services.py` (add status filter tests — or in Task 4's new test class; keep together here for services)

**Context:** ServiceService.list eager-loads tariffs/tags and currently hardcodes `.where(Service.is_active)` (line 41). It must become status-driven. (Duplicating the 3-line clause here instead of composing is accepted — spec §5.3; the eager-load stmt is structurally different.)

**Exact changes:**

```python
class ServiceService(SoftDeleteService[ServiceCreate, ServiceUpdate, ServiceResponse]):
```

```python
    async def list(
        self,
        db_session: AsyncSession,
        page: int = 1,
        per_page: int = 20,
        status: ArchiveStatus = ArchiveStatus.ACTIVE,
        **filters,
    ) -> PaginatedResponse[ServiceResponse]:
        """Return a paginated page of services filtered by archive status,
        with tariffs/tags eagerly loaded."""
        stmt = (
            select(Service)
            .options(selectinload(Service.tariffs), selectinload(Service.tags))
        )
        if status == ArchiveStatus.ACTIVE:
            stmt = stmt.where(Service.is_active)
        elif status == ArchiveStatus.ARCHIVED:
            stmt = stmt.where(not_(Service.is_active))
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

**Steps:**
- [ ] RED: add tests to `test_api_services.py` (class `TestServiceListStatusFilter`): absent → active only (already covered by `test_list_services_includes_created`, keep); create + delete a service → `?status=archived` returns only the deleted one; `?status=all` returns both; `?status=foo` → 422. Use the existing API-factory fixtures (`api_client`, `create_service` — see conftest.py:276–312 area / test_api_services.py patterns). Mark consistent with the file's existing markers.
- [ ] Implement the service.py changes (GREEN).
- [ ] Run: `cd backend && uv run pytest tests/test_api_services.py -v` → pass.
- [ ] Commit: `feat(backend): ServiceService archive-status filtering with eager load (GH #195)`

---

## Task 4: Router `status` params (masters, locations, services, materials) + endpoint tests

### Classification: standard
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §5.4, §9
- Skill: `pytest-patterns`

### Task Description

**Files:**
- Modify: `backend/src/api/v1/masters.py` (list endpoint, lines 28–41), `locations.py` (34–47), `services.py` (26–34), `materials.py` (26–34) — add import `from src.models.enums import ArchiveStatus`
- Modify: `backend/tests/test_api_masters.py`, `test_api_locations.py`, `test_api_materials.py` (add status filter test classes; services done in Task 3)

**Context:** clients is a carve-out (spec §5.4) — do NOT touch clients.py here. Pattern per router (masters shown):

```python
@router.get("", response_model=PaginatedResponse[MasterResponse])
async def list_masters(
    service: _ServiceDep,
    session: SessionDep,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),
) -> PaginatedResponse[MasterResponse]:
    """Return masters filtered by archive status (default: active),
    sorted by sort_order, then name."""
    return await service.list(
        db_session=session,
        page=page,
        per_page=per_page,
        status=status,
        order_by=[asc(Master.sort_order), asc(Master.first_name)],
    )
```

- locations: same + `order_by=[asc(Location.sort_order), asc(Location.name)]`.
- services/materials: same without order_by (their current calls don't pass it).

**Steps:**
- [ ] RED: add `TestListStatusFilter` classes to `test_api_masters.py`, `test_api_locations.py`, `test_api_materials.py`, copying the `TestClientListFilterIsActive` pattern (`test_client_stats.py:420–450`): create one active + one archived (POST then DELETE) entity → absent param: active in, archived out; `?status=archived`: archived in, active out; `?status=all`: both in; `?status=foo` → 422. Use each file's existing fixtures/markers (`pytest.mark.api` where the file uses it).
- [ ] Implement the 4 router changes (GREEN).
- [ ] Run: `cd backend && uv run pytest tests/test_api_masters.py tests/test_api_locations.py tests/test_api_services.py tests/test_api_materials.py tests/test_api_pagination_params.py -v` → pass (pagination_params guards the envelope unchanged).
- [ ] Commit: `feat(backend): status query param on 4 list endpoints (GH #195)`

---

## Task 5: Clients backend alignment (`ClientListParams` + `list_clients_with_stats`)

### Classification: standard
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §5.5, §9
- `docs/domain-rules/clients.md`
- Skill: `pytest-patterns`

### Task Description

**Files:**
- Modify: `backend/src/schemas/client.py` (ClientListParams line 75; add `from src.models.enums import ArchiveStatus` to imports, line 7 area)
- Modify: `backend/src/services/client.py` (lines 103–106; ensure `not_` imported)
- Modify: `backend/tests/test_client_stats.py` (rewrite `TestClientListFilterIsActive`, lines 420–450)

**Exact changes:**

`schemas/client.py` — in `ClientListParams`, replace `is_active: bool | None = None` with:

```python
    status: ArchiveStatus = ArchiveStatus.ACTIVE
```

`services/client.py` — replace lines 103–106 with:

```python
    # 5. Apply archive status filter (default: active only; ALL = no filter)
    if params.status == ArchiveStatus.ACTIVE:
        query = query.where(Client.is_active)
        count_query = count_query.where(Client.is_active)
    elif params.status == ArchiveStatus.ARCHIVED:
        query = query.where(not_(Client.is_active))
        count_query = count_query.where(not_(Client.is_active))
```

(add `from src.models.enums import ArchiveStatus` to client.py imports — it already imports from src.models.enums for Channel? check and extend the existing import line.)

`tests/test_client_stats.py` — rewrite the class (keeps name or rename to `TestClientListFilterStatus`):

```python
class TestClientListFilterStatus:
    """Verify status filter (active default / archived / all)."""

    def test_filter_status_active_default(self, api_client, create_client) -> None:
        """Absent status returns only active clients (safe default)."""
        active = create_client(name="Active One")
        inactive = create_client(name="Inactive One")
        api_client.delete(f"/api/v1/clients/{inactive['id']}")

        resp = api_client.get("/api/v1/clients")
        ids = [c["id"] for c in resp.json()["items"]]
        assert active["id"] in ids
        assert inactive["id"] not in ids

    def test_filter_status_archived(self, api_client, create_client) -> None:
        """status=archived returns only soft-deleted clients."""
        active = create_client(name="Active Two")
        inactive = create_client(name="Inactive Two")
        api_client.delete(f"/api/v1/clients/{inactive['id']}")

        resp = api_client.get("/api/v1/clients", params={"status": "archived"})
        ids = [c["id"] for c in resp.json()["items"]]
        assert inactive["id"] in ids
        assert active["id"] not in ids

    def test_filter_status_all_includes_archived(self, api_client, create_client) -> None:
        """status=all returns active AND archived clients (regression: must
        assert archived inclusion, not just total >= 1)."""
        active = create_client(name="Active Three")
        inactive = create_client(name="Inactive Three")
        api_client.delete(f"/api/v1/clients/{inactive['id']}")

        resp = api_client.get("/api/v1/clients", params={"status": "all"})
        ids = [c["id"] for c in resp.json()["items"]]
        assert active["id"] in ids
        assert inactive["id"] in ids

    def test_filter_status_invalid_returns_422(self, api_client) -> None:
        resp = api_client.get("/api/v1/clients", params={"status": "foo"})
        assert resp.status_code == 422
```

**Steps:**
- [ ] RED: rewrite the test class + add a phone-search regression test (in the appropriate clients test file): create + archive a client with a known phone → `GET /api/v1/clients/search?phone=...` returns 404 for the archived one and 200 for an active one (locks spec §5.5).
- [ ] Implement schema + service changes (GREEN).
- [ ] Grep for other backend uses of `params.is_active` / `is_active=` on clients (`grep -rn "is_active" backend/src/api/v1/clients.py backend/src/services/client.py backend/tests/test_client_stats.py`) — update any stragglers.
- [ ] Run: `cd backend && uv run pytest tests/test_client_stats.py -v` → pass; then full suite `uv run pytest -q --tb=short` → pass.
- [ ] Commit: `feat(backend)!: clients list filter is_active → status enum (GH #195)`

---

## Task 6: API client — `ListParams.status` + `listQuery`

### Classification: small
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §6

### Task Description

**Files:**
- Modify: `packages/api-client/src/endpoints.ts` (ListParams lines 84–87, listQuery lines 89–95)
- Modify: `packages/api-client/tests/` (find the existing listQuery/endpoints test file — e.g. `endpoints.test.ts`; add cases)

**Exact changes:**

```ts
export interface ListParams {
  page?: number;
  per_page?: number;
  /** Archive filter — soft-delete entities only (masters/locations/services/materials).
   *  Ignored by endpoints that don't declare it (tags, visitors). */
  status?: 'active' | 'all' | 'archived' | null;
}

function listQuery(params?: ListParams): string {
  const search = new URLSearchParams();
  if (params?.page) search.set('page', String(params.page));
  if (params?.per_page) search.set('per_page', String(params.per_page));
  if (params?.status) search.set('status', params.status);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}
```

(`if (params?.status)` is safe: `null`/`undefined` are falsy and omitted; all three real values are non-empty strings.)

**Steps:**
- [ ] RED: add listQuery tests (via a public getter mock or however the existing file tests query building): `{ status: 'archived' }` → `status=archived` in URL; `{ status: 'all' }` → `status=all`; `{ status: 'active' }` → `status=active`; `{ status: null }` and `{}` → no `status` in URL.
- [ ] Implement (GREEN).
- [ ] Run: `cd packages/api-client && npm run test` → pass (4 known failures from #188 are pre-existing — confirm count unchanged: 139p/4f baseline).
- [ ] Commit: `feat(api-client): ListParams.status + listQuery serialization (GH #195)`

---

## Task 7: Masters + Locations tables — server-side filtering

### Classification: standard
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §7.1–7.4
- Skill: `vitest-playwright-patterns`

### Task Description

**Files (per table, masters shown; locations identical structure):**
- Modify: `frontend/admin/app/(main)/masters/components/MastersTable.tsx`
- Modify: `frontend/admin/app/(main)/masters/components/MasterFilters.tsx` (lines 50–64)
- Modify: `frontend/admin/__tests__/MastersTable.test.tsx` (filter tests 214–254)
- Modify: `frontend/admin/app/(main)/locations/components/LocationsTable.tsx`, `LocationFilters.tsx`, `__tests__/LocationsTable.test.tsx` (241–309)

**Exact changes (MastersTable.tsx):**

State (lines 60–64) — default `'active'`, typed:

```ts
const [status, setStatus] = useState<'active' | 'all' | 'archived'>('active');
```

Query (lines 38–41) — keyed, server-side, keepPreviousData (update the react-query import to include `keepPreviousData`):

```ts
const { data: masters = [], isLoading, error, refetch } = useQuery<MasterResponse[]>({
  queryKey: ['masters', status],
  queryFn: () => getMasters({ per_page: 100, status }).then(r => r.items),
  placeholderData: keepPreviousData,
});
```

Move the `useState` block ABOVE the `useQuery` call (status is referenced by the query).

Memo (lines 86–100) — delete ONLY the two status lines (keep search):

```ts
const filteredMasters = useMemo(() => {
  return masters.filter((m) => {
    if (search) {
      const q = search.toLowerCase();
      const firstNameMatch = m.first_name.toLowerCase().includes(q);
      const lastNameMatch = m.last_name.toLowerCase().includes(q);
      if (!firstNameMatch && !lastNameMatch) return false;
    }
    return true;
  });
}, [masters, search]);
```

Reset handler (line 251): `onReset={() => { setSearch(''); setStatus('active'); }}`

**MasterFilters.tsx (50–64):** `<option value="">Все</option>` → `<option value="all">Все</option>` (nothing else changes; props stay `string`).

**Locations:** same edits at LocationsTable.tsx (query 41–44, state 64–67, memo 89–103, reset 250) and LocationFilters.tsx (50–64).

**Test updates (`MastersTable.test.tsx`, `LocationsTable.test.tsx`):** the existing tests assert client-side filtering over a static mock. Rewrite the status-related ones to assert server-side behavior (adjust to each file's `setupQuery`/mock helper):

```ts
it('requests active masters by default', () => {
  const spy = setupQuery(TEST_MASTERS); // existing mock of getMasters
  render(<MastersTable />);
  expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'active' });
});

it('requests archived masters when filter is "Архив"', () => {
  const spy = setupQuery(TEST_MASTERS);
  render(<MastersTable />);
  fireEvent.change(screen.getByLabelText('Фильтр по статусу'), { target: { value: 'archived' } });
  expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'archived' });
});

it('requests all masters when filter is "Все"', () => { /* value: 'all' → status: 'all' */ });

it('resets filters to active when reset button clicked', () => {
  // change to 'archived', click «Сбросить», assert select value 'active'
  // and last mock call had status: 'active'
});
```

(Adapt `spy` to the file's existing mocking pattern — it mocks `getMasters`; expose the mock for assertions. Search-filter tests stay unchanged — search remains client-side.)

**Steps:**
- [ ] RED: update the test files first (they fail against the old client-side implementation where appropriate — at minimum the new mock-arg assertions fail).
- [ ] Implement table + filter component changes (GREEN).
- [ ] Verify no remaining references to the old behavior: `grep -n "status === 'active' &&" frontend/admin/app/(main)/masters/components/MastersTable.tsx frontend/admin/app/(main)/locations/components/LocationsTable.tsx` → no matches.
- [ ] Run: `cd frontend/admin && npm run test -- MastersTable LocationsTable` → pass; type-check clean.
- [ ] Commit: `feat(admin): server-side archive filter for masters & locations tables (GH #195)`

---

## Task 8: Services + Materials tables — server-side filtering + minimal Materials test

### Classification: standard
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §7.1–7.4, §9
- Skill: `vitest-playwright-patterns`

### Task Description

**Files:**
- Modify: `frontend/admin/app/(main)/services/components/ServicesTable.tsx` (query 169–173 keep its `staleTime`, state 182–183 already `'active'`, memo 219–227, reset 376–379 already `'active'`), `ServiceFilters.tsx` (50–64), `__tests__/ServicesTable.test.tsx` (132–139, 194–209)
- Modify: `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` (query 93–97 keep `staleTime`, state 106–107, memo 143–151, inline select 314–328, reset 330–339)
- Create: `frontend/admin/__tests__/MaterialsTable.test.tsx` — **minimal**: filter → queryFn/queryKey mapping only (mock `getMaterials`; assert default call `{ per_page: 100, status: 'active' }`, switch to `archived`/`all` asserts call args). Copy the mock/render helper pattern from `ServicesTable.test.tsx`.

**Exact changes** — same pattern as Task 7:

ServicesTable query:

```ts
const { data: services = [], isLoading, error, refetch } = useQuery<ServiceResponse[]>({
  queryKey: ['services', status],
  queryFn: () => getServices({ per_page: 100, status }).then(r => r.items),
  staleTime: 5 * 60 * 1000,
  placeholderData: keepPreviousData,
});
```

(remove the two status lines from `filteredServices` memo 219–227; state/reset already `'active'` — no change; `ServiceFilters.tsx`: `<option value="">Все</option>` → `<option value="all">Все</option>`)

MaterialsTable: same (query 93–97 → `queryKey: ['materials', status]`, queryFn passes `status`, keep staleTime, add placeholderData; memo 143–151 drop status lines; inline select 314–328: `<option value="">Все</option>` → `<option value="all">Все</option>`).

**ServicesTable.test.tsx updates:** `renders all services when status filter is "all"` (line 132) currently does `fireEvent.change(..., { value: '' })` → change to `value: 'all'` and assert mock called with `status: 'all'`; `filters by status (archived)` (202) → assert mock called with `status: 'archived'`; default test (128–129) → assert default call `status: 'active'`.

**Steps:**
- [ ] RED: update ServicesTable tests + create MaterialsTable.test.tsx (new file fails — no component changes yet).
- [ ] Implement (GREEN).
- [ ] Run: `cd frontend/admin && npm run test -- ServicesTable MaterialsTable` → pass; type-check clean.
- [ ] Commit: `feat(admin): server-side archive filter for services & materials tables (GH #195)`

---

## Task 9: Clients frontend — `status` enum mapping + default «Активные»

### Classification: standard
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §5.5, §7.6
- `docs/domain-rules/clients.md`
- Skill: `vitest-playwright-patterns`

### Task Description

**Files:**
- Modify: `frontend/admin/contexts/ClientsContext.tsx` (ClientFilters 14–27, defaultFilters 29–42)
- Modify: `frontend/admin/app/(main)/clients/components/ClientsFilters.tsx` (lines 40–53)
- Modify: `frontend/admin/app/(main)/clients/components/ClientsTable.tsx` (hasActiveFilters 37–43)
- Modify: clients-related unit tests (find via `grep -rln "is_active" frontend/admin/__tests__/ | grep -i client`)

**Exact changes:**

`ClientsContext.tsx`:

```ts
export interface ClientFilters {
  search: string;
  status: 'active' | 'all' | 'archived';
  created_from: string;
  // … rest unchanged
}

const defaultFilters: ClientFilters = {
  search: '',
  status: 'active',
  // … rest unchanged
};
```

(The `...filters` spread at lines 78–88 then sends `status=active|all|archived` through `getClientsWithStats` — no other change; `getClientsWithStats` skips null/'' but passes strings.)

`ClientsFilters.tsx` (40–53):

```tsx
<select
  className={inputClass}
  style={inputStyle}
  value={filters.status}
  onChange={(e) => setFilters({ status: e.target.value as ClientFilters['status'] })}
>
  <option value="all">Все</option>
  <option value="active">Активные</option>
  <option value="archived">Неактивные</option>
</select>
```

`ClientsTable.tsx` (37–43): replace `filters.is_active !== null` with `filters.status !== 'active'` (default must NOT count as an active filter; `'all'`/`'archived'` must).

**Steps:**
- [ ] RED: update clients unit tests: default filters contain `status: 'active'`; selecting «Неактивные» sets `status: 'archived'`; «Все» → `'all'`; `hasActiveFilters` is false with defaults and true when status is `'all'`/`'archived'`.
- [ ] Implement (GREEN).
- [ ] Grep for remaining `is_active` filter usages in clients frontend: `grep -rn "is_active" frontend/admin/app/\(main\)/clients frontend/admin/contexts/ClientsContext.tsx` → only entity-field reads (e.g. row rendering) may remain, no filter-state usage.
- [ ] Run: `cd frontend/admin && npm run test -- -i Clients` (or the exact clients test file names) → pass; type-check clean.
- [ ] Commit: `feat(admin)!: clients filters is_active → status enum, default «Активные» (GH #195)`

---

## Task 10: Edit modals preserve `is_active` on archived rows (4 tables)

### Classification: standard
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §7.5, §9 (TS type note)

### Task Description

**Files:**
- Modify: `frontend/admin/app/(main)/masters/components/MastersTable.tsx` (handleEdit 154–172)
- Modify: `frontend/admin/app/(main)/locations/components/LocationsTable.tsx` (handleEdit 152–171)
- Modify: `frontend/admin/app/(main)/services/components/ServicesTable.tsx` (handleEditSubmit 292–303)
- Modify: `frontend/admin/app/(main)/services/components/MaterialsTable.tsx` (handleEditSubmit 216–227)
- Modify: the 4 table test files — add one payload assertion each

**Hazard:** backend `Update` schemas default `is_active: bool = True`; the modal payloads don't include `is_active`; editing an archived row would silently resurrect it.

**Exact changes:**

MastersTable.handleEdit — after the payload-building loop (before `updateMaster.mutateAsync`):

```ts
  // Preserve archive state — backend Update schema defaults is_active=True (#195)
  (payload as Record<string, unknown>).is_active = editMaster.is_active;
```

LocationsTable.handleEdit — same with `editLocation.is_active`.

ServicesTable.handleEditSubmit (292–303) — wrap the data:

```ts
    await updateService.mutateAsync({
      id: editingService.id,
      data: { ...(data as Record<string, unknown>), is_active: editingService.is_active },
    });
```

MaterialsTable.handleEditSubmit (216–227) — same with `editingMaterial.is_active`.

**Steps:**
- [ ] RED: add to each table's test file: render, open edit on an archived row (fixture with `is_active: false`), submit → assert the update mock (`updateMaster`/`updateLocation`/`updateService`/`updateMaterial`) was called with `is_active: false` in the payload. (For MaterialsTable this extends the new test file from Task 8.)
- [ ] Implement (GREEN).
- [ ] Run: `cd frontend/admin && npm run test -- MastersTable LocationsTable ServicesTable MaterialsTable` → pass; type-check clean.
- [ ] Commit: `fix(admin): preserve is_active when editing archived rows (GH #195)`

---

## Task 11: E2E — update clients.spec.ts status filter test

### Classification: small
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §3 (E2E bullet), §9
- Skill: `vitest-playwright-patterns`

### Task Description

**Files:**
- Modify: `frontend/admin/e2e/clients.spec.ts` (test 11, lines 327–359)

**Exact changes:**
- Line 337: `resp.url().includes('is_active=false')` → `resp.url().includes('status=archived')`
- Line 340: `await statusSelect.selectOption('false');` → `await statusSelect.selectOption('archived');`
- Line 356: `await expect(statusSelect).toHaveValue('', ...)` → `await expect(statusSelect).toHaveValue('active', ...)`
- Update the comments at 349–354 to reflect the new default («Активные», value `'active'`).

**Steps:**
- [ ] Apply the edits.
- [ ] Run the single spec: `cd frontend/admin && npx playwright test e2e/clients.spec.ts -g "Status filter"` → pass (requires the E2E environment; follow `vitest-playwright-patterns` / dev-workflow skill for the full-cycle setup).
- [ ] Commit: `test(e2e): clients status filter spec → status enum (GH #195)`

---

## Task 12: Domain-rules docs sync

### Classification: trivial
### Required Docs
- `docs/specs/2026-08-02-is-active-list-filters-design.md` §5.6

### Task Description

**Files:**
- Modify: `docs/domain-rules/masters.md` (API table row, line 33), `locations.md` (line 39), `services.md` (line 50), `materials.md` (line 29), `clients.md` (API section)

**Changes (per file):** update the `GET /api/v1/{entity}` row description from "List all active …" / "List active …" to: "List records — `?status=active` (default) | `archived` | `all`". In `clients.md`: document the list `status` filter (default active, `archived`, `all`) and note the retirement of the `is_active` query param.

**Steps:**
- [ ] Apply edits.
- [ ] Commit: `docs: sync domain rules with status filter (GH #195)`

---

## Final Verification (architect, after Task 12)

- `cd backend && uv run pytest -q --tb=short` → all pass (3 known skips).
- `cd packages/api-client && npm run test` → 139p/4f (4 = known #188) + new listQuery cases pass.
- `cd frontend/admin && npm run test` → all pass; `npm run test:all` if E2E environment available.
- Visual Compliance Gate per spec §11 (Step 4.5 of IMPL).
