# Phase 1: Visit CRUD + cascade to record (seats + status)
- **Date**: 2026-06-28
- **Branch**: feat/phase1-visit-crud
- **Status**: Completed

## Summary of Changes
- New `domain/record_visits.py` with 3 free functions: `recompute_record_seats`, `recompute_record_status`, `check_activity_capacity`. These form a single source of truth for aggregate invariants used by both `VisitService` and `RecordService`.
- `VisitService` gains 5 CRUD methods (`list`, `create`, `update`, `patch`, `delete`). Existing `update_status` refactored to use `recompute_record_status`; `_derive_record_status` private method removed.
- `RecordService` refactored: `create`/`update`/`patch` now call free functions; `_check_capacity` removed (replaced by `check_activity_capacity`).
- Router gains 5 new handlers: `GET /api/v1/visits` (list), `POST /api/v1/visits` (create, 201), `PUT /api/v1/visits/{id}` (full replace), `PATCH /api/v1/visits/{id}` (partial), `DELETE /api/v1/visits/{id}` (soft-delete, 204).
- Pydantic schemas added: `VisitBase`, `VisitCreate`, `VisitUpdate`, `VisitPatch`.
- Cascade behavior: create visit → `record.seats` +1 + `record.status` re-derived; soft-delete → `record.seats` -1 + `record.status` re-derived; patch → only `record.status` re-derived (seats unchanged). Capacity check enforced on create (409 `ACTIVITY_AT_CAPACITY`).
- Simplified `get_visit_service` DI: `VisitService()` has no constructor deps — no chained `Depends` in the router.

## Acceptance Criteria

| # | Criteria | Status |
|---|----------|--------|
| 5 | `POST /api/v1/visits` creates a visit, returns 201 with `VisitResponse` | ✅ Done |
| 6 | `POST /api/v1/visits` with missing `record_id` returns 422 | ✅ Done |
| 7 | `POST /api/v1/visits` with nonexistent `record_id` returns 404 `RECORD_NOT_FOUND` | ✅ Done |
| 8 | `GET /api/v1/visits` lists all active visits | ✅ Done |
| 9 | `GET /api/v1/visits?record_id=` filters by record | ✅ Done |
| 10 | `PATCH /api/v1/visits/{id}` partial update (only sent fields change) | ✅ Done |
| 11 | `PATCH /api/v1/visits/{id}` with `status` change cascades to `record.status` | ✅ Done |
| 12 | `DELETE /api/v1/visits/{id}` soft-deletes (is_active=false) and cascades to record | ✅ Done |
| 13 | `GET /api/v1/visits/{nonexistent_id}` returns 404 `VISIT_NOT_FOUND` | ✅ Done |
| 14 | `PUT /api/v1/visits/{id}` full-replace update works | ✅ Done |
| 15 | Existing `PUT /api/v1/visits/{id}/status` still works (regression check) | ✅ Done |
| 16 | `POST /api/v1/visits` cascades to `record.seats` (+1) | ✅ Done |
| 17 | `DELETE /api/v1/visits/{id}` cascades to `record.seats` (-1) | ✅ Done |
| 18 | `PATCH /api/v1/visits/{id}` does NOT change `record.seats` | ✅ Done |
| 19 | `POST /api/v1/visits` rejects with 409 `ACTIVITY_AT_CAPACITY` when capacity exceeded | ✅ Done |
| 20 | `POST /api/v1/visits` with nonexistent `record_id` returns 404 `RECORD_NOT_FOUND` | ✅ Done |

## Test Results
- **33 new tests**: all passing
  - 21 API tests in `test_api_visits.py` (scenarios 5-20 + extras: negative price, soft-flag-in-db, all 404 variants)
  - 4 domain unit tests in `test_record_visits.py` (free functions: seats count, status derivation, capacity pass/raise)
  - 8 service unit tests in `test_visit_service.py` (CRUD methods + get + filter)
- **Total backend**: 628 passed (was 595, +33 new), 4 xfailed (unchanged), 0 regressions

## Files Changed

### Source (1 new + 5 modified)
| File | Change | Lines |
|------|--------|-------|
| `backend/src/domain/record_visits.py` | **New**: 3 free functions for cascade | +107 |
| `backend/src/schemas/visit.py` | Add `VisitBase`, `VisitCreate`, `VisitUpdate`, `VisitPatch` | +37/-1 |
| `backend/src/services/visit.py` | Add `list`/`create`/`update`/`patch`/`delete`; refactor `update_status`; remove `_derive_record_status` | +140/-31 |
| `backend/src/services/record.py` | Use free functions in `create`/`update`/`patch`; remove `_check_capacity` | +24/-71 |
| `backend/src/api/v1/visits.py` | Add 5 CRUD handlers; simplify `get_visit_service` DI | +101/-3 |

### Test (2 new + 2 modified)
| File | Change | Lines |
|------|--------|-------|
| `backend/tests/test_record_visits.py` | **New**: 4 unit tests for free functions | +46 |
| `backend/tests/services/test_visit_service.py` | **New**: 8 unit tests for VisitService CRUD | +126 |
| `backend/tests/services/__init__.py` | **New**: package init | 0 |
| `backend/tests/test_api_visits.py` | Add 21 API tests (Phase 1); extends Phase 0 file | +267/-3 |
| `backend/tests/conftest.py` | Add `create_record`, `sample_visit`, `sample_visits`, `sample_activity_with_capacity` fixtures | +299 |

## Multi-Phase Context
This is **Phase 1** of a 3-phase plan:
- **Phase 0** (PR #117, merged): `tariff_id` round-trip — the data plumbing
- **Phase 1** (this PR): Visit CRUD endpoints (create, list, update, patch, delete) + cascade to record
- **Phase 2** (upcoming): Payment PATCH endpoint

## References
- **GitHub Issue**: GH-104 (foundation)
- **Design Spec**: `docs/specs/2026-06-25-backend-visit-payment-api-design.md`
- **Plan**: `docs/plans/2026-06-25-backend-visit-payment-api.md`
- **PR**: _(to be added after PR creation)_
