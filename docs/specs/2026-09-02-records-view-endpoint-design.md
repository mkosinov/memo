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

## 3. Design refinements required by the locked decisions

G1a explore (ses_f9e6948e2 + ses_f9e654a6a, 2026-09-02) pinned the exact consumer graph. Deleting ALL maps from RecordsContext has three forced consequences + two additions, all within the locked scope:

| # | Refinement | Why it is forced / justified |
|---|---|---|
| R1 | `master_color` added as a 7th display field | master cell renders a color dot `backgroundColor: master?.color || '#999'` (recordsColumns.tsx:140). Without the field the dot cannot render from row data. Nullable. |
| R2 | BookingFilters re-homes dict data to the existing shared hooks `useLocations()` / `useServices()` / `useMasters()` | BookingFilters.tsx:47 consumes `{locations, services, masters}` from `useRecords()` — selection dropdowns, NOT display. Maps die → the filter bar must own its data. Hooks already exist (hooks/useLocations.ts etc.) with the SAME canonical query keys `['locations']`/`['services']`/`['masters']` and 5-min staleTime — react-query dedupe makes this a pure ownership move. |
| R3 | ClientQuickCard + ActivityDetailsModal re-homed off `useRecords()` | ClientQuickCard.tsx:35 destructures `{clients, services, locations}` (header name/phone L55/L84-100; its records list display L131/L139). ActivityDetailsModal.tsx:29 `{clients}` (L80 fallback, L201 direct) — the ONLY non-records-page consumer; schedule/page.tsx:33-37 wraps RecordsProvider solely to feed it. Re-homing lets the schedule page DROP the RecordsProvider wrapper (kills 7 spurious queries on the schedule page). |
| R4 | Payment mutations invalidate `['records']` | Today `addPayment`/`deletePayment`/`patchPayment` (useRecordMutations.ts:202-336) only do optimistic writes + `['record', id]` invalidation. With `paid` moving into the view row, the list must refresh → add `invalidateQueries({queryKey: ['records']})` to payment add/delete/patch (+ deferred-delete commit). Required by US-4. |
| R5 | Records query key unchanged | `['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder]` (RecordsContext.tsx:100) — the `'records'` prefix is the app-wide freshness contract (12 invalidation call sites). The view fetcher swaps in under the SAME key. |

## 4. API contract — `GET /api/v1/records/view`

**Purpose:** one request returning everything the records TABLE renders.

**Query params:** identical to `GET /api/v1/records` — the same `RecordListParams` (schemas/record.py:123-145): `page`, `per_page` (1–100), `client_id`, `activity_id`, `date_from`, `date_to`, `location_id`, `service_id`, `master_id`, `status`, `q` (2–100 chars, else 422), `sort_by`, `sort_order`. Same validation → same 422 VALIDATION_ERROR matrix. No new params, no param drift possible (single class, single injection idiom `Annotated[RecordListParams, Query()]`).

**Response:** `PaginatedResponse[RecordViewResponse]` — `{items, total, page, per_page}` (schemas/common.py:15-21).

**`RecordViewResponse`** — inherits `RecordResponse` (id, activity_id, client_id, status, seats, anonym_visits, comment, custom_price, created_at, updated_at, visits[]) and adds:

| Field | Type | Source | Null when |
|---|---|---|---|
| `client_name` | `str \| None` | `Client.name` via `Record.client_id` | anonymous record (client_id null) |
| `activity_start` | `datetime \| None` | `Activity.start` (already INNER-joined) | never in practice (FK enforced); nullable for safety |
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
- `list()` = `_build_list_stmt` → `BaseRepository.list_custom` (repo-owned count/order/limit/offset, repositories/generic.py:74-100) → `_map_record` → `PaginatedResponse[RecordResponse]`. Behavior byte-identical to today.
- `list_view()` = same stmt + **extra select columns**:
  - `activity_start` → `Activity.start` (direct, already joined);
  - `client_name`, `service_title`, `master_name`, `location_name`, `master_color` → **correlated scalar subqueries** (the `_sort_columns` pattern, record.py:119-148) — no join-topology changes, orthogonal to the `q` outerjoins; page-sized sets (≤100 rows) keep this cheap in SQLite;
  - `paid` → correlated scalar subquery `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE payments.record_id = records.id`.
  - Sort: SAME `_sort_columns` whitelist — sorting order is shared, guaranteeing US-6 parity with `/records`.
  - Row mapping: service-owned manual map Row → `RecordViewResponse` (photos precedent: services/photo.py:102-105), reusing `_map_record` for the base fields. Repo stays generic (no records-specific logic in `repositories/generic.py`); if `list_custom` needs a minimal extension to return multi-column rows, it stays entity-agnostic.

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
| service | `row.service_title` | `'—'` |
| master | color dot `backgroundColor: row.master_color ?? '#999'}` + `title` tooltip `row.master_name` | gray `#999` dot, no tooltip |
| location | `row.location_name` | `'—'` |
| payment | `row.paid` vs visits-total: `✓ Оплачено` (--success) / `Частично (N₽)` (--warning) / `Не оплачено` (--danger) — logic unchanged, source swaps `payments.get(id) ?? 0` → `row.paid` | — |

**Activity label pin (activities.md:48-56):** the records feature does NOT compose full activity label strings — date/service/master/location are separate columns (as today). No third label format gets invented anywhere in this feature; wherever a full label is needed, `formatActivityLabel` remains the only sanctioned composer. Segment-omission semantics live only inside that formatter.

### 6.3 RecordsTable detail panel

`selectedClient`/`selectedActivity` map lookups (L84-85, L164, L177, L240) → read the selected `RecordView` row: client name `row.client_name ?? '—'`; service `row.service_title`; master `displayMasterName`-equivalent = `row.master_name` (server already composes «Фамилия Имя»); location `row.location_name`. Payments block stays on `useRecordData` (`['payments', recordId]`).

### 6.4 BookingFilters — selection data re-homed (R2)

`useRecords()` → shared hooks `useLocations()` / `useServices()` / `useMasters()` (hooks/*: canonical keys `['locations']`/`['services']`/`['masters']`, 5-min staleTime, select-transformed domain objects). Keep active-only dropdown options exactly as today (client-side `!archived` filter retained unless the hook's transformed type already excludes archived — implementer verifies the transformed shape carries `archived`; if not, extend the transform or query the canonical key directly with `getAll*`). Dropdown labels/order untouched. If the transformed hook output lacks a field the dropdown needs (e.g. `first_name` for masters), extend the transformer — do NOT fork the query key.

### 6.5 ClientQuickCard — context entity by id (R3)

- Header: replace `clients.get(clientId)` with its own query `['client', clientId]` → GET /api/v1/clients/{id} (name + phone). Fetched once per card open, react-query-cached. api-client method: reuse the existing get-client-by-id method if present, else add `getClientById` (§7).
- Its records-list display: `services`/`locations` maps → shared hooks `useServices()` / `useLocations()` (same canonical keys — no extra requests beyond cached page state).
- Own queries (records/activities/payments-totals for the client) unchanged (out of scope: modal caps).

### 6.6 ActivityDetailsModal + schedule page (R3)

- Modal stops using `useRecords()`: client resolution (L80 fallback, L201) → own per-id query `['client', record.client_id]` (enabled when client_id set), merging with the existing `useClients()` paged map preference order: paged map first, per-id query fallback (same precedence as today).
- schedule/page.tsx: REMOVE the RecordsProvider wrapper (its only records-context consumer was this modal) — the schedule page stops firing all 7 records-context queries.

### 6.7 Payment mutations (R4)

`addPayment`, `deletePayment`, `patchPayment`, `deletePaymentDeferred` (commit path) in useRecordMutations.ts: add `queryClient.invalidateQueries({ queryKey: ['records'] })` alongside the existing `['record', id]` invalidation → the view row (`paid`, status) refreshes (US-4).

## 7. api-client (packages/api-client)

- `RecordViewResponseSchema` = `RecordResponseSchema.extend({ client_name: z.string().nullable(), activity_start: z.string().nullable(), service_title: z.string().nullable(), master_name: z.string().nullable(), location_name: z.string().nullable(), master_color: z.string().nullable(), paid: z.number().int() })` — datetime as ISO string, matching existing schema conventions.
- `RecordView` exported type; `getRecordsView(params)` → `GET /api/v1/records/view` → `paginatedSchema(RecordViewResponseSchema)` — param typing mirrors `getRecords` (endpoints.ts:300-331).
- `getRecords` and all existing methods unchanged.
- If no get-client-by-id method exists yet (§6.5/§6.6 need one): add `getClientById(id)` → `GET /api/v1/clients/{id}` → `ClientResponseSchema` (or the existing canonical client schema).

## 8. User Scenarios (each → E2E test)

- **US-1 beyond-cap client:** seed ≥101 clients, a record for client #101 → table shows that client's name (today: empty).
- **US-2 one display request:** records page load issues exactly ONE display-data request (`/records/view`); NO `/clients?per_page=100`, NO `/activities?...per_page=100`, NO `/payments/totals` from the records page; filter dropdowns still populate and filter.
- **US-3 archived entities:** record referencing an ARCHIVED client and an ARCHIVED master → table shows real name (not `'—'`), master dot uses the master's own color; record whose activity has a deleted service → `'—'`.
- **US-4 paid freshness:** payment column filled from the view row; add a payment in the detail panel → row payment badge updates without manual reload (R4 invalidation).
- **US-5 filter parity:** every current filter (client/activity/date range/location/service/master/status) + `?q=` search produce identical results on `/records/view` as on `/records` (same fixture, same totals).
- **US-6 sort parity:** all sort_by columns (`date, client, service, master, location, guests, status, total, payment`) × asc/desc — same row order as `GET /records` (API-level assert) and table behaves identically (UI).

## 9. Testing strategy

- **Backend (pytest):** `/records/view` — params parity (422 matrix shared with `/records`), display-field correctness (client_name resolution incl. archived; `master_name` = «Фамилия Имя»; nulls for anonymous/dangling), `paid` sums (none/partial/full), pagination envelope, route-order (GET /view is not captured by /{record_id}), sort parity loop (per sort_by: id sequence == /records sequence on shared fixture), `q` + filters on view.
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
| BookingFilters | fed by RecordsContext maps | own shared hooks (same data, same keys) |
| ClientQuickCard header | context clients map (100-capped) | per-id GET (always correct) |
| `GET /records` | canonical list | unchanged (modals + future consumers) |

## 11. Visual Compliance Checks

- [ ] Records table shows all columns with names/dates/prices (no `'—'` regressions on healthy data)
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
- [ ] `list_view()` shares the query-builder with `list()`; `/records` behavior byte-identical
- [ ] All 6 maps + payments query deleted from RecordsContext; no `getClients()`/`getActivities(per_page:100)`/`getPaymentTotals` calls remain in records page path
- [ ] BookingFilters/ClientQuickCard/ActivityDetailsModal re-homed (R2/R3); schedule RecordsProvider removed
- [ ] Payment mutations invalidate `['records']` (R4/US-4)
- [ ] api-client: `RecordViewResponseSchema` + `getRecordsView()`
- [ ] Backend/api-client/vitest/e2e suites green; US-1…US-6 e2e specs land
- [ ] docs/domain-rules/records.md updated: endpoint table row + view-contract subsection (final IMPL task)

## 13. Domain rules impact

- `docs/domain-rules/records.md` — add `GET /api/v1/records/view` row + view-contract subsection (fields table from §4, archived-resolution rule, paid semantics). Updated as the final IMPL task (repo convention).
- `docs/domain-rules/activities.md:48-56` — label pin honored: no new label format; the cross-pin note stands. Location ACTIVE-only omission rule (activities.md:54) applies to `formatActivityLabel` consumers (photos) — records columns read nullable row fields directly, so archived-location names now display in the records table (intended, US-3).
