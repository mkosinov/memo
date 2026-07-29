# GenericService.list(): Mandatory Pagination + API & Frontend Migration — Design

- Date: 2026-07-28
- GitHub issue: #182 (refs: #175, PR #181)
- Status: approved at G1b (with user amendments below), 2026-07-28

### G1b user amendments (binding)

1. Scope approved: all 9 bare-list GenericService endpoints including visits/records/services; visitors excluded (no bare list endpoint — #183).
2. Breaking change without shim approved.
3. **`per_page` cap = 100.** Exceeding the cap (or `per_page < 1`, `page < 1`) returns an **explicit 422 validation error** — never silent truncation. The frontend must know the limit explicitly.
4. **No separate bare-list endpoint for reference data.** Masters/locations/services/tags/materials are size-bounded and covered by `per_page=100`; one unified contract beats two response shapes. Pagination UI is out of scope.
5. `getClients()` lookup fix (RecordsContext): `per_page=100`.

## 1. Background & Problem

`GenericService.list()` (`backend/src/services/generic.py:48`) currently returns a **bare Python list** with no pagination:

```python
async def list(
    self, db_session: AsyncSession, order_by=None, **filters
) -> list[ResponseSchemaT]:
```

All generic list HTTP endpoints mirror this and return bare JSON arrays `[...]`:

| Endpoint | File | Response model |
|---|---|---|
| `GET /api/v1/masters` | `backend/src/api/v1/masters.py:27` | `list[MasterResponse]` |
| `GET /api/v1/locations` | `backend/src/api/v1/locations.py:33` | `list[LocationResponse]` |
| `GET /api/v1/tags` | `backend/src/api/v1/tags.py:25` | `list[TagResponse]` |
| `GET /api/v1/materials` | `backend/src/api/v1/materials.py:25` | `list[MaterialResponse]` |
| `GET /api/v1/services` | `backend/src/api/v1/services.py:25` | `list[ServiceResponse]` |
| `GET /api/v1/activities` | `backend/src/api/v1/activities.py:48` | `list[ActivityResponse]` |
| `GET /api/v1/payments` | `backend/src/api/v1/payments.py:26` | `list[PaymentResponse]` |
| `GET /api/v1/visits` | `backend/src/api/v1/visits.py:56` | `list[VisitResponse]` |
| `GET /api/v1/records` | `backend/src/api/v1/records.py:71` | `list[RecordResponse]` |

The only paginated endpoint today is `GET /api/v1/clients` returning `ClientListResponse {items, total, page, per_page}` via the standalone service `list_clients_with_stats()` — a deliberate clean-architecture read-side choice that stays as-is.

### Silent frontend bug

`packages/api-client/src/endpoints.ts:232` — `getClients()`:

```ts
export async function getClients(): Promise<ClientResponse[]> {
  return api('/api/v1/clients', ClientListResponseSchema).then(r => r.items);
}
```

It sends **no pagination params**, so the backend defaults (`page=1, per_page=20`) silently truncate the dropdown/lookup to the first 20 clients. `RecordsContext` and `ActivityDetailsModal` depend on this full client map.

## 2. Goals

1. `GenericService.list()` gains **mandatory pagination** and returns a generic `PaginatedResponse[ItemT]` — `{items, total, page, per_page}`.
2. All generic list endpoints adopt the new response shape in **one atomic PR** (backend + frontend migrate together — this is an intentional breaking change; the only deployed consumer is our own admin frontend).
3. Frontend `packages/api-client` types and methods updated to the new shape; all consumers migrated.
4. The `getClients()` truncation bug is fixed as part of the migration.

## 3. Non-Goals (explicit follow-ups — NOT in scope)

- #183 — `GET /tags/{id}` + `GET /visitors` list endpoint (visitors currently has **no** bare list endpoint — only `GET /visitors/{id}` and `GET /clients/{id}/visitors`).
- #184 — service-level CRUD contract.
- #185 — HTTP CRUD contract + dedup of `test_api_*.py`.
- Paginating **non-generic** list endpoints: `GET /photos`, `GET /photos/web`, `GET /clients/{id}/visitors`, `GET /search/*`. These are standalone services/routes, not driven by `GenericService.list()`, and are out of scope (can be follow-up).
- Any UI redesign, new pagination controls in tables (existing tables render full datasets; behavior stays identical apart from the response shape).

## 4. Design

### 4.1 Backend: PaginatedResponse schema

New generic schema (e.g. `backend/src/schemas/common.py`):

```python
class PaginatedResponse(BaseModel, Generic[ItemT]):
    items: list[ItemT]
    total: int
    page: int
    per_page: int
```

`ClientListResponse` keeps its existing shape (`items, total, page, per_page`) — structurally identical, so the frontend contract for `/clients` is unchanged. Whether `ClientListResponse` is refactored to subclass/reuse the generic is an implementation detail; **no behavioral change to `/clients` is allowed**.

### 4.2 Backend: GenericService.list()

New signature:

```python
async def list(
    self,
    db_session: AsyncSession,
    page: int = 1,
    per_page: int = 20,
    order_by=None,
    **filters,
) -> PaginatedResponse[ResponseSchemaT]:
```

Behavior:

- `page >= 1`, `per_page` bounded **1..100** (hard cap, user decision G1b). Reference-data consumers load all with `per_page=100`; datasets exceeding 100 rows are out of scope (no pagination UI — future follow-up).
- `total` = count of rows matching filters (before limit/offset).
- `items` = rows for the requested page, validated into `ResponseSchemaT` (same validation as today).
- Existing `order_by` and `**filters` semantics unchanged.
- Existing query-count bound (`test_list_activities_query_count.py`) must not regress — pagination uses one COUNT query + one SELECT, no N+1.

### 4.3 Backend: endpoints

Each of the 9 generic list endpoints:

- Accepts query params `page: int = Query(1, ge=1)`, `per_page: int = Query(20, ge=1, le=100)` in addition to existing filter params. Values outside bounds → **422 validation error** (FastAPI standard `RequestValidationError`), never silent clamping/truncation.
- `response_model` changes from `list[XResponse]` to `PaginatedResponse[XResponse]`.
- Delegates to `service.list(db_session, page=page, per_page=per_page, ...)`.

Endpoints that today apply their own filters (e.g. activities date-range, visits filters) keep them unchanged.

### 4.4 Frontend: api-client

- `schemas.ts`: add a generic paginated schema factory or per-entity `XListResponseSchema = z.object({items: z.array(XResponseSchema), total: z.number(), page: z.number(), per_page: z.number()})`; export matching TS types (`PaginatedResponse<T>` type + per-entity list types).
- `endpoints.ts`: list methods change return type from `Promise<XResponse[]>` to `Promise<PaginatedResponse<XResponse>>`. Decide per-consumer (plan-level detail) whether methods keep returning the envelope or an updated signature with `{page, per_page}` params.

### 4.5 Frontend: consumer migration strategy

Reference-data consumers (masters, locations, services, tags, materials, activities) load the **full dataset** for dropdowns/maps. To avoid regressions from the default `per_page=20`:

- These call sites request `per_page=100` (the hard cap, user decision G1b) matching today's "load all" behavior. Rationale: reference data sets are small (tens of rows); no separate bare-list endpoint is introduced (unified contract preferred); pagination UI is out of scope. If a reference dataset ever exceeds 100 rows, that's a future follow-up — out of scope here.
- Payments / visits / records lists: migrate to `.items`; if a table needs full data today, use `per_page=100` likewise.
- `getClients()` bug fix: `getClients()` passes `per_page=100` (dropdown semantics for the RecordsContext client map). Type corrected to reflect the actual `ClientWithStats[]` payload returned via the envelope's `.items`.

Consumers to touch (from codebase survey):

- `frontend/admin/contexts/RecordsContext.tsx` (clients, payments, activities, masters, services, locations maps)
- `frontend/admin/contexts/ScheduleContext.tsx` (activities, masters, services, locations)
- `frontend/admin/hooks/useRecordData.ts`, `useMasters.ts`, `useLocations.ts`, `useServices.ts`, `useActivities.ts`
- Tables: `MastersTable`, `LocationsTable`, `TagsTable`, `ServicesTable`, `MaterialsTable` (direct `useQuery` + bare-array assumption)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`
- Unit tests mocking these functions (~15 files in `frontend/admin/__tests__/`) — mocks updated to return the envelope.

### 4.6 Breaking change policy

All listed endpoints change response shape `[...]` → `{items, total, page, per_page}` in a single PR. Backend and frontend deploy together. No backward-compat shim (no dual-shape endpoints, no `?paginate=false`) — internal API, single consumer.

## 5. Test Strategy

### Backend (pytest)

- Update ~42 existing `test_list*` tests across `test_api_{masters,locations,tags,materials,services,activities,payments,visits,records}.py`, `test_coverage_boost.py`, `test_sort_order.py`, `test_location_short_title.py`, `test_custom_price.py`, `services/test_visit_service.py` to assert the envelope shape (`resp["items"]`, `resp["total"]`, etc.).
- New tests per the existing contract-test style (cf. GenericService.patch contract test, PR #181):
  - `total` reflects filter-matching count independent of page size.
  - `page=2` slice correctness (items disjoint from page 1).
  - `per_page` respected; out-of-range page returns empty `items` with correct `total`.
  - `per_page=101`, `per_page=0`, `page=0` → 422 validation error (explicit, no silent clamping).
  - Query-count bound preserved for activities list.
- `/clients` tests (`test_api_clients.py`, `test_client_stats.py`) must pass unchanged — regression guard for the untouched read-side.

### Frontend (vitest + playwright)

- Update unit-test mocks for all changed api-client functions (envelope shape).
- api-client own tests (`packages/api-client`) updated for new types/schemas.
- E2E (`pnpm test:all`) must pass — dropdowns and tables render same visible data as before (e.g. master/location/service selects populated, payments/activities lists render).

## 6. Acceptance Criteria

1. `GenericService.list()` requires/accepts `page`/`per_page` and returns `PaginatedResponse`.
2. All 9 generic list endpoints return `{items, total, page, per_page}` and accept `page`/`per_page` query params (`per_page ≤ 100`, violations → 422).
3. `GET /clients` response shape and behavior byte-identical to before.
4. Frontend: all list consumers migrated; selects/lists show the same data as pre-migration (no 20-item truncation anywhere, including the clients dropdown bug).
5. Backend `pytest` green; frontend `pnpm test:all` green.
6. No changes to non-generic endpoints (`/photos`, `/search/*`, `/clients/{id}/visitors`, `/visitors/{id}`).

## 7. Resolved Decisions (G1b)

1. ✅ Scope: all 9 bare-list GenericService endpoints (masters, locations, tags, materials, services, activities, payments, visits, records); visitors excluded (#183).
2. ✅ Breaking change, no shim — atomic backend+frontend PR.
3. ✅ `per_page` cap = 100; out-of-bounds params → explicit 422, no silent truncation.
4. ✅ No bare-list endpoint for reference data — unified contract only.
5. ✅ `getClients()` fix via `per_page=100` (no page loop; client count is far below 100).

## 8. Visual Compliance Checks

No UI changes intended — this is a contract migration with identical visible behavior. Verification is via the existing E2E suite plus spot checks:

- [ ] Masters/locations/services/tags/materials admin tables render the same rows as before migration
- [ ] Record/booking form dropdowns (master, location, service selects) are populated
- [ ] Clients dropdown in records UI shows >20 clients when seeded with >20 (bug-fix check)
- [ ] Payments and activities lists render entries
- [ ] ActivityDetailsModal opens with correct client/service data
