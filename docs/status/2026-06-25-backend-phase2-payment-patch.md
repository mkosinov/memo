# Phase 2: Payment PATCH endpoint
- **Date**: 2026-06-28
- **Branch**: feat/phase2-payment-patch
- **Status**: Completed

## Summary of Changes
- New `PaymentPatch` Pydantic schema (`backend/src/schemas/payment.py`): `amount: int | None = Field(default=None, gt=0)`, `method: PaymentMethod | None = None`. All fields optional — `None` means "don't change". Docstring documents the `amount: null` no-op behavior.
- `PaymentService` refactored from a factory-returned `GenericService` instance to a proper `PaymentService(GenericService[...])` subclass. This enables the class-level `NOT_NULL_FIELDS = {"amount"}` configuration that `GenericService.patch()` consults to strip `null` for DB NOT NULL fields.
- New endpoint `PATCH /api/v1/payments/{id}` in `backend/src/api/v1/payments.py`: delegates to inherited `service.patch()` (no service code change needed), returns 200 with `PaymentResponse` on success, 404 with `ErrorCode.PAYMENT_NOT_FOUND` if not found.
- **Contract guarantee:** `PATCH {amount: null, method: "cash"}` silently strips `amount` (the NOT NULL DB constraint would otherwise be violated). Enforced by `NOT_NULL_FIELDS` mechanism in `GenericService.patch`.
- 3 new API tests (RED→GREEN) + 3 new service unit tests (PaymentService subclass contract).

## Acceptance Criteria

| # | Criteria | Status |
|---|----------|--------|
| 21 | `PATCH /api/v1/payments/{id}` partial update: `{method: "cash"}` → method changes, amount unchanged | ✅ Done |
| 22 | `PATCH /api/v1/payments/{id}` with `{amount: null, method: "cash"}` → `amount: null` silently stripped, method changes (NOT_NULL_FIELDS contract) | ✅ Done |
| 23 | `PATCH /api/v1/payments/{nonexistent_id}` returns 404 with `PAYMENT_NOT_FOUND` code | ✅ Done |

## Test Results
- **6 new tests**: all passing
  - 3 API tests in `test_api_payments.py` (scenarios 21-23: partial update, null amount stripped, 404)
  - 3 service unit tests in `test_payment_service.py` (subclass contract: `issubclass(PaymentService, GenericService)`, `NOT_NULL_FIELDS == {"amount"}`, `get_payment_service` returns `PaymentService` instance)
- **Total backend**: 634 passed (was 628 post-Phase 1, +6 new), 4 xfailed (unchanged), 0 regressions

## Files Changed

### Source (3 modified)
| File | Change | Lines |
|------|--------|-------|
| `backend/src/schemas/payment.py` | Add `PaymentPatch` class (all fields optional `\| None = None`) | +11 |
| `backend/src/services/payment.py` | Refactor to `PaymentService(GenericService[...])` subclass with `NOT_NULL_FIELDS = {"amount"}` | +8/-2 |
| `backend/src/api/v1/payments.py` | Add `PATCH /{payment_id}` handler with 404 via `ErrorCode.PAYMENT_NOT_FOUND` | +21/-1 |

### Test (1 new + 1 modified)
| File | Change | Lines |
|------|--------|-------|
| `backend/tests/services/test_payment_service.py` | **New**: 3 unit tests for PaymentService subclass contract | +22 |
| `backend/tests/test_api_payments.py` | Add 3 API tests (scenarios 21-23) | +42 |

## Architectural Notes
- **Why `PaymentService` was refactored to a subclass:** `GenericService.patch()` consults `self.NOT_NULL_FIELDS` — a class attribute. With the old pattern (`def get_payment_service() -> GenericService: return GenericService(...)`), there was no subclass to attach `NOT_NULL_FIELDS` to, so `NOT_NULL_FIELDS` defaulted to `set()` (no protection). A `PaymentService` subclass with `NOT_NULL_FIELDS = {"amount"}` was the minimal change that keeps `GenericService` generic and doesn't require constructor injection.
- **No DB migration needed:** The endpoint is purely additive — no new columns, no new tables, no constraints changed. `alembic check` passes clean.
- **PATCH vs PUT semantic:** The existing `PUT /api/v1/payments/{id}` does a full replace (all required fields). The new `PATCH` only updates sent fields — `None` means "leave as-is".

## Multi-Phase Context
This is **Phase 2** (final) of a 3-phase plan:
- **Phase 0** (PR #117, merged): `tariff_id` round-trip — the data plumbing
- **Phase 1** (PR #118, merged): Visit CRUD endpoints + cascade to record
- **Phase 2** (this branch): Payment PATCH endpoint

## Next Steps
- Frontend refactor of `RecordVisitsTable`/`RecordPaymentsTable` to use the new direct Visit/Payment endpoints. Design spec at commit `4c031a5` (`docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md`). Deferred until all 3 backend phases ship.

## References
- **GitHub Issue**: GH-104 (foundation)
- **Design Spec**: `docs/specs/2026-06-25-backend-visit-payment-api-design.md`
- **Plan**: `docs/plans/2026-06-25-backend-visit-payment-api.md`
- **PR**: _(to be added after PR creation)_
