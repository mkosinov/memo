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
- Soft-deactivated on Record delete (cascade)

### Frontend
- **Add payment form:** datetime-local input (auto-filled with now, editable) + method select (card/cash/transfer/online) + amount input
- **Amount > 0 guard:** frontend validates `amount > 0` before sending POST/PATCH. On violation: shows error toast "Сумма должна быть больше 0" and does NOT send the request. Matches backend `gt=0` constraint.
- **Delete payment:** Direct API call
- **Financial summary:** totalPaid = sum(payment.amounts), remaining = displayTotal - totalPaid

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/payments?record_id=X | List by record |
| GET | /api/v1/payments/{id} | Get |
| POST | /api/v1/payments | Create (body: `record_id`, `amount` gt=0, `method?`, `created_at?` datetime) |
| PUT | /api/v1/payments/{id} | Update (full replace) |
| PATCH | /api/v1/payments/{id} | Partial update (PaymentPatch: `amount?` gt=0, `method?`) → PaymentResponse |
| DELETE | /api/v1/payments/{id} | Soft delete |

## Relationships
- Payment → belongs to Record

## Enums & Constants
| Enum | Values |
|------|--------|
| PaymentMethod | cash, card, transfer |

## Acceptance Criteria
- [ ] Amount > 0
- [ ] Method is valid enum value
- [ ] Cascade soft-delete with Record

## Parity Notes
| Backend (Pydantic) | Frontend | Match |
|--------------------|----------|-------|
| amount: gt=0 | amount: explicit `> 0` check with error toast (both POST and PATCH paths) | ✅ |
| method: PaymentMethod enum | method: enum (values match) | ✅ |
| created_at: optional datetime | datetime-local input (auto-filled, editable, sent as ISO 8601) | ✅ |
