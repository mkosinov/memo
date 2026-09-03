# Record — Domain Rules

## Description
A Record is a booking for an Activity. It links a Client to an Activity and contains Visits. Records have financial tracking (custom_price, payments). This is the most complex entity.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| activity_id | string | ✅ | — | — | — | FK to Activity |
| client_id | string | ❌ | — | — | null | FK to Client (nullable for anonymous) |
| status | enum | ❌ | — | — | waiting | **DERIVED** from VisitStatus (see [RecordStatus derivation](#recordstatus-derivation)). Same enum as VisitItem.status: waiting / visited / missed / cancelled |
| seats | integer | ✅ | — | — | — | Computed: len(visits) + anonym_visits, never set by user |
| anonym_visits | integer | ❌ | — | — | 0 | Number of "anonymous" seats (no visitor assigned). Adds to seats count without a Visit row. Used for "walk-ins" / phone reservations. |
| comment | string | ❌ | — | — | null | Комментарий |
| custom_price | integer | ❌ | — | — | null | Override price (replaces sum of visit prices) |
| visits | array | ✅ | — | — | — | List of VisitItems |

## VisitItem (nested in Record)
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | ❌ | Visitor name (for find-or-create) |
| age | integer | ❌ | Visitor age |
| visitor_id | string | ❌ | FK to existing Visitor |
| price | integer | ✅ | Price from tariff |
| custom_price | integer | ❌ | Override price for this visit |
| status | enum | ❌ | waiting / visited / missed / cancelled (default: waiting) |

## Cross-field Rules
- `seats` MUST equal `len(visits) + anonym_visits` at all times (recomputed via `recompute_record_seats()` in `src/domain/record_visits.py`)
- Either `name` or `visitor_id` should be provided for each visit (or neither for anonymous)
- `custom_price` at Record level overrides sum of visit prices

## ⚠️ FUTURE REQUIREMENT: Flexible Seats
**Status:** Not implemented. Currently `seats = len(visits) + anonym_visits` always.

**Planned behavior (hybrid):**
- User can EITHER specify `seats` count manually OR add visitors one by one
- If seats specified without visitors → system creates empty Visit slots
- If visitors added without seats → seats auto-calculated as `len(visits)`
- This allows booking "I need 3 seats" without knowing who the visitors are yet

**Impact on API:**
- `RecordCreate.seats` should become optional (currently not in schema)
- Backend should handle: `seats` provided but `visits` empty → create placeholder visits
- Backend should handle: `visits` provided but `seats` not → compute seats from visits

## ⚠️ FUTURE REQUIREMENT: Create Booking Without Name
**Status:** Not implemented. Currently name is required (toast "Заполните имя").

**Planned behavior:**
- Allow creating Record with null name (anonymous client)
- Client name can be filled later
- Backend already supports nullable name on Client

**Impact:**
- Frontend: Remove required validation on name in NewBookingTab
- Backend: No changes needed (Client.name already nullable)

## ⚠️ FUTURE REQUIREMENT: Create Booking Without Phone
**Status:** Partially implemented. Phone is optional but client creation requires a name.

**Planned behavior:**
- Allow creating Record without phone AND without name
- System creates anonymous Client with no contact info
- Client can be linked later

**Impact:**
- Frontend: Allow submit even when both name and phone are empty
- Backend: No changes needed (Client fields all nullable)

## Invariants
- Capacity check: `occupied + seats <= activity.capacity` (on create only)
- Activity must exist and be active (FK enforced)
- Client is optional (anonymous booking possible)
- **Record.status === derived from VisitItems.status** (see below). Record status is NEVER set independently.

## RecordStatus derivation

`Record.status` is **always computed** from the statuses of its `VisitItem`s. The Record has no user-editable status field; the user edits per-visit statuses (or `anonym_visits` slots) and the Record status updates automatically.

| Condition | Record.status |
|-----------|---------------|
| At least 1 visit with `status = 'visited'` | `visited` |
| 0 visits with `'visited'` AND all visits are `'missed'` | `missed` |
| 0 visits with `'visited'` AND all visits are `'cancelled'` | `cancelled` |
| Otherwise (any visit is `'waiting'`, or mixed waiting/other) | `waiting` |

**Algorithm (priority order):**
1. If `any(visit.status == 'visited')` → `'visited'`
2. Else if `len(visits) > 0 AND all(v.status == 'missed' for v in visits)` → `'missed'`
3. Else if `len(visits) > 0 AND all(v.status == 'cancelled' for v in visits)` → `'cancelled'`
4. Else → `'waiting'`

**Edge cases:**
- Record with **0 visits** (only `anonym_visits` slots): status = `'waiting'` (no derivation possible)
- Record with **1 visit**: status = that visit's status
- Mixed (e.g. 2 visited + 1 waiting): status = `'visited'` (rule 1 wins)

**Why derived, not stored:** A Record is just a container for Visits. Its status is a **summary** of visitor attendance, not an independent state. Storing it independently creates drift (e.g. user cancels Record but a Visit says 'visited').

**API contract:**
- POST/PUT/PATCH `Record` payload does NOT accept `status` field — server returns 422 if provided
- GET `Record` response includes `status` (derived, read-only) for UI convenience
- The UI can edit `visits[].status` (and `anonym_visits` slots) but never the Record-level status

**UI implication:**
- One `StatusPicker` component, one `VISIT_STATUS_CONFIG` (waiting/visited/missed/cancelled) — used both for per-visit edits AND for the read-only Record-level badge
- No second `RecordStatus` enum or `RECORD_STATUS_CONFIG` — single source of truth

## Business Logic

### Backend
- **Capacity check on create:** Sums all active Record.seats for the Activity via `check_activity_capacity()` / `active_record_filter()`. If occupied + new_seats > capacity → 409. The "active" filter is `Record.status IN ('waiting','visited')` — cancelled and missed records free their seats. Single source of truth: `ACTIVE_RECORD_STATUSES` constant in `src/domain/visit_status.py`, reused by both the booking guard and `ActivityService.sum_active_seats`.
- **Client resolution (dual flow):**
  - Phone-based (web): find-or-create Client by phone
  - Client-ID-based (admin): link directly
- **Visitor resolution (triple flow):**
  - Name-based: find-or-create Visitor by (client_id, name)
  - ID-based: link existing Visitor
  - Anonymous: visitor is None
- **Seats = len(visits) + anonym_visits:** Always computed — `recompute_record_seats()` recalculates on create/update/patch; never user-set
- **Create sequence:** check capacity → resolve client → resolve visitors → create Record → create Visits
- **Update (PUT):** Full replacement, old Visits soft-deactivated, new Visits created, seats recalculated. NO capacity re-check.
- **Patch:** Partial update. If visits in payload → old visits soft-deactivated, new created. NO capacity re-check.
- **Delete:** Two-phase hard delete (Addendum 13 / GH #139): bare DELETE is a dry-run — 204 when no deps, 409 + dependency tree when deps exist; second DELETE with `{resolutions}` body executes the cascade hard-delete (Visits + Payments + record_tags join rows hard-deleted; Record row physically removed). Deps: visits/payments cascade (auto=False, user must resolve), record_tags cascade (auto=True, resolved server-side).
- **Delayed delete:** REMOVED (Addendum 13) — the old 5-second setTimeout + undo toast was replaced by the DeleteDialog dry-run flow (explicit confirmation, no undo).

### Frontend
- **Phone blur auto-fill:** `getClientByPhone` on blur if phone >= 10 chars (api-client fn; backend route is `GET /api/v1/clients/get?phone=` — GH #212, was `searchClientByPhone` + `/clients/search?phone=`)
- **Default tariff:** New visitors initialized with first service tariff
- **Name required:** Toast "Заполните имя" if empty
- **Tariff required per visitor:** Toast if any visitor has no tariffId
- **Price from first visitor:** Only first visitor's tariff price used for all visits (bug)
- **Per-visit status:** UI edits `visits[].status` (waiting/visited/missed/cancelled). Record-level status updates automatically via derivation. StatusPicker used for both per-visit edit and read-only Record badge.
- **Delete flow (Addendum 13):** shared unbound `useDeleteRecord` hook (hooks/useDeleteRecord.ts) — dry-run `deleteRecord(id)`; on 409 parks `dependencies` → DeleteDialog (entityType "record"); on confirm → `resolveDeleteRecord(id, resolutions)`; on success toast «Запись удалена» + invalidations `['records']` prefix + `['record', id]` + `['visitors']`. No optimistic removal before confirmation.

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/records | List — server-side filter/sort/paginate + `?q=` substring search (GH #212, client.name/phone/email + service.title + id) — see [list contract](#records-list-endpoint-get-apiv1records) below |
| GET | /api/v1/records/view | Records-table view lookup (GH #213) — same params/sort as list + 8 display columns — see [view contract](#records-view-endpoint-get-apiv1recordsview) below |
| GET | /api/v1/records/{id} | Get with visits |
| POST | /api/v1/records | Create (capacity check) |
| PUT | /api/v1/records/{id} | Full update (visits replaced) |
| PATCH | /api/v1/records/{id} | Partial update |
| DELETE | /api/v1/records/{id} | Cascade hard-delete (visits + payments + record_tags cleaned) |

### Records list endpoint (GET /api/v1/records)

**Purpose:** The Records page list is fully **server-side** (#191): filters, sorting, and pagination are applied in SQL, not on the client. Returns the standard `PaginatedResponse<RecordResponse>` envelope `{items, total, page, per_page}` with nested `visits`.

**Query params** (FastAPI Query parameter model `RecordListParams`; all optional except as noted):

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | int | 1 | 1-based page number (`ge=1`) |
| per_page | int | 20 | Page size, 1–100 (`ge=1`, `le=100`) |
| client_id | string | — | Filter by client FK |
| activity_id | string | — | Filter by activity FK |
| date_from | date | — | Inclusive from-day (YYYY-MM-DD), covers from 00:00:00 |
| date_to | date | — | Inclusive to-day (YYYY-MM-DD), covers through 23:59:59.999999. Overflow-free, no year-9999 edge case; same idiom as the `created_*` filters in client.py. |
| location_id | string | — | Filter by activity's location |
| service_id | string | — | Filter by activity's service |
| master_id | string | — | Filter by activity's master |
| status | enum | — | `waiting` / `visited` / `missed` / `cancelled` |
| q | string | — | Substring search (GH #212) — `min_length=2` / `max_length=100` → else **422 VALIDATION_ERROR**. Substring fields: `client.name`, `client.phone`, `client.email`, `service.title` (via LEFT OUTER joins, both added ONLY when `q` is present). Plus exact `Record.id` match when `q` is a full 36-char UUID. See "List `?q=`" below. |
| sort_by | enum | `date` | `date`, `client`, `service`, `master`, `location`, `guests`, `status`, `total`, `payment` |
| sort_order | enum | `asc` | `asc` / `desc` |

**Validation → 422 VALIDATION_ERROR:** invalid `status` / `sort_by` / `sort_order` enum values, `page < 1`, `per_page` outside 1–100, unparseable date strings, `q` outside 2–100 chars, and `date_from > date_to` (cross-field `model_validator`). Note: `RecordListParams` is injected as a Query parameter model (`Annotated[RecordListParams, Query()]`), NOT `Depends()` — Depends-injected models combined with `model_validator` raise 500 (fastapi#4974).

**List `?q=` (server `?q=`, GH #212):** the `q` param is declared on `RecordListParams` with `min_length=2` / `max_length=100` via Pydantic `Field`. Substring search over the linked client's `name`/`phone`/`email` and the activity's `service.title`, plus exact `Record.id` equality when `q` parses as a full UUID. Both the `Client` and `Service` joins (LEFT OUTER, since `client_id` is nullable for anonymous records) are added ONLY when `q` is present — the default query plan is unchanged for the no-`q` case. The `q` predicate lands BEFORE the COUNT via `BaseRepository.list_custom`, so `total` reflects the q-filtered set. Searchable fields per the `RecordService.search_fields` matrix:

| Field | Kind | Source |
|-------|------|--------|
| `Client.name` | substring | LEFT OUTER join on `Record.client_id == Client.id` |
| `Client.phone` | substring | same join |
| `Client.email` | substring | same join |
| `Service.title` | substring | LEFT OUTER join on `Activity.service_id == Service.id` (Activity is already INNER-joined for date/filters/sorts; the Service join reuses it) |
| `Record.id` | uuid | exact equality when `q` is a full 36-char UUID (case-normalized lowercase) |

A partial id fragment (e.g. first 8 chars) NEVER matches by id. The `q` predicate is case-insensitive and Cyrillic-safe via the SQLite `lower()` override in `src/db/database.py` (M5).

**Date-range semantics:** `date_from` / `date_to` filter on `Activity.start` via the shared `day_range()` util in `backend/src/domain/dates.py` — whole-day inclusive via `datetime.combine(date, time.min / time.max)`: `date_from` covers from 00:00:00, `date_to` through 23:59:59.999999 (overflow-free, no year-9999 edge case; same idiom as the `created_*` filters in client.py).

**Sort semantics (server-side whitelist map):** `RecordService._sort_columns()` builds ORDER BY expressions from a dict keyed by `sort_by`; the key is Literal-validated upstream, so a missing key is impossible. Keys referencing related entities use **correlated scalar subqueries** (mirrors the deleted client-side comparator; note SQLite BINARY collation ≠ JS `localeCompare`):

| sort_by | ORDER BY expression |
|---------|---------------------|
| date | `Activity.start` |
| client | `Client.name` (correlated subquery on `Record.client_id`) |
| service | `Service.title` (correlated subquery on `Activity.service_id`) |
| master | `Master.last_name, Master.first_name` |
| location | `Location.name` (correlated subquery on activity) |
| guests | `Record.seats - Record.anonym_visits` (live visits count) |
| status | `Record.status` |
| total | `SUM(Visit.price)` (coalesced to 0) |
| payment | 3-level bucket over paid vs total — see [payments.md](payments.md) |

**Null ordering + tiebreak:** `asc` → `NULLS FIRST`, `desc` → `NULLS LAST` (matters for `client` — anonymous records have no Client row); a deterministic `Record.id asc()` tiebreak guarantees cross-page stability.

**Pagination mechanics:** repo-owned — `BaseRepository` (`backend/src/repositories/generic.py`) exposes a three-method read family (GH #213 §5.1): `list` (generic path, unchanged), `list_custom` — **the row-tuple core** — and `list_entity` (the entity-only wrapper). `list_custom` accepts ANY service-built `stmt` and returns `(rows: list[Row], total)`: declared row shape, `result.all()`, NO projection; the count runs on the loader-stripped UNordered subquery (`select(func.count()).select_from(stmt.subquery())` — loader options are stripped and correlated sort-key subqueries are never evaluated inside the count), then ORDER + LIMIT/OFFSET are applied by the repo via `order_by=` / `limit=` / `offset=` parameters. `list_entity` (TypeVar `ModelT`) accepts ONLY `Select[tuple[ModelT]]` and takes over the old `list_custom` entity role — a thin wrapper (`rows, total = await list_custom(...); return [row[0] for row in rows], total`); the TypeVar is mypy honesty, so a multi-column select (e.g. the `/view` display columns) must NOT typecheck against it. Consumers: `RecordService.list` and `ActivityService.list` ride `list_entity`; `RecordService.list_view` and `PhotoService.list` ride the `list_custom` row core (see [photos.md](photos.md)). The sort whitelist stays in `RecordService._sort_columns` (service-owned, G1a principle), which returns the ORDER BY expressions; the repo owns order/limit/offset, the service owns page↔offset conversion (`(page - 1) * per_page`) and the `PaginatedResponse` envelope. Pipeline order: Filter → Sort → Paginate; business filters are hand-written in `RecordService._build_list_stmt`, pagination mechanics are owned by the repo.

### Records view endpoint (GET /api/v1/records/view)

**Purpose:** one request returning everything the records TABLE renders (GH #213 display-lookup composite).

**Query params:** IDENTICAL to `GET /api/v1/records` — the same `RecordListParams` class (single class, single injection idiom `Annotated[RecordListParams, Query()]` → no param drift possible). Same validation → same 422 VALIDATION_ERROR matrix. Same `_sort_columns` whitelist — sorting order is shared, guaranteeing sort parity with `/records`.

**Response:** `PaginatedResponse[RecordViewResponse]` — `{items, total, page, per_page}`. `RecordViewResponse` inherits `RecordResponse` (id, activity_id, client_id, status, seats, anonym_visits, comment, custom_price, created_at, updated_at, visits[]) and adds 8 display fields:

| Field | Type | Source | Null when |
|-------|------|--------|-----------|
| `client_name` | `str \| None` | `Client.name` via `Record.client_id` (correlated scalar subquery) | anonymous record (client_id null) |
| `activity_start` | `str \| None` | `Activity.start` direct column (already INNER-joined). ISO datetime serialized EXACTLY as `ActivityResponse.start` — byte-parity is load-bearing for `parseActivityStart`/`formatDateRu` | never in practice (FK enforced); nullable for safety |
| `is_private` | `bool` | `Activity.is_private` direct column (no subquery) | never (INNER join) |
| `service_title` | `str \| None` | `Service.title` via `Activity.service_id` (correlated scalar subquery) | service deleted/missing |
| `master_name` | `str \| None` | `Master.last_name \|\| ' ' \|\| Master.first_name` — «Фамилия Имя», byte-identical to `displayMasterName` | activity has no master |
| `location_name` | `str \| None` | `Location.name` via `Activity.location_id` (correlated scalar subquery) | activity has no location |
| `master_color` | `str \| None` | `Master.color` (correlated scalar subquery) | no master |
| `paid` | `int` (NOT nullable, default 0) | `COALESCE(SUM(Payment.amount), 0)` over the record's stored Payment rows — hard-deleted payments are physically gone and contribute 0 (`get_payment_totals` semantics) | never — 0 when no payments |

**Archived resolution:** the display subqueries carry NO `is_active` filter — archived clients/masters/services/locations still resolve their names. Deleted entities (FK-dangling) → `null` → the client renders `'—'` / gray dot `#999`.

**Route order:** `/view` MUST be declared BEFORE `/{record_id}` in records.py — FastAPI matches in declaration order, otherwise `/view` is captured by the id path param and returns 422.

**Implementation:** `RecordService.list_view()` shares `_build_list_stmt` with `list()` (same filters, `q` predicates, `selectinload(Record.visits)`) and adds the display fields as 8 labeled select columns; the row-tuple result rides `BaseRepository.list_custom` (see Pagination mechanics above). Base fields map via `_map_record` on the ORM entity in `row[0]`; `visits` come from that entity (`selectinload` populates it regardless of extra select columns).

## Relationships
- Record → belongs to Activity
- Record → belongs to Client (optional)
- Record → has many Visits
- Record → has many Payments
- Record → has many Tags (M2M)

## Enums & Constants
| Enum | Values | Source of truth |
|------|--------|-----------------|
| **VisitStatus** (used at BOTH visit and record level) | `waiting`, `visited`, `missed`, `cancelled` | `@memo/domain` |
| ~~RecordStatus (old: pending/confirmed/cancelled/no_show)~~ | ❌ Deprecated — DO NOT USE | Wave 5 implementation drift, see [RecordStatus derivation](#recordstatus-derivation) |

**Single enum: `VisitStatus`.** Record status is a derived field that mirrors the same values. There is no separate `RecordStatus` enum anywhere in code, schema, or API.

## Acceptance Criteria
- [ ] Capacity check prevents overbooking on create
- [ ] seats = len(visits) + anonym_visits always
- [ ] Client resolution works (phone-based and ID-based)
- [ ] Visitor resolution works (name-based, ID-based, anonymous)
- [ ] Delete cascades to Visits and Payments
- [ ] custom_price overrides visit prices
- [ ] Record.status is derived from VisitItems.status (never stored, never set by user)
- [ ] API rejects Record payloads with `status` field (422)
- [ ] Record with 0 visits → status = 'waiting'

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| visits: required | visits: optional | ❌ |
| VisitItem has name/age | VisitItem missing name/age | ❌ |
| seats: not in schema | seats: in schema | ❌ (ignored) |
| **Record.status: derived, no input field** | **Record.status: derived, no input field** | ✅ (after migration) |
| VisitStatus enum (waiting/visited/missed/cancelled) | VisitStatus enum | ✅ |
| ~~RecordStatus enum (pending/confirmed/...)~~ | ~~RecordStatus enum~~ | ❌ MIGRATION NEEDED |
