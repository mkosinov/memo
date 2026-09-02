# GH #213 — Display-lookup: composite read endpoint for records view

**Date:** 2026-09-02
**Status:** Design (G1a approved 2026-09-02)
**Refs:** issue #213; #205 (dicts /all), #212 (search ?q=), #186 (payments/totals precedent), #139 (DataTable refactor), #211 (photos — activities.md label pin)

---

## 1. Context & Problem

The records table renders related-entity names (client, activity date, service, master, location, paid) via **lookup maps** built in `RecordsContext` — full in-memory fetches of other entities:

| Map | Fetch (today) | Defect |
|---|---|---|
| `activities` | `getActivities({date_from, date_to, per_page: 100})` | silent 100-cap + date-window-bound: record's activity outside the window → `'—'` in date/service/master/location cells |
| `clients` | `getClients()` → `/clients?per_page=100` (endpoints.ts:335-337) | silent 100-cap: client #101 → empty name; **archived clients absent** (active-paged list) → `'—'` |
| `payments` | `getPaymentTotals(recordIds)` | extra round-trip per page |
| `masters` / `services` / `locations` | `getAll*()` (dict /all) | unbounded dictionaries pulled for display |

7 requests per records page; display correctness depends on fetch caps, not on the data itself.

**Fix (issue #213):** a dedicated composite read endpoint for the «records table» use case — a records page enriched with denormalized display fields from joins. Display lookups die; selection lookups (filter dropdowns) stay untouched. Precedents: `list_clients_with_stats()` (client + aggregates), `GET /payments/totals` (read-side aggregate), photos `client_name` (denormalized display field).

## 2. Locked decisions (G1a, user-approved — binding)

1. **Architecture B (textbook split):** NEW `GET /api/v1/records/view` returning `PaginatedResponse[RecordViewResponse]`. Lean `GET /records` stays the canonical core for modals (ClientQuickCard, ActivityDetailsModal know their context entity) and future consumers. Project phase = pre-production MVP → clean extendable contracts, no compatibility shims.
2. **DRY-glue (zero contract drift):** ONE `RecordListParams` class used by both endpoints; ONE sort whitelist (`RecordService._sort_columns`); `RecordService.list_view()` shares a private query-builder with `list()` — view = same query + extra select columns. Only URL + response model + thin mapping differ.
3. **`RecordViewResponse`** = inherits all `RecordResponse` fields + nullable display fields: `client_name`, `activity_start`, `service_title`, `master_name`, `location_name`, `paid`.
4. **`paid` in the view** — scalar `SUM` subquery over payments (semantics of `services/payment.py::get_payment_totals`: `SUM(Payment.amount)` grouped per record; payments are hard-deleted, no `is_active`). Kills the `getPaymentTotals` round-trip in RecordsContext. `GET /payments/totals` endpoint stays.
5. **Archived entities resolve names** — NO `is_active` filters on the display resolution (photos `client_name` precedent, photos.md:17). Behavior change vs today's capped/active-biased maps: accepted and desired (US-3).
6. **Frontend:** RecordsContext records query → `getRecordsView()`; ALL 6 display lookup maps + the `getPaymentTotals` query DELETED from RecordsContext. `recordsColumns.tsx` and the detail panel read row display fields instead of Map lookups. Filter dropdowns untouched (dicts /all, selection purpose; combobox = #214). api-client: `RecordViewResponseSchema` (zod extend of `RecordResponseSchema`) + `getRecordsView()`.
7. **Out of scope:** #214 (searchable combobox), modal per_page=100 caps (ClientQuickCard own queries), write paths, records sort contract changes, migrating modals to the view endpoint.

> Note: the field list in decision 3 is the G1a baseline. §3 R1 adds `master_color` and `is_private` (forced by shipped UI — see R1). **§4 is the single normative field table**; all other sections reference it.

## 3. Design refinements required by the locked decisions

G1a explore (ses_f9e6948e2 + ses_f9e654a6a, 2026-09-02) pinned the exact consumer graph. Deleting ALL maps from RecordsContext has three forced consequences + two additions, all within the locked scope:

| # | Refinement | Why it is forced / justified |
|---|---|---|
| R1 | `master_color` + `is_private` added as display fields | master cell renders a color dot `backgroundColor: master?.color || '#999'` (recordsColumns.tsx:140) and the service column + detail panel render `<DiamondIcon/>` for private activities (recordsColumns.tsx:123, RecordsTable.tsx:133). Without these fields neither can render from row data. `master_color` nullable; `is_private` bool from the already-INNER-joined Activity (direct column, no subquery). |
| R2 | BookingFilters re-homes dict data to DIRECT queries on the canonical keys with RAW `getAll*` fetchers | BookingFilters.tsx:47 consumes `{locations, services, masters}` from `useRecords()` — selection dropdowns, NOT display. Maps die → the filter bar must own its data. Rationale for raw-shape (not the shared hooks): RecordsContext fed BookingFilters RAW `getAll*` responses, so `!archived` filter (L49-51) and `m.first_name` labels (L173) work verbatim; the shared hooks' transformers strip `archived` and rename `first_name`→`shortName` (transformers.ts:43-52; domain types lack both) — using them would break the dropdowns and force cross-package type changes. Direct `useQuery(['locations'/'services'/'masters'], getAll*)` keeps the exact fetcher + shape + canonical keys (react-query dedupe intact), `staleTime: 5 min` per repo dict convention (was `Infinity` in RecordsContext — disclosed in §10). No transformer/domain-type changes in this feature. |
| R3 | ClientQuickCard + ActivityDetailsModal re-homed off `useRecords()` | ClientQuickCard.tsx:35 destructures `{clients, services, locations}` (header name/phone L55/L84-100; its records list display L131/L139). ActivityDetailsModal.tsx:29 `{clients}` (L80 fallback, L201 direct) — the ONLY non-records-page consumer; schedule/page.tsx:33-37 wraps RecordsProvider solely to feed it. Re-homing lets the schedule page DROP the RecordsProvider wrapper (kills 7 spurious queries on the schedule page). **User-confirmed at G1b (Amendment 3)** — plan includes schedule-page verification (its e2e/unit coverage + visual checks for filter/modal flows on /schedule). |
| R4 | Payment mutations invalidate `['records']` | Today `addPayment`/`deletePayment`/`patchPayment`/`deletePaymentDeferred` (useRecordMutations.ts:202-411, deferred commit at L406) only do optimistic writes + `['record', id]` invalidation. With `paid` moving into the view row, the list must refresh → add `invalidateQueries({queryKey: ['records']})` to all four payment paths. Required by US-4. |
| R5 | Records query key unchanged | `['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder]` (RecordsContext.tsx:100) — the `'records'` prefix is the app-wide freshness contract (12 invalidation call sites). The view fetcher swaps in under the SAME key. |
| R6 | Repository read-family redesign (§5.1) | G1b Amendment 1 (user-mandated): `list_custom` becomes the row-tuple core (`tuple[list[Row], int]`); NEW `list_entity` takes the old entity-only role (TypeVar-enforced); 2 prod consumers + 3 test sites migrate. Replaces panel-B1's `list_custom_rows()` sibling. |
| R7 | Photos migration onto the core (§5.2) | G1b Amendment 2 (user-mandated): `PhotoService.list` drops its hand-rolled count+slice for the new `list_custom` core — its count-order deviation fixed by construction. `list_clients_with_stats` deliberately stays an exception (#217). |

## 4. API contract — `GET /api/v1/records/view`

**Purpose:** one request returning everything the records TABLE renders.

**Query params:** identical to `GET /api/v1/records` — the same `RecordListParams` (schemas/record.py:123-145): `page`, `per_page` (1–100), `client_id`, `activity_id`, `date_from`, `date_to`, `location_id`, `service_id`, `master_id`, `status`, `q` (2–100 chars, else 422), `sort_by`, `sort_order`. Same validation → same 422 VALIDATION_ERROR matrix. No new params, no param drift possible (single class, single injection idiom `Annotated[RecordListParams, Query()]`).

**Response:** `PaginatedResponse[RecordViewResponse]` — `{items, total, page, per_page}` (schemas/common.py:15-21).

**`RecordViewResponse`** — inherits `RecordResponse` (id, activity_id, client_id, status, seats, anonym_visits, comment, custom_price, created_at, updated_at, visits[]) and adds:

| Field | Type | Source | Null when |
|---|---|---|---|
| `client_name` | `str \| None` | `Client.name` via `Record.client_id` | anonymous record (client_id null) |
| `activity_start` | `str \| None` (ISO datetime — serialized EXACTLY as `ActivityResponse.start`; `parseActivityStart`/`formatDateRu` do `slice(0,10)` + `new Date(...)` on the string, so byte-parity is load-bearing) | `Activity.start` (already INNER-joined) | never in practice (FK enforced); nullable for safety |
| `is_private` | `bool` | `Activity.is_private` (direct column — already INNER-joined, no subquery) | never (INNER join) |
| `service_title` | `str \| None` | `Service.title` via `Activity.service_id` | service deleted/missing |
| `master_name` | `str \| None` | `Master.last_name \|\| ' ' \|\| Master.first_name` — **«Фамилия Имя»**, byte-identical to `displayMasterName` (lib/utils.ts:4-6) | activity has no master |
| `location_name` | `str \| None` | `Location.name` via `Activity.location_id` | activity has no location |
| `master_color` | `str \| None` | `Master.color` | no master |
| `paid` | `int` (NOT nullable, default 0) | `COALESCE(SUM(Payment.amount), 0)` per record — `get_payment_totals` semantics (services/payment.py:53-69), `dict[str, int]` type parity | never — 0 when no payments |

**Archived resolution:** display subqueries carry NO `is_active` filter — archived clients/masters/services/locations resolve their names (US-3). Deleted entities (FK-dangling) → `null` → client renders `'—'` / gray dot `#999`.

**Route registration:** `GET /view` MUST be declared BEFORE `GET /{record_id}` in records.py (FastAPI matches in declaration order — `/view` would otherwise be captured by the id path param and 422).

## 5. Backend design

**`RecordService`** (services/record.py):

- Extract the query assembly from `list()` (L62-113) into a private builder, e.g. `_build_list_stmt(params)`: Activity INNER join, all business filters, `q` predicates (Client/Service LEFT OUTER joins only when `q` present), `selectinload(Record.visits)`.
- `list()` = `_build_list_stmt` → `BaseRepository.list_entity` (repo-owned count/order/limit/offset, repositories/generic.py — migrated off the old `list_custom` role per §5.1) → `_map_record` → `PaginatedResponse[RecordResponse]`. Behavior byte-identical to today.
- `list_view()` = same stmt, `stmt.add_columns(...)` with the **§4 display fields as 8 LABELED select columns** (`activity_start` → `Activity.start` direct; `client_name`, `service_title`, `master_name`, `location_name`, `master_color` → **correlated scalar subqueries**, the `_sort_columns` pattern record.py:119-148 — no join-topology changes, orthogonal to the `q` outerjoins; `paid` → `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE payments.record_id = records.id`) → `BaseRepository.list_custom` (row-tuple core, §5.1). Page-sized sets (≤100 rows) keep the subqueries cheap in SQLite.
  - Sort: SAME `_sort_columns` whitelist — sorting order is shared, guaranteeing US-6 parity with `/records`.
  - Row mapping: **named-label row unpacking** (`row.client_name` etc. via `label()`d columns); base fields via `_map_record` on the ORM entity in `row[0]`; `visits` come from that entity (`selectinload` populates it regardless of extra select columns). Service-owned, photos-precedent style (services/photo.py:102-105).

### 5.1 Repository layer redesign (G1b Amendment 1 — user-mandated; replaces the panel-B1 `list_custom_rows()` mechanism)

`BaseRepository` (repositories/generic.py) gets a three-method read family:

| Method | Signature | Role |
|---|---|---|
| `list` | UNCHANGED | generic path: table + equality filters → `tuple[list[Model], int]` |
| `list_custom` | semantics CHANGED — accepts ANY service-built `stmt`, returns `tuple[list[Row], int]` | **THE CORE**: declared row shape, `result.all()`, NO projection; count + ORDER + LIMIT/OFFSET mechanics as today (count on the loader-stripped unordered subquery). Door for `/records/view` (multi-column select) and photos |
| `list_entity` | NEW — `TypeVar ModelT`, accepts ONLY `Select[tuple[ModelT]]`, returns `tuple[list[ModelT], int]` | takes over the OLD `list_custom` role (entity-only, scalars semantics); thin wrapper: `rows, total = await self.list_custom(...); return [row[0] for row in rows], total` |

- **TypeVar = mypy honesty:** a multi-column select must NOT typecheck against `list_entity` — the type system routes devs to `list_custom`. No `paginate`-style names (rejected).
- **Consumer migration (semantics change):** the 2 prod consumers of old-`list_custom` — `RecordService.list`, `ActivityService.list` — migrate to `list_entity`; plus the 3 call sites in `tests/test_repository_list.py`. No behavior change (same stmts, same results).
- **Normative doc:** `docs/domain-rules/records.md:201` (describes `list_custom` scalars return) — rewritten for the new family. Historical specs stay untouched.
- **Repo unit tests:** `list_custom` returns ALL declared columns (multi-column case); `list_entity` projects `row[0]` entities.

### 5.2 Photos migration onto the core (G1b Amendment 2 — in scope, new plan task)

`PhotoService.list` re-homes its hand-rolled count+slice (services/photo.py:~93-99) onto the new `list_custom` core:
- Its **count-order deviation is FIXED by construction** — the core counts the unordered stmt (today photos counts AFTER ordering; correctness-affecting only in edge semantics, now aligned).
- Service keeps stmt construction (ilike / tag-EXISTS / service-OR predicates stay service-owned) + Row→`PhotoResponse` mapping (the multi-column `client_name` select flows through the core unchanged).
- Update the accepted-exception docstring (photo.py:60-67) and photos domain-rules exception wording.
- **NOT** `list_clients_with_stats` — its separate `count_query` deliberately excludes stat subqueries (real reason, stays an exception; cf. #217).

**Router** (api/v1/records.py): new endpoint declared BEFORE `GET /{record_id}` (route order, §4); `response_model=PaginatedResponse[RecordViewResponse]`; thin — `service.list_view(params)`.

**What does NOT change:** `GET /records` contract, all write paths, sort whitelist contents, `q` semantics, date-range semantics, pagination mechanics.

## 6. Frontend design (frontend/admin)

### 6.1 RecordsContext — becomes a pure view-list context

- Records query → `getRecordsView(...)`; **key unchanged** `['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder]` with `placeholderData: keepPreviousData`; page-clamp effect (L149-154) unchanged.
- Context value: `records` becomes `RecordView[]`; filters/sort/pagination state + setters + `refetch` unchanged.
- DELETED: all 6 map queries + map construction (RecordsContext.tsx:169-245), map-loading flags, `payments` map. No new fields replace them.

### 6.2 recordsColumns.tsx — row-field rendering

`RecordColumnLookup` seam (L47-55) deleted; the columns factory takes no lookup argument (pure `(t) => ColumnDef<RecordView>[]`). Cells:

| Column | Render (from row) | Fallback |
|---|---|---|
| date | `formatDateRu`/`formatTime` over `parseActivityStart(row.activity_start)` | `'—'` when null |
| client | `row.client_name` (button opening ClientQuickCard by `row.client_id` — unchanged) | `'—'` |
| service | `row.service_title` + `<DiamondIcon/>` when `row.is_private` (rendering unchanged) | `'—'` |
| master | color dot `backgroundColor: row.master_color ?? '#999'}` + `title` tooltip `row.master_name` | gray `#999` dot, no tooltip |
| location | `row.location_name` | `'—'` |
| payment | `row.paid` vs visits-total: `✓ Оплачено` (--success) / `Частично (N₽)` (--warning) / `Не оплачено` (--danger) — logic unchanged, source swaps `payments.get(id) ?? 0` → `row.paid` | — |

**Activity label pin (activities.md:48-56):** the records feature does NOT compose full activity label strings — date/service/master/location are separate columns (as today). No third label format gets invented anywhere in this feature; wherever a full label is needed, `formatActivityLabel` remains the only sanctioned composer. Segment-omission semantics live only inside that formatter.

### 6.3 RecordsTable detail panel

`selectedClient`/`selectedActivity` map lookups (L84-85, L133, L164, L177) → read the selected `RecordView` row: client name `row.client_name ?? '—'`; service `row.service_title` (+ `<DiamondIcon/>` when `row.is_private`, RecordsTable.tsx:133); master `row.master_name` (server composes «Фамилия Имя»); location `row.location_name`. Payments block stays on `useRecordData` (`['payments', recordId]`).

**Delete-dialog label (distinct call site, NOT the detail panel):** RecordsTable.tsx:240 `formatRecordLabel(activities.get(deleteTarget.record.activity_id)?.start)` → `formatRecordLabel(deleteTarget.record.activity_start)` — crashes today's map access once `activities` dies if missed.

### 6.4 BookingFilters — selection data re-homed (R2)

`useRecords()` → three direct `useQuery` calls on the CANONICAL keys — `['locations']` / `['services']` / `['masters']` — with the RAW fetchers `getAllLocations()` / `getAllServices()` / `getAllMasters()` (identical fetchers + shapes to what RecordsContext fed the dropdowns today; react-query dedupe with other canonical-key consumers intact). `staleTime: 5 min`. Dropdown behavior byte-identical: active-only via the existing client-side `!archived` filter (raw responses carry `archived`), labels `l.name` / `s.title` / `m.first_name` verbatim. The shared hooks `useLocations()`/`useServices()`/`useMasters()` are NOT used here (their transforms drop `archived` and rename `first_name`→`shortName`) and are NOT modified.

### 6.5 ClientQuickCard — context entity by id (R3)

- Header: replace `clients.get(clientId)` with its own query `['client', clientId]` → `getClientById(clientId)` (§7 — method is ADDED, none exists today). Name + phone; fetched once per card open, react-query-cached.
- Its records-list display: `services`/`locations` maps → shared hooks `useServices()` / `useLocations()` — the transformed domain objects carry `title`/`name` (primary labels; unlike §6.4 no `archived`/`first_name` needed here). Same canonical keys — no extra requests beyond cached page state. Guard: if a needed field turns out missing from the transform, fall back to the §6.4 pattern (direct raw query on the canonical key) — do NOT modify the transformer.
- Own queries (records/activities/payments-totals for the client) unchanged (out of scope: modal caps).

### 6.6 ActivityDetailsModal + schedule page (R3)

- Modal stops using `useRecords()`: client resolution (L80 fallback, L201) → own per-id query `['client', record.client_id]` (enabled when client_id set), merging with the existing `useClients()` paged map preference order: paged map first, per-id query fallback (same precedence as today).
- schedule/page.tsx: REMOVE the RecordsProvider wrapper (its only records-context consumer was this modal) — the schedule page stops firing all 7 records-context queries.

### 6.7 Payment mutations (R4)

`addPayment`, `deletePayment`, `patchPayment`, `deletePaymentDeferred` (commit path) in useRecordMutations.ts: add `queryClient.invalidateQueries({ queryKey: ['records'] })` alongside the existing `['record', id]` invalidation → the view row (`paid`, status) refreshes (US-4).

## 7. api-client (packages/api-client)

- `RecordViewResponseSchema` = `RecordResponseSchema.extend({...})` with the **§4 display fields** (single source: `client_name`, `activity_start`, `service_title`, `master_name`, `location_name`, `master_color` — `.nullable()`; `is_private: z.boolean()`; `paid: z.number().int()`). `activity_start` as ISO string, byte-compatible with `ActivityResponseSchema.start` (§4 parity pin).
- `RecordView` exported type; `getRecordsView(params)` → `GET /api/v1/records/view` → `paginatedSchema(RecordViewResponseSchema)` — param typing mirrors `getRecords` (endpoints.ts:300-331).
- `getRecords` and all existing methods unchanged.
- **ADD `getClientById(id)`** → `GET /api/v1/clients/{id}` → canonical client schema (backend route exists: clients.py:73-89; api-client method verified MISSING — endpoints.ts has only getClients/getClientsWithStats/getClientsPaged/getClientByPhone). Consumers: ClientQuickCard (§6.5), ActivityDetailsModal (§6.6).

## 8. User Scenarios (each → E2E test)

- **US-1 beyond-cap client:** seed ≥101 clients, a record for client #101 → table shows that client's name (today: empty).
- **US-2 one display request:** records page display path issues exactly ONE API call — `GET /records/view`; ZERO calls to `/clients?per_page=100`, `/activities?...&per_page=100`, `/payments/totals` from the records page. The three dict `/all` selection queries (owned by BookingFilters, canonical keys, 5-min cache) are the only other records-page requests. Filter dropdowns still populate and filter.
- **US-3 archived entities:** record referencing an ARCHIVED client and an ARCHIVED master → table shows real name (not `'—'`), master dot uses the master's own color; record whose activity has a deleted service → `'—'`.
- **US-4 paid freshness:** payment column filled from the view row; add a payment in the detail panel → row payment badge updates without manual reload (R4 invalidation).
- **US-5 filter parity:** every current filter (client/activity/date range/location/service/master/status) + `?q=` search produce identical results on `/records/view` as on `/records` (same fixture, same totals).
- **US-6 sort parity:** all sort_by columns (`date, client, service, master, location, guests, status, total, payment`) × asc/desc — same row order as `GET /records` (API-level assert) and table behaves identically (UI).

## 9. Testing strategy

- **Backend (pytest):** `/records/view` — params parity (422 matrix shared with `/records`), display-field correctness (client_name resolution incl. archived; `master_name` = «Фамилия Имя»; `is_private` passthrough; nulls for anonymous/dangling), `paid` sums (none/partial/full), pagination envelope, route-order (GET /view is not captured by /{record_id}), sort parity loop (per sort_by: id sequence == /records sequence on shared fixture), `q` + filters on view, `activity_start` serialization byte-parity with `ActivityResponse.start`.
- **Repo family (pytest):** `list_custom` returns ALL declared columns (multi-column select case); `list_entity` projects `row[0]` entities; existing `tests/test_repository_list.py` sites migrated (3); `list`/`list_entity` consumers unchanged behavior (RecordService.list, ActivityService.list).
- **Photos (pytest):** PhotoService.list via the core — same fixtures pass (items + totals), count now computed on unordered stmt.
- **api-client:** schema parse (RecordViewResponseSchema), `getRecordsView` URL/params.
- **Frontend unit (vitest):** RecordsContext (view query, no maps), recordsColumns (row rendering + fallbacks + dot + payment badges), BookingFilters (hook-fed options), ClientQuickCard / ActivityDetailsModal re-home, payment-mutation invalidation (R4). Existing tests referencing maps → rewritten.
- **E2E (Playwright):** US-1…US-6 per §8.

## 10. Behavioral delta

| Area | Before | After |
|---|---|---|
| Records page display data | 7 queries (records + 6 maps) | 1 query `/records/view` (+3 selection dict queries owned by BookingFilters, cached 5 min, shared keys — cold load total 4; display path 1) |
| Client #101+ / archived client | empty name / `'—'` | real name |
| Activity outside date window/100-cap | `'—'` in date/service/master/location cells | real values |
| Master dot for archived master | in /all map → color (unchanged); dangling → `#999` | same visuals, data from row |
| Paid column | `getPaymentTotals` round-trip | `row.paid`; payment mutations invalidate the list (small extra refetch on pay ops) |
| RecordsContext API | records + 6 maps + loading flags | view list + filters/sort/pagination only |
| Schedule page | wraps RecordsProvider → fires 7 records-context queries | provider removed, 0 |
| BookingFilters | fed by RecordsContext maps (`staleTime: Infinity`) | own direct canonical-key queries, raw `getAll*` shape, `staleTime: 5 min` (refetch window after TTL — selection dropdowns only) |
| ClientQuickCard header | context clients map (100-capped) | per-id GET (always correct) |
| Schedule page | wraps RecordsProvider → fires 7 records-context queries | provider removed, 0; filter/modal flows verified on /schedule (e2e + visual) |
| Repo read family | `list_custom` entity-only (`scalars().all()`); photos hand-rolls count+slice | `list_custom` = row-tuple core; `list_entity` = entity role (TypeVar); photos on the core (count-order deviation fixed) |
| `GET /records` | canonical list | unchanged (modals + future consumers) |

## 11. Visual Compliance Checks

- [ ] Records table shows all columns with names/dates/prices (no `'—'` regressions on healthy data)
- [ ] Private activity shows the diamond indicator in the service column (table + detail panel)
- [ ] Client name renders as a button; click opens ClientQuickCard with correct name + phone
- [ ] Master cell shows color dot + name tooltip; archived master shows own color
- [ ] Payment badges render: `✓ Оплачено` / `Частично (N₽)` / `Не оплачено` with correct colors
- [ ] Filter dropdowns (location/service/master) populate, active-only, and filter the table
- [ ] `?q=` search box works on the records page
- [ ] Sorting by each column header works, indicators unchanged
- [ ] Detail panel shows client/service/master/location from row fields
- [ ] Pagination pager + page-clamp behavior unchanged
- [ ] Schedule page: ActivityDetailsModal client tab still resolves clients

## 12. Acceptance criteria

- [ ] `GET /api/v1/records/view` implemented per §4; declared before `/{record_id}`
- [ ] `RecordListParams` single class, no duplication; `_sort_columns` shared (US-5/US-6 parity)
- [ ] `list_view()` shares the query-builder with `list()`; `/records` behavior byte-identical; §5.1 repo family landed (`list_custom` row-core + `list_entity`, 2 prod consumers + 3 test sites migrated)
- [ ] §5.2 photos migration: PhotoService.list on the core, docstring + photos domain-rules exception wording updated; `list_clients_with_stats` untouched
- [ ] All 6 maps + payments query deleted from RecordsContext; no `getClients()`/`getActivities(per_page:100)`/`getPaymentTotals` calls remain in records page path
- [ ] BookingFilters/ClientQuickCard/ActivityDetailsModal re-homed (R2/R3); schedule RecordsProvider removed; /schedule filter + modal flows verified (e2e/unit + visual — Amendment 3)
- [ ] Payment mutations invalidate `['records']` (R4/US-4)
- [ ] api-client: `RecordViewResponseSchema` + `getRecordsView()` + `getClientById()` added
- [ ] Backend/api-client/vitest/e2e suites green; US-1…US-6 e2e specs land
- [ ] docs/domain-rules/records.md updated: endpoint table row + view-contract subsection (final IMPL task) + §5.1 rewrite of the :201 pagination-mechanics paragraph (new repo family)

## 13. Domain rules impact

- `docs/domain-rules/records.md` — add `GET /api/v1/records/view` row + view-contract subsection (fields table from §4, archived-resolution rule, paid semantics); rewrite the :201 pagination-mechanics paragraph for the §5.1 repo family (`list_custom` row-core + `list_entity`). Updated as the final IMPL task (repo convention).
- `docs/domain-rules/photos.md` — the accepted-exception wording about PhotoService bypassing the repo list (photo.py:60-67 docstring + domain-rules) is retired by §5.2 (photos rides the core now).
- `docs/domain-rules/activities.md:48-56` — label pin honored: no new label format; the cross-pin note stands. Location ACTIVE-only omission rule (activities.md:54) applies to `formatActivityLabel` consumers (photos) — records columns read nullable row fields directly, so archived-location names now display in the records table (intended, US-3).
