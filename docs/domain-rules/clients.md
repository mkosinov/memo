# Client — Domain Rules

## Description
A Client is a customer who books master classes. All fields are nullable — a Client can exist with no name, no phone, no email. Clients are soft-deleted (archived).

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| name | string | ❌ | — | 200 | null | Имя клиента |
| phone | string | ❌ | — | 20 | null | Телефон (format not enforced) |
| email | string | ❌ | — | 255 | null | Email (format not enforced) |
| channel | enum | ❌ | — | — | null | telegram / whatsapp / max |

## Cross-field Rules
- None. All fields are independent.

## Invariants
- Client can exist with all null fields
- No uniqueness constraint on phone (duplicates possible)
- Stats (records_count, total_paid, etc.) are computed, not stored

## Business Logic

### Backend
- **Phone search:** `GET /clients/search?phone=X` — exact match, returns first result or 404
- **Stats aggregation:** records_count, last_record, total_paid, missed_records — computed on list
- **`last_record`** = `MAX(Activity.start)` over all active Records of this client (NO status filter — includes cancelled/missed/waiting). Shows the latest activity date among all records the client was booked for. `null` if the client has no active records. Implemented as a correlated scalar subquery in `ClientService` (`last_record_sq`). NOTE: prior to #131 this was called `last_visit` and filtered by `Visit.status='visited'`.
- **`missed_records`** = `COUNT(Record.id) WHERE Record.status='missed' AND Record.is_active=True` (relies on persisted `Record.status` — see `compute_record_status` in `docs/domain-rules/records.md`). Rule: priority visited > missed > cancelled > waiting. A record with 1 visited + 1 missed visit → `Record.status='visited'` → NOT counted in `missed_records`.
- **`last_record_activity`** (upcoming booking): *not implemented yet* — tracked in #133. Would be `MIN(Activity.start)` over active records where `Activity.start > now()`. Distinct from `last_record`: a client may have a `last_record` in the past AND a `last_record_activity` in the future.
- **Filters:** search (ILIKE on name/phone), date ranges, record count ranges (`min_records`/`max_records`), missed ranges (`missed_from`/`missed_to`), payment ranges (`min_paid`/`max_paid`)
- **Sort columns:** name, records_count, last_record, total_paid, missed_records, created_at, updated_at
- **Pagination:** page (default 1), per_page (default 20, max 100)

### Frontend
- **No required fields** on create/edit
- **Channel select:** telegram, whatsapp, max (free-form string in frontend)
- **Dirty-check:** hasChanges boolean, Save/Cancel buttons disabled when !hasChanges
- **Empty display:** Name → "Дорогой гость", Phone → "Не указан"

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/clients | List with pagination, filters, sorting |
| GET | /api/v1/clients/search?phone=X | Search by phone |
| GET | /api/v1/clients/{id} | Get with stats |
| POST | /api/v1/clients | Create |
| PUT | /api/v1/clients/{id} | Full update |
| PATCH | /api/v1/clients/{id} | Partial update |
| DELETE | /api/v1/clients/{id} | Soft delete |
| GET | /api/v1/clients/{id}/visitors | List client's visitors |

## Relationships
- Client → has many Visitors
- Client → has many Records
- Client → has many Tags (M2M)

## Enums & Constants
| Enum | Values |
|------|--------|
| Channel | telegram, whatsapp, max |

## Acceptance Criteria
- [ ] All fields nullable
- [ ] Phone search returns exact match
- [ ] Stats computed correctly
- [ ] Soft delete preserves related entities

## Parity Notes
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| All fields optional | All fields optional | ✅ |
| channel: Channel enum | channel: string | ⚠️ Frontend doesn't enforce enum |
| name: str \| None | name: string (optional) | ⚠️ Empty string vs null |
