# Dictionaries: Bare `/all` Endpoint + Server-Side Pagination for Dictionary Tables — Design

- Date: 2026-08-17
- GitHub issue: #205 (refs: #182, #191, #207; follow-ups #211, #212, #213, #214)
- Status: pending G1b

### G1a user decisions (binding)

1. **Bare `/all` endpoint for dictionaries ONLY** — `GET /api/v1/{entity}/all` returns a full bare JSON array. NO pagination of any kind on this endpoint. Protective server-side limit (1000 rows → 422 with human-readable detail, error style like #207's dependency errors). Entities: masters, locations, services, tags, materials. Opt-in per entity.
2. **Server-side pagination for dictionary TABLES** — Masters, Locations, Services, Materials, Tags tables migrate to the Clients/Records server-pagination pattern (page/perPage/sort state in context, queryKey embedding server params, pager driven by envelope `total`). Client-side pagination is eliminated entirely: "server pagination works uniformly for ALL entities".
3. **Dictionary dropdowns + lookup maps migrate to `/all`** — RecordsContext, ScheduleContext, useRecordData, useServices/useLocations/useMasters. Activities stays paginated as-is (activities is a growing entity — excluded from `/all`; its lookup problem belongs to #212/#213).
4. **Terminology**: `/all` feeds BOTH lookup-maps (display) AND full dropdowns for dictionaries. Typeahead+search (#212) is only for growing entities (clients/activities).
5. **Policy supersession**: the #182 G1b amendment "No separate bare-list endpoint for reference data" (docs/specs/2026-07-28-list-pagination-migration-design.md lines 11-12, 101, 126) is superseded BY USER DECISION for dictionaries only. The paginated contract stays universal for plain list endpoints; `/all` is an opt-in extra for reference data.

## 1. Background & Problem

Dictionaries (masters, locations, services, tags, materials) are consumed by the frontend as flat lists: one request with `per_page=100` (the hard cap from #182) + client-side sort/slice in tables; dropdowns/lookup-maps use the same `per_page=100`. At 101+ rows the frontend silently receives a truncated list — the #191 class of bug (records had the same mine until server filters/pagination landed).

**User scenario:** admin adds the 101st master (or service) → tables and dropdowns silently stop showing part of the data. No error, no indication.

Current state (verified 2026-08-17):

- Backend: all dictionary list endpoints are paginated envelopes with `per_page` cap 100 (`Query(20, ge=1, le=100)`); `PaginatedResponse` at `backend/src/schemas/common.py:10-16`; pagination core `paginate_orm` at `backend/src/services/generic.py:35-52`.
- Frontend tables fetch `per_page=100` then client-side filter/sort/slice: MastersTable.tsx:51,141,144; LocationsTable.tsx:54,139,142; ServicesTable.tsx:179,280,283; MaterialsTable.tsx:103,202,205; TagsTable.tsx:32,109,112.
- Lookup maps: RecordsContext.tsx:137-159, ScheduleContext.tsx:269-287, useRecordData.ts:33-48, useServices/useLocations/useMasters.ts (:11 each) — all `per_page=100`.

## 2. Scope

### In scope

**Backend**

1. `GenericService.list_all()` — unpaginated list method (details §4.1).
2. `GET /api/v1/{masters,locations,services,tags,materials}/all` — bare-array endpoint with protective limit (§4.2–4.4).
3. `sort_by`/`sort_order` params on the 5 dictionary paginated list endpoints (needed for server-side table sorting, §4.5).
4. Contract tests for `/all` via the existing generic CRUD contract infra from #184/#185 (§4.6).

**api-client**

5. `getAll{Masters,Locations,Services,Tags,Materials}()` methods returning bare arrays (§5.1).

**Frontend**

6. Masters, Locations, Services, Materials, Tags tables → server pagination + server sort, Clients/Records pattern (§5.2–5.4).
7. Dictionary lookup maps / dropdown hooks → `/all` (§5.5).
8. Unit-test migration for the 5 tables + new tests (§5.6).

### Explicitly OUT of scope (separate issues — do not touch)

- Photos server pagination (#211) — photos list endpoint has no pagination at all; untouched.
- Search `?q=` in the list pattern (#212) — including any server-side search for dictionaries (see §6, open question Q1 on the tables' client-side search boxes).
- Display-lookup composite read endpoint (#213).
- Searchable combobox UI (#214).
- Activities `/all` or activities lookup changes (growing entity; #212/#213 territory).
- Visitors table (its list endpoint is already paginated; not in the approved concept).
- Shared pager UI component extraction (existing follow-up, see scratchpad "shared pagination UI").
- per_page cap changes on the paginated list endpoints (stays 100).

## 3. Key codebase facts (verified)

- **No router factory exists.** The 5 dictionary routers are hand-written copies in `backend/src/api/v1/{masters,locations,services,tags,materials}.py`. The G1a concept phrase "flag/config at generic router-factory registration level (`include_bare_list=True`)" therefore maps to: **opt-in = explicit per-router declaration** — exactly these 5 routers get the route; no generic mechanism is introduced. The opt-in semantics (dictionaries only) is preserved; the mechanism adapts to the real codebase shape.
- **Path params are `str`** (`masters.py:67` `master_id: str`, likewise all 5). FastAPI matches routes in registration order, so `GET /all` MUST be declared BEFORE `GET /{id}` — precedent: photos declares `GET /web` before `GET /{photo_id}` (`photos.py:28` vs `:55`); masters declares `PUT /reorder` before `PUT /{master_id}`.
- **No unpaginated generic list method exists.** Only `PhotoService.list` (`photo.py:23-33`) does an ad-hoc unpaginated override.
- **Default order today:** masters `[sort_order, first_name]`; locations `[sort_order, name]`; services/tags/materials pass NO `order_by` (services.py:44, tags.py:34, materials.py:44-46). `sort_order` column exists only on masters and locations.
- **#207 error style:** domain exceptions (`ResolutionError` family, `backend/src/domain/deletion.py:70-79`) → routers raise `HTTPException(status_code=422, detail=str(exc))` → global handler in `main.py:58-79` wraps into the standard envelope `{"detail": {"code": "VALIDATION_ERROR", "message": "<human text>"}}` (`errors.py:14-52`).
- **Contract infra (#184/#185):** `backend/tests/generic_contract.py` — `EntityConfig` registry (`CONTRACT_CONFIG`, :162-372) + `_contract_params()` discovery (:376-386); test classes in `test_generic_api_contract.py` parametrized over it. Adding an opt-in `/all` contract = a new parametrizer filtered to the 5 dictionary service classes + a new test class.
- **Clients/Records pagination pattern (frontend):** state (page/perPage/filters/sortBy/sortOrder + setters) lives in a context (`ClientsContext.tsx:94-98`, `RecordsContext.tsx:70-74`); queryKey embeds server params (`['clients', page, perPage, filters, sortBy, sortOrder]`, ClientsContext.tsx:104); pager is inline JSX driven by envelope `total` (no shared pager component exists); sort header click → `setSort` → new queryKey → refetch.
- **Dictionary tables have NO contexts today** — each fetches locally via `useQuery` inside the component.
- **All 5 dictionary tables have client-side free-text search** (Masters, Locations, Services, Materials, Tags) filtering the loaded rows — see §6 Q1.
- **api-client:** `PaginatedResponse` type + `paginatedSchema()` factory at `packages/api-client/src/schemas.ts:542-566`; list methods `(params?: ListParams) => Promise<PaginatedResponse<T>>` at endpoints.ts:104-106 (masters), :163-165 (locations), :202-204 (services), :516-518 (tags), :639-641 (materials). Bare-array precedent: `getClients()` (endpoints.ts:298-300).
- `getTags`/`getMaterials` are consumed ONLY by their tables (no `useTags`/`useMaterials` hooks exist).

## 4. Design — backend

### 4.1 `GenericService.list_all()`

New method on `GenericService` (inherited by `ArchiveService`):

```python
async def list_all(
    self, db_session: AsyncSession, order_by=None, **filters
) -> list[ResponseSchemaT]
```

Behavior:

- Reuses `_list_stmt(**filters)` (same equality-filter semantics as `list()`); `ArchiveService` adds its `status: ArchiveStatus = ArchiveStatus.ACTIVE` filter the same way its `list()` does. `TagService` extends plain `GenericService` — its `/all` has no status filter anywhere.
- **Eager-loading override (mandatory):** `ServiceService.list()` is fully overridden with `selectinload(Service.tariffs), selectinload(Service.tags)` (`service.py:39-67`) because `ServiceResponse` nests tariffs and tags. `ServiceService` MUST override `list_all()` with the same eager loading — the base `_list_stmt` has no `.options(...)`, and validating `ServiceResponse` from lazily-loaded relationships under async SQLAlchemy crashes (`MissingGreenlet`). The generic contract test for services `/all` (§4.6) guards this.
- Applies `order_by` when given; **routers always pass an explicit deterministic order** (§4.4) — `list_all` itself stays order-agnostic like `list()`.
- **Protective limit** enforced here (single shared choke point): the query is executed with `LIMIT BARE_LIST_MAX_ROWS + 1`; if the extra row is present, raise a domain error (see §4.3). Only up to the limit is validated/returned — the limit+1 probe keeps it to one query and never materializes unbounded rows. Boundary: exactly 1000 rows → 200 OK; the 1001st row → 422.
- `BARE_LIST_MAX_ROWS = 1000` is a **module-level constant** in the service layer (not app settings — no new service→settings coupling for a safety-net value). Since enforcement lives in one shared method, ONE limit contract test (cheapest factory) covers all 5 entities; the test seeds 1001 rows via bulk insert.

### 4.2 `/all` routes

Each of the 5 routers adds, declared BEFORE the `/{id}` detail route:

```python
@router.get("/all", response_model=list[MasterResponse])
async def list_all_masters(
    service: _ServiceDep,
    status: ArchiveStatus = Query(ArchiveStatus.ACTIVE),  # archive entities only
) -> list[MasterResponse]:
    ...
```

- Returns a **bare JSON array** — NOT the `PaginatedResponse` envelope. This is the deliberate second response shape approved at G1a for reference data.
- `status` query param mirrors the paginated list endpoint exactly (masters/locations/services/materials; tags has no status — no param).
- No other query params (no page/per_page/sort/search).
- Non-dictionary routers (clients, records, activities, visits, payments, photos, visitors, user_settings) do NOT get `/all`.

### 4.3 Protective limit error

- New domain error, e.g. `BareListLimitExceededError` (alongside the deletion domain errors or in a small shared domain-errors module — plan-level placement), raised by `list_all` when the limit is exceeded.
- Router converts it exactly like #207's `ResolutionError`: `except BareListLimitExceededError as exc: raise HTTPException(status_code=422, detail=str(exc))` → existing global handler emits `{"detail": {"code": "VALIDATION_ERROR", "message": "<human text>"}}`.
- Message is human-readable **English** (G1b amendment — API error details are a developer-facing contract, consistent English), naming the entity and pointing to the paginated endpoint, e.g. `"Dictionary 'masters' exceeded the /all limit of 1000 rows — use the paginated GET /api/v1/masters endpoint"`.
- 422 (not 500/413): consistent with the #182 policy that limit violations are explicit validation-style errors, and with the existing `ErrorCode.VALIDATION_ERROR` envelope — no new error infrastructure.

### 4.4 Deterministic default order

`/all` (and the paginated list default, where none exists today) uses a fixed per-entity order with a PK tiebreaker so pagination is stable:

| Entity    | `/all` order                                 | Notes |
|-----------|----------------------------------------------|-------|
| masters   | `sort_order ASC, first_name ASC, id ASC`     | extends existing `[sort_order, first_name]` |
| locations | `sort_order ASC, name ASC, id ASC`           | extends existing `[sort_order, name]` |
| services  | `title ASC, id ASC`                          | new (no order today); services have no sort_order column |
| tags      | `tag ASC, id ASC`                            | new; the Tag column is named `tag` (`models/tag.py:68`) |
| materials | `title ASC, id ASC`                          | new |

The paginated list endpoints keep their current order_by behavior where defined (masters/locations unchanged); services/tags/materials gain the same default order so server-side pagination is deterministic there too. Default order = `/all` order per entity. The tags paginated endpoint has no `status` param (tags are non-archive, hard-delete only) and gains none — it only gains the §4.5 sort params.

### 4.5 `sort_by`/`sort_order` on dictionary list endpoints

Required for server-side table sorting (the tables currently sort client-side over the 100 loaded rows):

- The 5 paginated list endpoints accept `sort_by: str | None = Query(None)` and `sort_order: Literal["asc","desc"] = Query("asc")`.
- `sort_by` is validated against a **per-entity whitelist** of sortable keys covering exactly the columns the table headers offer for sorting today (plan enumerates them per entity; e.g. masters: `name` → `(first_name, last_name)`, plus the existing boolean/status columns the header exposes). Composite UI columns map to multiple DB columns.
- Unknown `sort_by` → 422 (explicit validation error, #182 philosophy — never silent fallback).
- `sort_by=None` → the §4.4 default order. User sort appends the `id ASC` tiebreaker.
- Whitelists live in the routers (or a small mapping next to them), mirroring how records/clients constrain sort — plan-level detail.

### 4.6 Contract tests

Via the #184/#185 infra (`backend/tests/generic_contract.py` + `test_generic_api_contract.py`):

- New opt-in parametrizer (e.g. `_all_params()`) filtered to Master/Location/Service/Tag/Material service classes; entities outside the set are never parametrized.
- New test class asserting, per entity:
  1. `GET {prefix}/all` → 200, body is a JSON **array** (not an envelope — negative assertion on `items/total` keys), items validate against `cfg.response_schema`.
  2. Deterministic order: created entities come back in the §4.4 order.
  3. Status filter parity for archive entities (active default; `status=all` includes archived). Tags: N/A (no status anywhere).
  4. Limit: ONE entity (cheapest factory) seeded with `BARE_LIST_MAX_ROWS + 1` rows via bulk insert → 422 with the standard error envelope and a human message; boundary check — exactly `BARE_LIST_MAX_ROWS` rows → 200 (same test or a sibling). One test suffices: enforcement lives in the single shared `list_all` choke point.
- Route-presence negative test: `GET /api/v1/{clients,records,activities,visits,payments,visitors}/all` → 404 (cheap guard that `/all` stays dictionaries-only).

## 5. Design — api-client & frontend

### 5.1 api-client

- Method shape follows the `getClients()` precedent (typed params → `api()` → parsed response). Note: the zod **bare-array response schema** (`z.array(XResponseSchema)`) is genuinely new in api-client — `getClients()` parses the envelope and unwraps `.items`, which does not apply here. Per-index zod error paths for arrays are well-behaved (panel-verified).
- Methods: `getAllMasters`, `getAllLocations`, `getAllServices`, `getAllTags`, `getAllMaterials` → `GET /api/v1/{entity}/all` (+ `?status=` for archive entities; tags none). All 5 ship for api-client↔backend surface symmetry (a few lines each, unit-tested against the real endpoints); tags/materials consumers arrive with #214 — recorded as a deliberate decision, not overlooked dead code.
- `ListParams` for the 5 paginated list methods gains `sort_by`/`sort_order` (optional), serialized by `listQuery()`.
- api-client unit tests: new methods, status serialization, sort param serialization.

### 5.2 Dictionary table contexts

Each table gets a lightweight per-entity context mirroring the `ClientsContext` shape (the G1a-approved "state in context" pattern), implemented via **one shared generic factory + 5 thin per-entity wrappers** (rule-of-three: five hand-written copies would be pure duplication; the factory preserves the exact context shape of the Clients/Records precedent):

- Shared: `createPagedListContext<T>({ queryKeyPrefix, fetcher, defaultSortBy, withStatus })` (working name, plan-level) holding all state/query wiring; per-entity wrappers: `MastersContext`, `LocationsContext`, `ServicesContext`, `MaterialsContext`, `TagsContext` under `frontend/admin/contexts/`.
- State: `page` (1-based, as Clients), `perPage` (default 10 — current table default), `status` (archive entities only — the tags wrapper has none), `sortBy`, `sortOrder`, `total`, `items`, `isLoading`/`isFetching`, `error` + setters `setPage/setPerPage/setStatus/setSort`.
- **`setSort` MUST reset `page` to 1** (deliberate deviation from the Clients/Records precedent, where sorting from page N can land on an out-of-range empty page — TanStack `manualPagination` best practice, panel-verified). Fixing the two existing contexts is a separate follow-up, not this issue.
- queryKey embeds ALL server params: `['masters', page, perPage, status, sortBy, sortOrder]`; queryFn → `getMasters({ page, per_page, status, sort_by, sort_order })`; `placeholderData: keepPreviousData` (Records precedent; caveat: `isLoading` does not refire on page change — loading nuance uses `isFetching`/`isPlaceholderData`, plan-level).
- **Providers are per-page wrappers** (Records precedent: `RecordsProvider` wraps only the pages that consume it) — NOT added to the global `providers.tsx` tree; each dictionary page wraps its own table route.
- CRUD/delete-deps state stays where it is today (tables keep their existing modal/mutation wiring; only list-fetch state moves). No feature merging beyond list state — minimal delta.

### 5.3 Table migration

Per table (Masters/Locations/Services/Materials/Tags):

- Replace local `useQuery(per_page=100)` + `page`/`pageSize` + filter/sort/slice memo chain with `useX()` context consumption.
- Delete: client-side `.sort()` memo, `.slice()` memo, local `totalPages`. **KEEP: the client-side `.filter()` search memo** operating on the loaded page's items (G1b Q1 resolution — untouched until #212).
- Pager: inline JSX driven by envelope `total` (Records/Clients precedent: page-size select `data-testid="page-size-select"` with 10/20/50/100, numbered buttons, prev/next, total label). Page-size change resets to page 1 (existing table behavior, preserved).
- Sort headers call `setSort(key)` instead of local sort state; sort keys map to the §4.5 whitelist; **sort change resets to page 1** (§5.2).
- Status tabs (archive entities) call `setStatus` — query param, refetch, reset page (current behavior preserved).

### 5.4 What does NOT change in tables

- Row rendering, column definitions, modals, CRUD mutations, delete-deps UX (#207), error/loading states structure.
- Page URLs and provider nesting for other features.

### 5.5 Lookup maps & dropdowns → `/all`

| Consumer | Today | After |
|---|---|---|
| RecordsContext.tsx:145,151,157 (masters/services/locations) | `getX({per_page:100})`, keys `['masters']`… | `getAllX()`, same keys |
| ScheduleContext.tsx:275,280,285 (masters/services/locations) | `per_page:100`, staleTime 5min | `getAllX()`, same keys/staleTime |
| useRecordData.ts:33,38,43 (services/masters/locations) | `per_page:100` | `getAllX()` |
| useServices.ts / useLocations.ts / useMasters.ts :11 | `getX({per_page:100}).then(r=>r.items)` + domain `select` | `getAllX()` + same `select` |
| RecordsContext/ScheduleContext **activities** | `per_page:100` | **UNCHANGED** (out of scope) |
| useRecordData payments | keyed `['payments', recordId]` | **UNCHANGED** |
| Menubar.tsx:464 | via `useMasters()` | migrated automatically with the hook |

**Cache keys.** Lookup keys stay identical (`['masters']` etc.) — existing invalidation keeps working. The table keys are NEW shapes (`['masters', page, perPage, status, sortBy, sortOrder]`). Mutations invalidate by array prefix — `invalidateQueries({queryKey: ['masters']})` matches BOTH shapes under react-query prefix matching; the plan adds an explicit invalidation test proving CRUD/archive/restore refreshes both the table cache and the `/all` lookup cache. `staleTime` per consumer stays as today (`Infinity` in RecordsContext, 5 min in ScheduleContext/hooks). The two-granularity caching (paged table + full lookup) is inherent to the design: uniform server-paged tables + full reference data for dropdowns. `getTags`/`getMaterials` have no lookup consumers; the `getAllTags`/`getAllMaterials` api-client methods still ship for surface symmetry (§5.1), consumed by #214 comboboxes.

Frontend handling of the 422 limit error: react-query error state → existing `ErrorState` component in the consuming view (no new UX; the limit is a safety net, not an expected state).

### 5.6 Frontend tests

- Table unit tests rewritten to the RecordsTable/ClientsPage precedent:
  - Assert query params: `getX({ page, per_page, status, sort_by, sort_order })` instead of `{per_page:100}`.
  - Pagination tests drive `setPage`/`setPerPage` with envelope `total` (replace the current client-slice assertions, e.g. MastersTable.test.tsx:624-648, LocationsTable.test.tsx:396-424).
  - Sort-header click → `setSort` → refetch with sort params.
- TagsTable: `__tests__/tags/TagsTable.test.tsx` (88 lines) EXISTS but is shallow (mocks `useQuery`, covers error state + a status-column regression) — extend it with pagination/sort coverage as part of its migration (no per_page=100 spy assertion to remove, unlike the other 4 tables).
- Shared factory tests: one thorough suite for `createPagedListContext` + smoke tests per wrapper (mirrors ClientsContext coverage at the shape level).
- Scope visibility for planning: the 4 existing table test files total ~2800 lines (MastersTable.test.tsx alone 694) — the query-param and client-slice assertion rewrites are the bulk of the frontend effort.
- api-client tests per §5.1.

## 6. G1b resolutions (BINDING, decided 2026-08-17)

**Q1 — client-side search boxes in the 5 dictionary tables → RESOLVED: left UNTOUCHED in #205.** The search inputs stay exactly as they are — client-side filtering over the currently loaded page. This is an **accepted temporary degradation**: under server pagination the box searches only the loaded page (worst case: silent miss at >perPage rows — the known trade-off, consciously accepted by the user). No hint UI, no removal. Server `?q=` for tables of ALL entities (dictionaries included) arrives with #212. Consequence for §5.3: the client-side `.filter()` search memo is KEPT (operating on the page's items); only the `.sort()`/`.slice()` memos are removed.

**Q2 — deviation CONFIRMED as approved approach:** explicit per-router `/all` declaration in the 5 dictionary routers (no router factory exists or is introduced).

**Search mechanism matrix (binding terminology, fixed once and for all):**

| Surface | Mechanism | Ships in |
|---|---|---|
| Table search input (any entity, incl. dictionaries) | server `?q=` | #212 |
| Form dropdowns for dictionaries | client-side filter over `/all` (combobox) | #214 (data source `/all` ships in #205) |
| Form dropdowns for growing entities (clients/activities) | server `?q=` typeahead | #212 |

Note: #212's issue body was updated to include dictionary tables in its scope.

## 7. Acceptance criteria

**Backend**

1. `GET /api/v1/{masters,locations,services,tags,materials}/all` → 200 bare JSON array in the §4.4 deterministic order; `status` parity for archive entities; tags without status.
2. Protective limit (module constant `BARE_LIST_MAX_ROWS = 1000`): 1001st row → 422 standard envelope with human-readable message; exactly 1000 rows → 200 full array.
3. `/all` absent on all non-dictionary routers (404).
4. Dictionary paginated list endpoints accept whitelisted `sort_by`/`sort_order`; unknown sort key → 422; default order deterministic (id tiebreaker).
5. `/all` contract tests parametrized over the 5 entities + negative route-presence test; full backend suite green.

**Frontend**

6. The 5 tables render via server pagination (pager from envelope `total`); no client-side slice/sort remains; page/perPage/sort changes issue parametrized requests; sort change and page-size change reset to page 1.
7. Lookup maps/dropdowns listed in §5.5 fetch via `/all` (no `per_page=100` remains for masters/locations/services anywhere in frontend; activities untouched).
8. api-client `getAllX` methods + schemas + tests.
9. admin vitest green (incl. rewritten table tests), `tsc` clean, api-client tests green.
10. Domain-rules files for the 5 dictionaries updated with the `/all` contract + default order (living-docs policy).

## 8. Visual Compliance Checks

- [ ] Masters table: pager visible (page-size select + numbered buttons), driven by server `total`; changing page refetches (network request with `page`/`per_page`).
- [ ] Locations, Services, Materials, Tags tables: same pager behavior.
- [ ] Sorting a column header in each table refetches with `sort_by`/`sort_order` and re-renders sorted page; sorting while on page >1 returns to page 1 (no empty out-of-range page).
- [ ] Status tabs (Masters/Locations/Services/Materials) still filter and reset to page 1.
- [ ] Records page: master/service/location dropdowns and name lookup-maps still render all dictionary values (sourced from `/all`).
- [ ] Schedule page: master/service/location filters still populate fully.
- [ ] Record create/edit modal (useRecordData): service/master/location selects fully populated.
- [ ] Search input in dictionary tables: present and unchanged, filters the loaded page's rows (G1b Q1 resolution).
- [ ] No console errors; loading and error states render during refetch.

## 9. Non-goals / risks

- **Risk: two cache granularities** for the same dictionary (paged + `/all`) — mitigated by react-query array-prefix invalidation (`['masters']` matches both shapes); plan asserts in tests (§5.5).
- **Risk: services/tags/materials default order change** on the paginated endpoint (from unspecified DB order to §4.4). User-visible only as a stable, sensible ordering; called out here explicitly.
- **Risk: services `/all` payload weight** — `ServiceResponse` nests tariffs+tags; at the 1000-row limit this is heavier than the other 4 dictionaries. Accepted: the shape stays uniform (a "lite" shape would introduce a third contract), realistic dictionaries are tens of rows, and the limit bounds the worst case.
- **Risk: bare top-level JSON array** — flagged by OWASP AJAX guidance / DAST scanners; moot for an internal SameSite-protected admin API, and the shape is a binding G1a decision. Recorded consequence: adding metadata to `/all` later would be a breaking change for the client.
- **No feature flag / staged rollout** — ships in one change; rollback = git revert (project convention per #182 G1b: breaking change without shim).
- **Non-goal:** performance tuning of `/all` (dictionaries are size-bounded by the 1000-row limit; single SELECT, no COUNT).
- **Non-goal:** fixing the missing sort→page-1 reset in the existing Clients/Records contexts (follow-up candidate; new dictionary contexts get it right from the start).
- **Non-goal:** any change to clients/records/activities/payments/visits/photos/visitors endpoints or their consumers.
