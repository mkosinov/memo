# Records Page: Server-Side Filters + Pagination + Sorting — Design

- Date: 2026-08-08
- GitHub issue: #191 (deferred from #186, see `docs/specs/2026-07-29-payments-batch-aggregate-design.md:61-83`)
- Status: pending G1b
- Domain rules: `docs/domain-rules/records.md`, `docs/domain-rules/payments.md`, `docs/domain-rules/activities.md`
- Binding pagination policy: `docs/specs/2026-07-28-list-pagination-migration-design.md` (#182: page ≥ 1, per_page 1..100, out-of-bounds → 422, envelope `{items, total, page, per_page}`)
- Reference implementation to mirror: Clients page (backend `list_clients_with_stats` + `ClientListParams`; frontend `ClientsContext` + clients page pagination + `ClientsTable` header sort)

## G1a user decisions (binding, 2026-08-08)

1. **Scope: full "like Clients page"** — server-side filtering, server-side pagination, server-side sorting for the Records admin page. Client-side filter/sort/slice logic in RecordsTable is REMOVED.
2. **Architectural principle:** technical mechanisms (pagination, date-string parsing) → shared helpers; business-meaningful filters → hand-written in the entity's vertical (router → service). NO generic filter registry / declarative filter-spec framework (YAGNI, no precedent in codebase).
3. **Date parsing util:** shared helper for `date_from`/`date_to` parsing; MUST preserve "whole day, inclusive" semantics (day starts 00:00, ends 23:59). Invalid date strings → 422, not 500 (activities currently 500s on bad input — the util fixes this for both).
4. **Activities refactor:** `ActivityService._list_by_date` moves to the shared util + shared `_paginate` (kills pagination duplication). Behavior unchanged; existing activities tests = regression gate.

## 1. Background & Problem

The Records admin page (`/records`) is the only major admin table still doing everything client-side:

- **Backend silently ignores date filters.** `GET /api/v1/records` (`backend/src/api/v1/records.py:71-86`) declares only `page`, `per_page`, `client_id`. The frontend sends `date_from`/`date_to` (`RecordsContext.tsx:49-52` → `endpoints.ts:252-267`), which FastAPI silently drops. The context actually fetches "first 100 records overall".
- **Filtering is client-side.** `RecordsTable.tsx:87-105` filters by date range, location, service, master, status in a `useMemo` over the loaded set.
- **Sorting is client-side.** `RecordsTable.tsx:122-194` — a 9-key comparator (`date, client, service, master, location, guests, status, total, payment`).
- **Pagination is fake.** `RecordsTable.tsx:197-201` slices the sorted array (`sortedRecords.slice(page * pageSize, ...)`). Anything beyond the first 100 records in the DB **silently does not exist** for the admin — the `per_page ≤ 100` cap from #182 makes this a silent-data-loss bug, exactly like the payments bug fixed in #186.
- **`RecordService.list`** (`backend/src/services/record.py:36-61`) is hand-rolled (equality loop + inline COUNT/LIMIT/OFFSET) and applies **no ordering at all** — row order is arbitrary DB order.
- **Pagination code is duplicated** in `GenericService._paginate` (`generic.py:72-84`), `RecordService.list`, and `ActivityService._list_by_date` (`activity.py:53-77`), which also contains the fragile `replace(hour=23, minute=59, second=59)` hack and crashes with 500 on invalid date strings.

### Why now

#186 (payments batch aggregate) fixed the payment-status half of this page and explicitly deferred this bug to #191. The Clients page (#182 + client stats) established all the patterns needed: validated params model, whitelist sort map with aggregate subqueries, server-total-driven pagination UI, context-held query state.

## 2. User Scenarios

1. **Admin selects a period in Records** → server returns only that period's records, with correct `total`. The "whole day inclusive" semantics are preserved: `date_to=2026-08-08` includes all records of Aug 8 up to 23:59.
2. **>100 records match the filter** → admin pages through real server pages; nothing is silently missing. `total` counts the FILTERED set (requirement from #182), so the "N всего" label and page buttons reflect the true match count.
3. **Admin filters by location/service/master/status singly and combined** → correct results + correct total, each filter applied server-side via the Activity JOIN.
4. **Admin sorts by date/status/payment** → the order is correct across ALL pages, not just the current one (deterministic server-side sort with stable tiebreak).
5. **Admin resets filters** → full list from page 1 (filter change resets page).
6. **Client card modal** (`getRecords({client_id})`, queryKey `['records','client',id]`) → unchanged behavior; the schedule-page ActivityDetailsModal booking tabs also keep working.

## 3. Goals

1. `GET /api/v1/records` accepts `date_from`, `date_to`, `location_id`, `service_id`, `master_id`, `status`, `activity_id`, `sort_by`, `sort_order` in addition to existing `page`, `per_page`, `client_id`. Invalid values → **422** (explicit validation, #182 style — never silent clamping/fallback).
2. `RecordService.list` performs Filter → Sort → Paginate server-side, joining Activity, with a whitelist sort-column map including payment aggregates via correlated subqueries (precedent: `client.py:172-185`, `client.py:53-60`).
3. Shared day-range date util used by both records and activities; invalid dates → 422 on both endpoints.
4. `ActivityService._list_by_date` refactored onto the shared util + shared `_paginate`; behavior otherwise unchanged.
5. Frontend RecordsContext holds page/filters/sort in state, passes all as server params; `total` from the envelope drives the pagination UI.
6. RecordsTable: client-side filter/sort/slice deleted; header-click sorting and page controls wired to the server.
7. The two context-dependent modals (records-folder ClientCardModal, ActivityDetailsModal) keep working via their own dedicated queries.
8. E2E filter/sort tests honestly reworked against real server filtering (proper response waits, URL-param assertions).

## 4. Non-Goals (explicit follow-ups — NOT in scope)

- >100 cap for OTHER tables (masters/services/locations/materials/tags/photos) + their server pagination.
- Router-inline query violations in `photos.py:34-43` and `search.py:65-71`.
- Equality-loop copy-paste in `record.py`/`payment.py`/`service.py` services.
- `custom_price` is NOT reflected in the `total`/`payment` sort semantics (mirrors today's UI — see §6.4 quirk note). A custom_price-aware total is a separate follow-up.
- Clients endpoint's silent sort fallback (`sort_column_map.get(..., Client.name)`) stays untouched; records deliberately diverges (422 instead) — harmonizing clients is a follow-up.
- Activities list pagination remains unordered (pre-existing unstable-page quirk); adding a deterministic default order to activities is a follow-up.
- Shared pagination UI component across admin tables (every table inlines its own) — out of scope.
- Stale wording in `records.md:123-124` ("soft-deactivated" visits) — already tracked as a follow-up from #194.

## 5. Backend Design

### 5.1 `RecordListParams` — validated params model

New params model in `backend/src/schemas/record.py`, injected as a **FastAPI Query Parameter Model**: `params: Annotated[RecordListParams, Query()]` in the router signature (official pattern since FastAPI 0.115; the repo locks 0.136.3). **NOT `Depends()`** — panel-verified: Depends-injected Pydantic models are not officially supported and a model-level validator on that path raises 500 instead of 422 (fastapi#4974, #2180); the existing `ClientListParams = Depends()` precedent only works because it has no model-level validator. With `Query()`, the `model_validator` below correctly produces 422.

```python
class RecordListParams(BaseModel):
    """Query parameters for GET /api/v1/records with filtering, pagination, sorting."""

    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=20, ge=1, le=100)
    client_id: str | None = None
    activity_id: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    location_id: str | None = None
    service_id: str | None = None
    master_id: str | None = None
    status: Literal["waiting", "visited", "missed", "cancelled"] | None = None
    sort_by: Literal[
        "date", "client", "service", "master", "location",
        "guests", "status", "total", "payment",
    ] = "date"
    sort_order: Literal["asc", "desc"] = "asc"

    @model_validator(mode="after")
    def _check_date_range(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("date_from must be on or before date_to")
        return self
```

Validation decisions (all → 422, deliberate "explicit validation" per G1a + #182 style):

- `status` uses `Literal` over the VisitStatus values (Record.status is derived, values `waiting/visited/missed/cancelled` per `docs/domain-rules/records.md`). Invalid status string → 422.
- `sort_by`/`sort_order` use `Literal` — invalid value → 422. **Deliberate divergence from clients** (which silently falls back to `name`; see Non-Goals). Records is a new endpoint contract; fail loud.
- `date_from`/`date_to` typed `date` — Pydantic rejects garbage strings with 422 for free (fixes the activities 500 too, see §5.4).
- `date_from > date_to` → 422 via model validator. New behavior (today: silently empty result) — flagged for G1b.
- `page`/`per_page` bounds per #182 policy (422 on violation; `test_api_pagination_params.py` already guards this).

### 5.2 Shared day-range date util

New module `backend/src/domain/dates.py` (precedent for shared domain predicates: `active_record_filter` in `domain/record_visits.py:76-87`):

```python
def day_range(date_from: date | None, date_to: date | None) -> tuple[datetime | None, datetime | None]:
    """Convert inclusive YYYY-MM-DD bounds to an inclusive [from_dt, to_dt] datetime range.

    Whole-day inclusive semantics (G1a binding): date_from covers from 00:00:00,
    date_to covers through 23:59:59.999999 — via datetime.combine(d, time.min / time.max),
    the existing codebase idiom (client.py:128-129); overflow-free, no edge guards.
    """
```

- Input is already-validated `date` objects (Pydantic parsed at the router) — the util never raises 422 itself; validation lives in the params layer.
- Inclusive bounds (`>= from_dt`, `<= to_dt`) replace the fragile `replace(hour=23, minute=59, second=59)` hack — same semantics, exact precision, and no year-9999 overflow branch.
- Consumers: `RecordService.list` (on `Activity.start`) and `ActivityService._list_by_date`.

### 5.3 `RecordService.list` — Filter → Sort → Paginate

Rewritten in `backend/src/services/record.py` (hand-written business filters in the entity vertical, per G1a principle 2 — NO generic filter registry):

```python
async def list(self, db_session, params: RecordListParams) -> PaginatedResponse:  # ORM items
    stmt = (
        select(Record)
        .join(Activity, Record.activity_id == Activity.id)   # always: date filter + default sort need it
        .options(selectinload(Record.visits))
    )
    # --- Filter ---
    from_dt, to_dt = day_range(params.date_from, params.date_to)
    if from_dt is not None:
        stmt = stmt.where(Activity.start >= from_dt)
    if to_dt is not None:
        stmt = stmt.where(Activity.start <= to_dt)
    if params.location_id:
        stmt = stmt.where(Activity.location_id == params.location_id)
    if params.service_id:
        stmt = stmt.where(Activity.service_id == params.service_id)
    if params.master_id:
        stmt = stmt.where(Activity.master_id == params.master_id)
    if params.status:
        stmt = stmt.where(Record.status == params.status)
    if params.client_id:
        stmt = stmt.where(Record.client_id == params.client_id)
    if params.activity_id:
        stmt = stmt.where(Record.activity_id == params.activity_id)
    # --- Sort (whitelist map, §6) ---
    # --- Paginate (shared, §5.5) ---
```

- `Record.activity_id` is NOT NULL FK → INNER JOIN is safe (no row loss/multiplication; Activity is many-to-one).
- The equality `**filters` loop is deleted; `client_id` handling folds into the explicit filter list. `activity_id` is newly added (needed by ActivityDetailsModal, §7.4).
- Router `list_records` becomes `params: Annotated[RecordListParams, Query()]` → `service.list(db_session=session, params=params)` → maps ORM items via the existing `_map_record` (unchanged, nested visits mapping stays in the router).

### 5.4 Activities refactor (G1a decision 4)

- Activities router (`backend/src/api/v1/activities.py:48-70`): `date_from: str | None = Query(None)` → `date_from: date | None = Query(None)` (same for `date_to`). Pydantic now 422s on garbage instead of the service 500ing on `datetime.fromisoformat`. **This is the user-mandated 500 → 422 fix.**
- `ActivityService._list_by_date` rebuilds its WHERE via `day_range(...)` and paginates via the shared `_paginate` (`GenericService._paginate`, which already validates `ActivityResponse` per item — identical to today's inline code). The `replace(hour=23, minute=59, second=59)` hack and the duplicated COUNT/LIMIT/OFFSET block die.
- **Otherwise behavior unchanged**: no ordering added (pre-existing quirk, follow-up), same response shape, same occupied-seats enrichment in the router. Existing activities date tests (`test_api_activities.py::TestActivitiesDateFiltering`) are the regression gate + gain one new case: invalid date → 422.
- `date_from > date_to` on activities: keeps today's silent-empty behavior (no params model on that router; minimal-change mandate). Noted as a follow-up inconsistency.

### 5.5 Shared pagination

Per G1a principle 2, pagination is a technical mechanism → one shared implementation:

- `GenericService._paginate` (`generic.py:72-84`) is the canonical COUNT + LIMIT/OFFSET. `ActivityService` inherits it directly.
- `RecordService.list` returns raw ORM items (router maps them), so it cannot reuse the schema-validating `_paginate` as-is. Implementation (plan-level detail): extract the COUNT+slice core into a shared helper usable with ORM items (e.g. `_paginate` gains an internal ORM mode, or a module-level `paginate_stmt(db, stmt, page, per_page)` both paths call). Either way the third hand-rolled copy is deleted.
- **`total` is computed from the filtered but UNORDERED statement.** `_paginate` counts via `select(func.count()).select_from(stmt.subquery())` — if the statement already has ORDER BY with correlated subqueries, the sort keys get evaluated inside the count too. Order of operations is therefore: build filters → count → apply ORDER BY → LIMIT/OFFSET (the shared helper takes the unordered statement for COUNT).
- Sort-key subqueries (§6) are evaluated for the whole filtered set, not just the page's rows — ORDER BY is computed before LIMIT applies. Acceptable at this scale (admin table, thousands of rows max; OFFSET pagination with a unique tiebreak is the recommended pattern up to ~10k rows). No N+1: 1 COUNT + 1 SELECT (+ selectinload visits).

## 6. Sorting Design

### 6.1 Sortable column set (mirrors RecordsTable exactly)

RecordsTable's current comparator (`RecordsTable.tsx:122-194`) defines 9 keys; the server whitelist mirrors them 1:1:

| `sort_by` | Server expression | Mirrors today's comparator |
|---|---|---|
| `date` (default) | `Activity.start` | date string compare + startTime tiebreak |
| `client` | `Client.name` (correlated scalar subquery; LEFT semantics) | lookup-map name `localeCompare`, `''` for anonymous |
| `service` | `Service.title` (correlated subquery via Activity) | service title `localeCompare` |
| `master` | `Master.last_name`, then `Master.first_name` (two keys) | `displayMasterName` = `"Last First"` localeCompare |
| `location` | `Location.name` (correlated subquery via Activity) | location name `localeCompare` |
| `guests` | `Record.seats - Record.anonym_visits` (= live visits count) | `visits.length` |
| `status` | `Record.status` | status string `localeCompare` |
| `total` | `COALESCE(SUM(Visit.price), 0)` correlated subquery | `visits.reduce((s,v)=>s+v.price,0)` |
| `payment` | `CASE WHEN paid >= total THEN 0 WHEN paid > 0 THEN 1 ELSE 2 END` | 3-level bucket: fully paid → partial → unpaid |

Name-based sorts use correlated scalar subqueries (precedent: `client.py:53-60`) rather than additional JOINs — keeps the FROM clause to `records JOIN activities` regardless of sort key. (`master` needs two scalar subquery keys — last_name, first_name — not one.)

**`guests` correctness note (panel BLOCKER, resolved):** the cited invariant "seats == len(visits)" in `records.md` is **stale** — the code (`recompute_record_seats`, `domain/record_visits.py:43`) computes `seats = len(visits) + anonym_visits`, and `records.md:13` itself says anonym visits add to seats. Sorting by raw `Record.seats` would NOT mirror the deleted `visits.length` comparator (e.g. 0 visits + 5 anonym seats would sort as 5). The sort expression is `Record.seats - Record.anonym_visits`, which exactly equals live `visits.length` for every record. The stale invariant wording in `records.md` is corrected via docser at IMPL (§10).

**Collation note (panel-verified, accepted divergence):** server-side SQLite BINARY collation orders Cyrillic/Latin and case differently than the browser's ru-locale `localeCompare`. Name sorts (`client`/`service`/`master`/`location`) therefore mirror the comparator's KEYS, not its byte-exact ordering — the same divergence the Clients page already accepted. Deterministic and consistent across pages, which is what matters (Scenario 4).

### 6.2 Payment-status sort semantics (binding definition)

- `paid(record)` = `SELECT COALESCE(SUM(amount), 0) FROM payments WHERE record_id = Record.id` — same source as the `getPaymentTotals` batch aggregate (payments.md §47-64). Payments are hard-deleted; no inactive filter.
- `total(record)` = `SUM(Visit.price)` over the record's live visits. Visits are hard-deleted on record update (no `is_active` on Visit — verified against `models/visit.py`), so the subquery needs no soft-delete filter and always matches the `visits` payload in RecordResponse.
- Bucket: `paid >= total → 0` ("✓ Оплачено"), `paid > 0 → 1` ("Частично"), else `2` ("Не оплачено") — **identical thresholds to the display badge** (`RecordsTable.tsx:409-420`) and to today's sort comparator (`RecordsTable.tsx:180-189`).
- **asc = fully-paid first** (0 → 2), desc = unpaid first — mirrors today's `sortDir === 'asc' ? cmp : -cmp`.
- Edge: `total = 0` (record with 0 visits, e.g. only `anonym_visits` slots) → `paid(0) >= total(0)` → bucket 0 (fully paid), same as today.

### 6.3 Determinism & NULL handling

- Every sort appends a final tiebreak `Record.id ASC` — required for cross-page order correctness (User Scenario 4) since bucket/name ties are common.
- Nullable name sorts (`client` only — anonymous records): `asc → NULLS FIRST`, `desc → NULLS LAST` (precedent `client.py:181-184`), mirroring today's `''`-sorts-first-on-asc comparator behavior.
- **Default sort: `date` asc** (chronological). Today's default is arbitrary DB order — a deterministic default is mandatory for stable pagination; date-asc matches the admin's mental model of the records list. Flagged for G1b as a small deliberate behavior change.

### 6.4 Quirk note (mirrored, not fixed): `custom_price`

Both the `total` column and the `payment` bucket ignore `Record.custom_price` (which per domain rules overrides the sum of visit prices) — today and after this change. Display and sort stay mutually consistent (same total definition). Making totals custom_price-aware is a follow-up (Non-Goals).

## 7. Frontend Design

### 7.1 RecordsContext — server-driven state (mirrors ClientsContext)

Reference: `ClientsContext.tsx:72-98` (`queryKey = ['clients', page, perPage, filters, sortBy, sortOrder]`, `setFilters` resets page, provider exposes `total` + setters).

New provider state: `page` (1-based, default 1), `perPage` (default 10 — mirrors current RecordsTable UI default), `filters` (`{locationId, serviceId, masterId, status}` — moved from `page.tsx:11-16` local state into the provider per dispatch decision), `sortBy`/`sortOrder` (default `date`/`asc`). Dates stay in `NavigationContext` (shared with the schedule page; `BookingFilters` already writes them there via `selectDateRange`).

```tsx
const { data, isLoading, error } = useQuery<PaginatedResponse<RecordResponse>>({
  queryKey: ['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder],
  queryFn: () => getRecords({
    page,
    per_page: perPage,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    location_id: filters.locationId || undefined,   // explicit camelCase → snake_case mapping
    service_id: filters.serviceId || undefined,
    master_id: filters.masterId || undefined,
    status: (filters.status || undefined) as RecordStatus | undefined,
    sort_by: sortBy,
    sort_order: sortOrder,
  }),
  placeholderData: keepPreviousData,   // page flips keep showing previous page while fetching (TanStack v5 paginated-query pattern)
});
```

- **No blind spread** — filter state stays camelCase (matches BookingFilters props) and the queryFn maps each key explicitly to the snake_case wire contract (§7.6). Empty-string filter values map to `undefined` and are omitted from the URL (both existing URL builders skip falsy values — sending `status=` would 422 the `Literal`).

- queryKey includes ALL server params (page, per_page, all six filters, sort_by, sort_order) — exact key composition is plan-level; every param must be in the key.
- **Envelope is cached** (not `.then(r => r.items)`) — provider exposes `records: data?.items ?? []` and `total: data?.total ?? 0`. This is the shape change that ripples into the cache-sync helpers (§7.5).
- `setFilters(...)` resets `page` to 1 (mirrors ClientsContext). Date-range changes (NavigationContext) also reset `page` to 1 (effect watching `dateFrom`/`dateTo`). **Per-page change also resets `page` to 1** (preserves current RecordsTable UX — `RecordsTable.tsx:440`; deliberately NOT the ClientsContext behavior, which doesn't reset). `setSort(key)`: new key → asc, same key → toggle (preserves current RecordsTable UX — NOT ClientsTable's quirkier always-toggle).
- `getPaymentTotals` batch query: **unchanged** — keyed off the current page's record IDs, still drives the payment badge display (§7.3). Sorting no longer depends on it (server-side now).
- Lookup maps (`activities`, `masters`, `services`, `locations`, `clients`) unchanged — still needed for row rendering.

### 7.2 RecordsTable surgery

Deleted (per G1a decision 1):

- Client-side filter block (`RecordsTable.tsx:87-105`).
- Client-side comparator (`RecordsTable.tsx:122-194`) + local `sortField`/`sortDir` state.
- Client-side slice pagination (`RecordsTable.tsx:197-201`) + local 0-based `page`/`pageSize` state + the reset-on-filter effect.

Rewired:

- **Header-click sorting** → context `setSort`; indicators (`↑`/`↓`/`↕`) render from context `sortBy`/`sortOrder`. All 9 headers stay clickable with the same keys (`date, client, service, master, location, guests, status, total, payment`) — keys now map to `sort_by` values.
- **Pagination controls** (`RecordsTable.tsx:434-483`) keep their current visuals ("Строк:" select 10/20/50/100, numbered page buttons, `←`/`→`, "N всего") but drive context `page`/`perPage` and compute `totalPages` from server `total`. Page state becomes 1-based end-to-end (open point resolved, §8).
- Row rendering (dates via `parseActivityStart`, names via lookup maps, visits count/price, status badges, payment badges) — unchanged.

### 7.3 Payment column display — unchanged source

Payment badges keep reading the `payments` map built from `getPaymentTotals` over the **current page's** record IDs (per dispatch: batch totals stays for DISPLAY). Thresholds identical to the server sort bucket (§6.2), so display and sort can never disagree. Missing key → 0 → "Не оплачено" (unchanged).

### 7.4 Modals rewired to dedicated queries (context shrink compensation)

With the context now holding ONE server page instead of "up to 100 records", two consumers that filtered the context set client-side would silently lose data. Both get their own dedicated queries (pattern already established by the clients-folder ClientCardModal):

- **Records-folder ClientCardModal** (`records/components/ClientCardModal.tsx:34`, today `records.filter(r => r.client_id === clientId)`) → mirrors the clients-folder modal's data strategy wholesale (`clients/components/ClientCardModal.tsx:54-68`):
  - Own records query `['records', 'client', clientId]` → `getRecords({ client_id, per_page: 100 })`.
  - Own activities batch fetch for its record IDs (`['activities', 'for-records', ids]`, as the clients-folder modal does) — otherwise records outside the current week render '—' for service/location/time.
  - Own `getPaymentTotals` over its own record IDs (≤100 IDs, within the 200 cap) — NOT a fallback to the context `payments` map, which after this change only covers the current table page. Without this, off-page records would degrade to "Не оплачено" and the "Потрачено" header stat would undercount (panel-verified regression; today the map covers the modal's whole record set). "Потрачено" stays a frontend computation over paid sums — the #192 semantic change (server `total_paid`) is untouched.
  - Net effect: modal behavior is preserved (actually improved — full history regardless of table filters/page), and User Scenario 6 holds for BOTH modals.
- **ActivityDetailsModal** (`ActivityDetailsModal.tsx:57`, today `records.filter(r => r.activity_id === activity.id)` — mounted on the schedule page) → own query `['records', 'activity', activityId]` → `getRecords({ activity_id, per_page: 100 })` — enabled by the NEW `activity_id` param (§5.3). This also fixes today's latent bug: the modal silently misses bookings once >100 records exist overall.

### 7.5 Cache-sync helpers — envelope awareness

`lib/cache/recordCacheSync.ts` helpers (`patchRecordEverywhere`, `upsertVisit`, `removeVisit`, `upsertPayment`, `removePayment`, `seedRecordFromList`) patch every `['records', ...]` list cache via `setQueriesData({queryKey: ['records']})` prefix. **Plus one inline call site: `deleteRecord`'s optimistic removal in `useRecordMutations.ts:188-191` does `(old) => old.filter(...)` — it must get the same shape guard, otherwise it throws `TypeError` on envelope caches** (panel-verified: reachable from ActivityDetailsModal while a records-page envelope cache exists in the same QueryClient). After the shape change:

- Main list caches (envelope `{items, total, page, per_page}`) and per-client/per-activity caches (plain arrays) coexist → all the above updaters get a shape guard (`Array.isArray` vs envelope) and patch `items` in place.
- `envelope.total` is NOT adjusted optimistically — every mutation path already follows with `invalidateQueries({queryKey: ['records']})` (`useRecordMutations.ts:67,189`), so the authoritative total returns on refetch (sub-second stale "N всего" label, acceptable UX).
- Prefix invalidation `['records']` continues to cover all key variants (main paged list, `['records','client',id]`, `['records','activity',id]`) — no key-topology change for invalidation.
- `seedRecordFromList` effect: unchanged logic, iterates `data.items`.

### 7.6 api-client

`getRecords` (`packages/api-client/src/endpoints.ts:252-267`) gains `activity_id`, `location_id`, `service_id`, `master_id`, `status`, `sort_by`, `sort_order` params (existing `date_from`, `date_to`, `client_id`, `page`, `per_page` unchanged). Param names mirror the clients endpoint exactly: **`sort_by`, `sort_order`** (open point resolved, §8). URL-building tests in `endpoints.test.ts` for the new params (existing style: `endpoints.test.ts:255-262`).

## 8. Resolved Decisions (open points from G1a)

1. **Sortable column set** = the 9 keys RecordsTable sorts today (§6.1); payment-status sort = 3-level bucket with display-identical thresholds, asc = fully-paid first (§6.2).
2. **1-based page everywhere.** Backend (`page: Query(ge=1)`) and ClientsContext are already 1-based; RecordsTable's 0-based index was purely internal. State, wire, and server now agree; the UI still displays 1-based numbers as today.
3. **Param names mirror Clients exactly**: `sort_by` / `sort_order` (§7.6). Consistency beats brevity; api-client tests pin the wire names.
4. **Invalid values → 422** (status/sort_by/sort_order via `Literal`, dates via Pydantic `date`, date range via model validator). Deliberate divergence from clients' silent sort fallback — flagged.
5. **Default sort `date` asc** — deterministic default required for stable pages (§6.3). Flagged.
6. **`activity_id` param added** to GET /records — required to keep ActivityDetailsModal working after the context shrinks to one page (§7.4). Additive, low-risk.
7. **Two modals get dedicated queries** (`['records','client',id]`, `['records','activity',id]`) — preserves modal behavior under server pagination (§7.4).

## 9. Test Strategy

### 9.1 Backend (pytest)

New/updated in `backend/tests/` (API-based fixtures per conftest pattern: `create_master/service/location/client/activity/record`, payments via POST /payments):

- **Filters** (`test_api_records.py`, new class): each filter alone — date range (boundary: record at date_to 23:30 included, record next day 00:00 excluded; single-bound `date_from`-only and `date_to`-only cases), location_id, service_id, master_id, status, client_id (existing), activity_id; representative combinations (date+status, location+master+status); `total` reflects filtered count.
- **Sorting**: each of the 9 columns asc+desc with seeded distinct values; **`guests` sort seeded with an anonym-visits record** (0 visits + N anonym seats must sort as live visits count, not seats); payment bucket ordering (fully-paid < partial < unpaid on asc) via records with full/partial/no payments; deterministic pagination — page 1 and page 2 disjoint under each sort; anonymous-client record sorts first on `client` asc.
- **422 cases**: garbage `date_from`/`date_to`; `date_from > date_to`; invalid `status`; invalid `sort_by`; invalid `sort_order`; page/per_page bounds (existing `test_api_pagination_params.py` covers).
- **Regression**: `test_api_activities.py::TestActivitiesDateFiltering` (date range) stays green — the activities refactor regression gate; NEW: invalid date on `/activities` → 422 (was 500). `backend/tests/services/test_record_service.py` updated to the params-model signature. `test_list_activities_query_count.py` stays green (no N+1).

### 9.2 Frontend unit (vitest)

- **api-client** (`endpoints.test.ts`): URL building for all new getRecords params + combinations.
- **RecordsContext.test.tsx**: update queryKey literals (lines 138/158/177) to the new key shape; new coverage — server params passed (page/filters/sort with correct snake_case mapping), `setFilters` resets page, date-range change resets page, per-page change resets page, `setSort` toggle semantics, `total` exposed.
- **recordCacheSync.test.ts** (6 spots): main-list caches seeded as envelopes; client-list caches stay arrays; helpers patch both shapes.
- **useRecordMutations.test.ts** (5 spots): seeded list caches updated to envelope where applicable; prefix-invalidate assertions unchanged; **new: deleteRecord's optimistic removal works on BOTH cache shapes** (envelope + array) — the §7.5 inline-updater guard.
- **ClientsIntegration.test.tsx**: `['records','client',id]` branch unchanged (stays an array cache) — verify only.
- **ClientRecordTab.api.test.tsx**: `['records']` prefix invalidation unchanged — verify only.
- **RecordsTable.test.tsx**: delete client-side filter/sort/pagination tests; new tests — header click calls `setSort` with right key, pagination controls call `setPage`/`setPerPage`, rows render from props/context, payment badges unchanged.
- **Context mocks**: `__tests__/helpers/mockContexts.ts` (`createMockRecordsContext`) and `renderWithProviders.tsx` updated to the new context shape (records, total, page, perPage, filters, sortBy, sortOrder, setters); dependent suites (`ClientTab.integration.test.tsx`, `ActivityDetailsModal.test.tsx`) updated — ActivityDetailsModal tests now mock the `['records','activity',id]` api call; records-folder ClientCardModal tests mock its three dedicated queries (records + activities batch + payment totals).

### 9.3 E2E (playwright, real backend — no page.route)

`frontend/admin/e2e/records.spec.ts` honest rework, pattern: `clients.spec.ts:336-341` (waitForResponse with URL-param predicate registered BEFORE the action, awaited after, then post-state assertion):

- **Tests 6/7/16/17/18** (status/reset/location/service/compound filters): replace `waitForTimeout(500)` + weak `count <=` with response waits asserting the actual query params (`status=waiting`, `location_id=…`, …) and post-state assertions on rows + "N всего" server total.
- **Test 11** (sorting): strengthen — capture the request on header click, assert `sort_by=client` + `sort_order` toggling in the URL, assert row order actually changes.
- **Test 12** (pagination total): now asserts server `total`; extended — navigate to page 2 with `waitForResponse` asserting `page=2`, verify disjoint rows.
- **Test 15** (status badges): replace timeouts with response waits; keep badge assertions.
- **Tests 13/20** (date inputs / payment indicator): expected to stay green; watch item — under the new default sort `date` asc, freshly-seeded "now"-dated records land at the END of the current-week set; reworked tests must isolate their seeded records via explicit date-range narrowing/expansion (as test 11 already does), not rely on page-1 visibility luck.
- **New coverage**: pagination navigation (seed >10 records → page buttons reflect server total, page 2 disjoint); payment-column sort e2e (seed full/partial/unpaid records → assert asc order = Оплачено → Частично → Не оплачено). **Isolation mechanism for the payment-sort test (panel-required):** seed the three records on explicitly early-dated activities AND narrow the date range to exclude seed data (globalSetup wipes per-run, not per-test — seed records r1-r6/p1-p6 would otherwise pollute the absolute-order assertion); waitForResponse predicates must match on the full param set (e.g. `sort_by=payment` + `sort_order=asc`), since waitForResponse binds the FIRST matching response.
- **Schedule spec watch item**: `activity-details-modal.spec.ts` + the `openActivityDetailsModal` helper gain a response-wait on `/api/v1/records?...activity_id=...` — the modal's booking tabs now render only after that fetch resolves (previously synchronous from context). Included in "schedule specs green" (§10).

## 10. Acceptance Criteria

- [ ] `GET /api/v1/records` accepts all params in §5.1; every invalid value class → 422 (listed in §9.1).
- [ ] Date filtering is whole-day inclusive on `Activity.start` via the shared util (boundary tested at 23:30/00:00).
- [ ] Location/service/master filters operate via the Activity JOIN; status/client_id/activity_id on Record columns; all combinable; `total` = filtered count.
- [ ] All 9 sort keys work server-side incl. payment bucket; order correct across pages (disjointness tested); tiebreak `Record.id`.
- [ ] Activities: invalid date → 422 (was 500); existing date tests green; pagination duplication removed.
- [ ] RecordsContext: queryKey contains all server params; envelope cached; `total` drives pagination UI; filter/date change resets to page 1.
- [ ] RecordsTable: no client-side filter/sort/slice remains; headers and page controls wired to server; payment badges unchanged.
- [ ] Records-folder ClientCardModal + schedule ActivityDetailsModal show complete data via dedicated queries (not clipped by the current page).
- [ ] `getRecords({client_id, per_page:100})` + `['records','client',id]` behavior unchanged (clients-folder modal regression).
- [ ] Backend pytest green; admin vitest green; api-client tests green; e2e records + clients + schedule specs green; type-check clean.
- [ ] Domain rules updated at IMPL via docser (records.md: new list params incl. activity_id + correct the stale `seats == len(visits)` invariant to `seats = len(visits) + anonym_visits`; payments.md: payment-sort semantics note; activities.md: 422 behavior).

## 11. Visual Compliance Checks

- [ ] Records page renders with the same columns/rows for the default period (current week) as before
- [ ] Selecting each filter (Локация / Услуга / Мастер / Статус) updates the table with server-filtered rows and updates "N всего"
- [ ] "Сбросить" restores the full list from page 1
- [ ] Clicking each sortable header reorders rows and shows ↑/↓; "Оплата" sort orders Оплачено → Частично → Не оплачено ascending
- [ ] Pagination controls: "Строк:" selector (10/20/50/100), page-number buttons, ←/→ all functional; "N всего" equals server total; with >100 matching records all pages reachable
- [ ] Payment badges (✓ Оплачено / Частично / Не оплачено) render for the visible page
- [ ] Records-folder ClientCardModal opens from a row and shows the client's full record history
- [ ] Schedule page → activity details modal shows the activity's booking tabs
- [ ] Clients page ClientCardModal record history still works
