# Payment — Domain Rules

## Description
A Payment is a financial transaction for a Record. Payments track how much a client has paid.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| record_id | string | ✅ | — | — | — | FK to Record |
| amount | integer | ✅ | >0 | — | — | Сумма в рублях |
| method | enum | ❌ | — | — | null | Способ оплаты |
| created_at | datetime | ❌ | — | — | now() | Дата создания (client-supplied; если omitted, service defaults to now) |

## Cross-field Rules
- None.

## Invariants
- amount > 0 (enforced by Pydantic Field(gt=0))
- record_id must reference existing Record (FK enforced)
- No validation that total payments <= record price

## Business Logic

### Backend
- **Amount must be positive** (Pydantic `Field(gt=0)` — enforced on both POST and PATCH)
- **Optional `created_at`** on POST: client may supply a timestamp (e.g. from an editable datetime-local input); if omitted, the service defaults to `datetime.now()`. This allows backdating payments.
- Filtered by record_id
- Hard-deleted on Record delete (cascade)

### Frontend
- **Add payment form:** datetime-local input (auto-filled with now, editable) + method select (card/cash/transfer/online) + amount input
- **Amount > 0 guard:** frontend validates `amount > 0` before sending POST/PATCH. On violation: shows error toast "Сумма должна быть больше 0" and does NOT send the request. Matches backend `gt=0` constraint.
- **Delete payment:** Direct API call
- **Financial summary:** totalPaid = sum(payment.amounts), remaining = displayTotal - totalPaid

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/payments/totals?record_ids=... | Batch aggregate — per-record SUM(amount) for given record IDs |
| GET | /api/v1/payments?record_id=X | List by record |
| GET | /api/v1/payments/{id} | Get |
| POST | /api/v1/payments | Create (body: `record_id`, `amount` gt=0, `method?`, `created_at?` datetime) |
| PUT | /api/v1/payments/{id} | Update (full replace) |
| PATCH | /api/v1/payments/{id} | Partial update (PaymentPatch: `amount?` gt=0, `method?`) → PaymentResponse |
| DELETE | /api/v1/payments/{id} | Hard delete |

### Batch Aggregate Endpoint: `GET /api/v1/payments/totals`

**Purpose:** Batch aggregate of payment amounts per record — used by the Records page to derive per-record payment status (оплачено/частично/не оплачено) and sorting-by-payment, and by ClientCardModal for per-record statuses in the client history.

**Contract:**
- `record_ids` — repeated query param, e.g. `?record_ids=a&record_ids=b&...`
- Cardinality cap: **max 200** IDs (page-sized sets are ≤100 after #182). Over cap → **422**.
- Empty list (`?record_ids=` with no values) → **200** `{"totals": {}}` (defensive — frontend skips request when no visible records).
- Response: `{"totals": {"<record_id>": <sum_amount>, ...}}` — computed via SQL `WHERE record_id IN (...) GROUP BY record_id` with `SUM(amount)`.
- Records with **no payments** are absent from the map. Frontend treats missing key as 0 → "Не оплачено".

**Hard-delete note:** Payments in this codebase are **hard-deleted** (row physically removed; migration `a1b2c3d4e5f6` dropped the legacy flag column). The aggregate sums all payment rows for the given record IDs with no inactive filter. The caller (RecordsContext) only ever passes IDs of records it has loaded.

**Route-ordering invariant (critical):** The `/totals` route MUST be declared BEFORE `GET /payments/{payment_id}` in the router file. FastAPI resolves static routes before path params only if declared first. See `backend/src/api/v1/payments.py`.

**Implementation pattern:** Module-level async function `get_payment_totals(session, record_ids)` in `backend/src/services/payment.py` — NOT a `PaymentService` class method, NOT via generic repository filters.

**Tests:** 5 backend API tests (multiple records, record without payments, empty record_ids → 200 `{}`, over-cap → 422, mixed results). 1 regression guard test with >100 payments in DB (backend). Frontend tests for RecordsContext totals wiring, RecordsTable status/sort, ClientCardModal per-record statuses.

## Relationships
- Payment → belongs to Record

## Enums & Constants
| Enum | Values |
|------|--------|
| PaymentMethod | cash, card, transfer |

## Acceptance Criteria
- [ ] Amount > 0
- [ ] Method is valid enum value
- [ ] Cascade hard-delete with Record

## Parity Notes
| Backend (Pydantic) | Frontend | Match |
|--------------------|----------|-------|
| amount: gt=0 | amount: explicit `> 0` check with error toast (both POST and PATCH paths) | ✅ |
| method: PaymentMethod enum | method: enum (values match) | ✅ |
| created_at: optional datetime | datetime-local input (auto-filled, editable, sent as ISO 8601) | ✅ |
