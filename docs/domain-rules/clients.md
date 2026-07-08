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
- Stats (visits_count, total_paid, etc.) are computed, not stored

## Business Logic

### Backend
- **Phone search:** `GET /clients/search?phone=X` — exact match, returns first result or 404
- **Stats aggregation:** visits_count, last_visit, total_paid, missed_visits — computed on list
- **`last_visit`** = `MAX(Activity.start)` over all `Visit` rows where `Visit.status = 'visited'` AND `Record.is_active = True` (i.e. attended visits on active records). `null` if the client has never attended. Implemented as a correlated scalar subquery in `ClientService` (`last_visit_sq`).
- **`last_record_activity`** (upcoming booking): *not implemented yet* — tracked in #133. Would be `MIN(Activity.start)` over active records where `Activity.start > now()`. Distinct from `last_visit`: a client may have a `last_visit` in the past AND a `last_record_activity` in the future.
- **Filters:** search (ILIKE on name/phone), date ranges, visit count ranges, payment ranges
- **Sort columns:** name, visits_count, last_visit, total_paid, missed_visits, created_at, updated_at
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
