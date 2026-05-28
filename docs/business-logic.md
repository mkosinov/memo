# Business Logic — Colour Mountains Studio Manager

> Technical decisions document based on business logic.
> Created: 2026-05-17

## 1. Visit and Booking Statuses

### Visitor Status

| enum | Display | Meaning |
|------|---------|---------|
| `WAITING` | Waiting | Default. Visit confirmed but not yet occurred |
| `VISITED` | Visited | Client attended the class |
| `MISSED` | Missed | Client did not show up (NO_SHOW) |
| `CANCELLED` | Cancelled | Visit cancelled before the class |

**Stored in:** `Visit.status: VisitorStatus`

### Record Status

Derived from visit statuses automatically. Not stored separately in the DB,
but may be materialized (pre-computed) for performance:

| Rule | RecordStatus |
|------|-------------|
| All visits `CANCELLED` | `CANCELLED` |
| At least one visit `VISITED` | `VISITED` |
| No `VISITED`, at least one `WAITING` or `MISSED` | `MISSED` |
| All visits `WAITING` | `WAITING` |

**Priority:** `CANCELLED` > `VISITED` > `MISSED` > `WAITING`

Computation logic:
```
if all Visit.status === CANCELLED → RecordStatus = CANCELLED
if at least one Visit.status === VISITED → RecordStatus = VISITED
if all Visit.status === MISSED or (MISSED + CANCELLED) → RecordStatus = MISSED
else → RecordStatus = WAITING
```

## 2. Payment

| Status | Condition |
|--------|-----------|
| Paid | Sum of all `Payment.amount` (where `paid=true`) ≥ total cost of visits |
| Partial | 0 < paid < total cost |
| Unpaid | No payments or sum of `paid` = 0 |

## 3. Booking (Booking Flow — Philosophy)

- A Record groups multiple visitors (Visit) into one class (Activity)
- Each record has a client (Client) — the responsible person
- Visitors are people who will physically attend the class
- Primary visitor (isPrimary) — the one who pays (usually the client or a parent)

## 4. Pricing

_To be completed in P3 (Client Booking Flow)_

- Base price depends on age (adult/child)
- Individual class — fixed price (defaultIndividualPrice)
- Package discounts — not implemented
