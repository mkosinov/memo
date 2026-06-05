# Record — Domain Rules

## Description
A Record is a booking for an Activity. It links a Client to an Activity and contains Visits. Records have financial tracking (custom_price, payments). This is the most complex entity.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| activity_id | string | ✅ | — | — | — | FK to Activity |
| client_id | string | ❌ | — | — | null | FK to Client (nullable for anonymous) |
| status | enum | ❌ | — | — | pending | pending / confirmed / cancelled / no_show |
| seats | integer | ✅ | — | — | — | Computed: len(visits), never set by user |
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
- `seats` MUST equal `len(visits)` at all times
- Either `name` or `visitor_id` should be provided for each visit (or neither for anonymous)
- `custom_price` at Record level overrides sum of visit prices

## ⚠️ FUTURE REQUIREMENT: Flexible Seats
**Status:** Not implemented. Currently `seats = len(visits)` always.

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

## Business Logic

### Backend
- **Capacity check on create:** Sums all active Record.seats for the Activity. If occupied + new_seats > capacity → 409.
- **Client resolution (dual flow):**
  - Phone-based (web): find-or-create Client by phone
  - Client-ID-based (admin): link directly
- **Visitor resolution (triple flow):**
  - Name-based: find-or-create Visitor by (client_id, name)
  - ID-based: link existing Visitor
  - Anonymous: visitor is None
- **Seats = len(visits):** Always computed, never user-set
- **Create sequence:** check capacity → resolve client → resolve visitors → create Record → create Visits
- **Update (PUT):** Full replacement, old Visits soft-deactivated, new Visits created, seats recalculated. NO capacity re-check.
- **Patch:** Partial update. If visits in payload → old visits soft-deactivated, new created. NO capacity re-check.
- **Delete:** Cascade soft-delete: Visits + Payments + Record all soft-deactivated.

### Frontend
- **Phone blur auto-fill:** searchClientByPhone on blur if phone >= 10 chars
- **Default tariff:** New visitors initialized with first service tariff
- **Name required:** Toast "Заполните имя" if empty
- **Tariff required per visitor:** Toast if any visitor has no tariffId
- **Price from first visitor:** Only first visitor's tariff price used for all visits (bug)
- **Status transitions:** No restrictions in UI (all 4 options always shown)
- **Delayed delete:** 5-second setTimeout with undo toast

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/records | List (filter by client_id) |
| GET | /api/v1/records/{id} | Get with visits |
| POST | /api/v1/records | Create (capacity check) |
| PUT | /api/v1/records/{id} | Full update (visits replaced) |
| PATCH | /api/v1/records/{id} | Partial update |
| DELETE | /api/v1/records/{id} | Cascade soft-delete |

## Relationships
- Record → belongs to Activity
- Record → belongs to Client (optional)
- Record → has many Visits
- Record → has many Payments
- Record → has many Tags (M2M)

## Enums & Constants
| Enum | Values |
|------|--------|
| RecordStatus | pending, confirmed, cancelled, no_show |
| VisitStatus | waiting, visited, missed, cancelled |

## Acceptance Criteria
- [ ] Capacity check prevents overbooking on create
- [ ] seats = len(visits) always
- [ ] Client resolution works (phone-based and ID-based)
- [ ] Visitor resolution works (name-based, ID-based, anonymous)
- [ ] Delete cascades to Visits and Payments
- [ ] custom_price overrides visit prices

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| visits: required | visits: optional | ❌ |
| VisitItem has name/age | VisitItem missing name/age | ❌ |
| seats: not in schema | seats: in schema | ❌ (ignored) |
| RecordStatus enum | RecordStatus enum | ✅ |
