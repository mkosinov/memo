# Payment — Domain Rules

## Description
A Payment is a financial transaction for a Record. Payments track how much a client has paid.

## Fields
| Field | Type | Required | Min | Max | Default | Description |
|-------|------|----------|-----|-----|---------|-------------|
| record_id | string | ✅ | — | — | — | FK to Record |
| amount | integer | ✅ | >0 | — | — | Сумма в рублях |
| method | enum | ❌ | — | — | null | Способ оплаты |

## Cross-field Rules
- None.

## Invariants
- amount > 0 (enforced by Pydantic Field(gt=0))
- record_id must reference existing Record (FK enforced)
- No validation that total payments <= record price

## Business Logic

### Backend
- **Amount must be positive** (only Pydantic field-level constraint besides pagination)
- Filtered by record_id
- Soft-deactivated on Record delete (cascade)

### Frontend
- **Add payment form:** method select (card/cash/transfer) + amount input
- **Delete payment:** Direct API call
- **Financial summary:** totalPaid = sum(payment.amounts), remaining = displayTotal - totalPaid
- **No amount validation** in frontend (Zod has no min constraint)

## API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/payments?record_id=X | List by record |
| GET | /api/v1/payments/{id} | Get |
| POST | /api/v1/payments | Create |
| PUT | /api/v1/payments/{id} | Update |
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
| Backend (Pydantic) | Frontend (Zod) | Match |
|--------------------|----------------|-------|
| amount: gt=0 | amount: no constraint | ❌ Frontend missing |
| method: PaymentMethod enum | method: enum (values match) | ✅ |
