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
- **Delete:** Cascade hard-delete: Visits + Payments + record_tags join rows hard-deleted; Record row physically removed.

### Frontend
- **Phone blur auto-fill:** searchClientByPhone on blur if phone >= 10 chars
- **Default tariff:** New visitors initialized with first service tariff
- **Name required:** Toast "Заполните имя" if empty
- **Tariff required per visitor:** Toast if any visitor has no tariffId
- **Price from first visitor:** Only first visitor's tariff price used for all visits (bug)
- **Per-visit status:** UI edits `visits[].status` (waiting/visited/missed/cancelled). Record-level status updates automatically via derivation. StatusPicker used for both per-visit edit and read-only Record badge.
- **Delayed delete:** 5-second setTimeout with undo toast

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/records | List — server-side filter/sort/paginate (see [list contract](#records-list-endpoint-get-apiv1records) below) |
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
| date_to | date | — | Inclusive to-day (YYYY-MM-DD), covers through 23:59:59.999999 |
| location_id | string | — | Filter by activity's location |
| service_id | string | — | Filter by activity's service |
| master_id | string | — | Filter by activity's master |
| status | enum | — | `waiting` / `visited` / `missed` / `cancelled` |
| sort_by | enum | `date` | `date`, `client`, `service`, `master`, `location`, `guests`, `status`, `total`, `payment` |
| sort_order | enum | `asc` | `asc` / `desc` |

**Validation → 422 VALIDATION_ERROR:** invalid `status` / `sort_by` / `sort_order` enum values, `page < 1`, `per_page` outside 1–100, unparseable date strings, and `date_from > date_to` (cross-field `model_validator`). Note: `RecordListParams` is injected as a Query parameter model (`Annotated[RecordListParams, Query()]`), NOT `Depends()` — Depends-injected models combined with `model_validator` raise 500 (fastapi#4974).

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

**Pagination mechanics:** repo-owned — `BaseRepository.list_custom` (`backend/src/repositories/generic.py`) wraps the record stmt built by `RecordService.list` (JOIN `Activity` + `selectinload(Record.visits)`). Count runs on the unordered stmt via `select(func.count()).select_from(stmt.subquery())` — loader options are stripped by the subquery and the correlated sort-key subqueries are never evaluated inside the count; ORDER + LIMIT/OFFSET slice is then applied by the repo. The sort whitelist stays in `RecordService._sort_columns` (service-owned, G1a principle), which returns the ORDER BY expressions; the repo owns order/limit/offset, the service owns page↔offset conversion (`(page - 1) * per_page`) and the `PaginatedResponse` envelope. Pipeline order: Filter → Sort → Paginate; business filters are hand-written in `RecordService.list`, pagination mechanics are owned by the repo.

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
