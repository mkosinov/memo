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

- Reuses `_list_stmt(**filters)` (same equality-filter semantics as `list()`); `ArchiveService` adds its `status: ArchiveStatus = ArchiveStatus.ACTIVE` filter the same way its `list()` does.
- Applies `order_by` when given; **routers always pass an explicit deterministic order** (§4.4) — `list_all` itself stays order-agnostic like `list()`.
- **Protective limit** enforced here (single shared choke point): the query is executed with `LIMIT BARE_LIST_MAX_ROWS + 1`; if the extra row is present, raise a domain error (see §4.3). Only up to the limit is validated/returned — the limit+1 probe keeps it to one query and never materializes unbounded rows.
- `BARE_LIST_MAX_ROWS = 1000`, sourced from app settings (env-overridable) so tests can set a small value instead of seeding 1001 rows.
- No page/per_page params, no envelope, no COUNT query.

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
- Message is human-readable (Russian, matching admin-facing error idioms) naming the entity and pointing to the paginated endpoint, e.g. `"Справочник мастеров превысил лимит 1000 записей для /all — используйте пагинированный GET /api/v1/masters"`.
- 422 (not 500/413): consistent with the #182 policy that limit violations are explicit validation-style errors, and with the existing `ErrorCode.VALIDATION_ERROR` envelope — no new error infrastructure.

### 4.4 Deterministic default order

`/all` (and the paginated list default, where none exists today) uses a fixed per-entity order with a PK tiebreaker so pagination is stable:

| Entity    | `/all` order                                 | Notes |
|-----------|----------------------------------------------|-------|
| masters   | `sort_order ASC, first_name ASC, id ASC`     | extends existing `[sort_order, first_name]` |
| locations | `sort_order ASC, name ASC, id ASC`           | extends existing `[sort_order, name]` |
| services  | `title ASC, id ASC`                          | new (no order today); services have no sort_order column |
| tags      | `name ASC, id ASC`                           | new |
| materials | `title ASC, id ASC`                          | new |

The paginated list endpoints keep their current order_by behavior (masters/locations unchanged; services/tags/materials gain the same default so server-side pagination is deterministic there too). Default order = `/all` order per entity.

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
  3. Status filter parity for archive entities (active default; `status=all` includes archived). Tags: N/A.
  4. Limit: with `BARE_LIST_MAX_ROWS` overridden to a small value (settings override fixture), seeding limit+1 rows → 422 with the standard error envelope and a human message.
- Route-presence negative test: `GET /api/v1/{clients,records,activities,visits,payments,visitors}/all` → 404 (cheap guard that `/all` stays dictionaries-only).

## 5. Design — api-client & frontend

### 5.1 api-client

- New bare-array schemas + methods, following the `getClients()` precedent:

```ts
// schemas.ts
export const MastersAllResponseSchema = z.array(MasterResponseSchema); // ×5 entities
// endpoints.ts
export async function getAllMasters(params?: { status?: ArchiveStatus }): Promise<MasterResponse[]>
```

- Methods: `getAllMasters`, `getAllLocations`, `getAllServices`, `getAllTags`, `getAllMaterials` → `GET /api/v1/{entity}/all` (+ `?status=` for archive entities; tags none).
- `ListParams` for the 5 paginated list methods gains `sort_by`/`sort_order` (optional), serialized by `listQuery()`.
- api-client unit tests: new methods, status serialization, sort param serialization.

### 5.2 Dictionary table contexts

Each table gets a lightweight per-entity context mirroring `ClientsContext` shape (the G1a-approved "state in context" pattern):

- New: `MastersContext`, `LocationsContext`, `ServicesContext`, `MaterialsContext`, `TagsContext` under `frontend/admin/contexts/`.
- State: `page` (1-based, as Clients), `perPage` (default 10 — current table default), `status` (archive entities), `sortBy`, `sortOrder`, `total`, `items`, `isLoading`, `error` + setters `setPage/setPerPage/setStatus/setSort`.
- queryKey embeds ALL server params: `['masters', page, perPage, status, sortBy, sortOrder]`; queryFn → `getMasters({ page, per_page, status, sort_by, sort_order })`; `placeholderData: keepPreviousData` (Records precedent).
- Providers wired into the existing provider tree per page (same nesting point as Clients/Records contexts).
- CRUD/delete-deps state stays where it is today (tables keep their existing modal/mutation wiring; only list-fetch state moves). No feature merging beyond list state — minimal delta.

### 5.3 Table migration

Per table (Masters/Locations/Services/Materials/Tags):

- Replace local `useQuery(per_page=100)` + `page`/`pageSize` + filter/sort/slice memo chain with `useX()` context consumption.
- Delete: client-side `.filter()` (search — subject to §6 Q1), `.sort()` memo, `.slice()` memo, local `totalPages`.
- Pager: inline JSX driven by envelope `total` (Records/Clients precedent: page-size select `data-testid="page-size-select"` with 10/20/50/100, numbered buttons, prev/next, total label). Page-size change resets to page 1 (existing table behavior, preserved).
- Sort headers call `setSort(key)` instead of local sort state; sort keys map to the §4.5 whitelist.
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

Cache keys stay identical (`['masters']` etc.) so existing invalidation keeps working. Note: after migration the same dictionary is cached under two granularities — paged table cache (`['masters', page, …]`) and full lookup cache (`['masters']` via `/all`) — inherent to the design (uniform server-paged tables + full reference data for dropdowns). `getTags`/`getMaterials` have no lookup consumers; tags/materials appear in dropdowns only via their own tables' CRUD, so no `/all` frontend consumers beyond future comboboxes (#214) — the endpoints are still shipped for contract uniformity and #214 readiness.

Frontend handling of the 422 limit error: react-query error state → existing `ErrorState` component in the consuming view (no new UX; the limit is a safety net, not an expected state).

### 5.6 Frontend tests

- Table unit tests rewritten to the RecordsTable/ClientsPage precedent:
  - Assert query params: `getX({ page, per_page, status, sort_by, sort_order })` instead of `{per_page:100}`.
  - Pagination tests drive `setPage`/`setPerPage` with envelope `total` (replace the current client-slice assertions, e.g. MastersTable.test.tsx:624-648, LocationsTable.test.tsx:396-424).
  - Sort-header click → `setSort` → refetch with sort params.
- New: TagsTable test file does not exist today — add pagination/sort coverage for it as part of its migration (it gets a context like the others).
- Context tests for the 5 new contexts (mirroring ClientsContext test coverage, plan-level).
- api-client tests per §5.1.

## 6. Open questions for G1b

**Q1 — client-side search boxes in the 5 dictionary tables.** All 5 tables have a free-text search input that filters the loaded rows client-side. Under server pagination this silently searches only the current page — the same silent-truncation bug class this issue fixes. Server-side `?q=` is explicitly out of scope (#212). Options:

- **(a) Remove the search inputs** from the 5 tables until #212 lands proper server-side search. Explicit, no silent wrongness; temporary UX regression (finding a row = paging/sorting). **Recommended** — consistent with the "explicit over silent" philosophy of #182/#207.
- (b) Keep the inputs, filtering the loaded page only, with a visible hint when `total > items.length` ("поиск по загруженным N из M"). Keeps utility for small dictionaries today; risks user confusion at >100 rows.
- (c) Pull minimal server `?q=` for dictionaries into THIS issue. Rejected a priori — user put it in #212; listed only for completeness.

**Q2 — deviation notice (not a decision):** G1a wording assumed a "generic router-factory registration flag". No router factory exists (5 hand-written routers). The opt-in is therefore explicit per-router route declaration — same semantics, no factory introduced. Flagged here per the "never silently reinterpret requirements" rule.

## 7. Acceptance criteria

**Backend**

1. `GET /api/v1/{masters,locations,services,tags,materials}/all` → 200 bare JSON array in the §4.4 deterministic order; `status` parity for archive entities; tags without status.
2. Protective limit (default 1000, settings-overridable): exceeded → 422 standard envelope with human-readable message; not exceeded → full array.
3. `/all` absent on all non-dictionary routers (404).
4. Dictionary paginated list endpoints accept whitelisted `sort_by`/`sort_order`; unknown sort key → 422; default order deterministic (id tiebreaker).
5. `/all` contract tests parametrized over the 5 entities + negative route-presence test; full backend suite green.

**Frontend**

6. The 5 tables render via server pagination (pager from envelope `total`); no client-side slice/sort remains; page/perPage/sort changes issue parametrized requests.
7. Lookup maps/dropdowns listed in §5.5 fetch via `/all` (no `per_page=100` remains for masters/locations/services anywhere in frontend; activities untouched).
8. api-client `getAllX` methods + schemas + tests.
9. admin vitest green (incl. rewritten table tests), `tsc` clean, api-client tests green.
10. Domain-rules files for the 5 dictionaries updated with the `/all` contract + default order (living-docs policy).

## 8. Visual Compliance Checks

- [ ] Masters table: pager visible (page-size select + numbered buttons), driven by server `total`; changing page refetches (network request with `page`/`per_page`).
- [ ] Locations, Services, Materials, Tags tables: same pager behavior.
- [ ] Sorting a column header in each table refetches with `sort_by`/`sort_order` and re-renders sorted page.
- [ ] Status tabs (Masters/Locations/Services/Materials) still filter and reset to page 1.
- [ ] Records page: master/service/location dropdowns and name lookup-maps still render all dictionary values (sourced from `/all`).
- [ ] Schedule page: master/service/location filters still populate fully.
- [ ] Record create/edit modal (useRecordData): service/master/location selects fully populated.
- [ ] Search input in dictionary tables: removed or annotated per Q1 decision (verify the chosen option).
- [ ] No console errors; loading and error states render during refetch.

## 9. Non-goals / risks

- **Risk: two cache granularities** for the same dictionary (paged + `/all`). Mutations already invalidate by key prefix; plan verifies invalidation covers both key shapes (`['masters']` and `['masters', page, …]` — react-query prefix matching handles it, plan asserts in tests).
- **Risk: services/tags/materials default order change** on the paginated endpoint (from unspecified DB order to §4.4). User-visible only as a stable, sensible ordering; called out here explicitly.
- **Non-goal:** performance tuning of `/all` (dictionaries are size-bounded by the 1000-row limit; single SELECT, no COUNT).
- **Non-goal:** any change to clients/records/activities/payments/visits/photos/visitors endpoints or their consumers.
