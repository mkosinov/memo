# Phase 0: tariff_id round-trip (GH-104)
- **Date**: 2026-06-25
- **Branch**: feat/phase0-tariff-id
- **Status**: Completed

## Summary of Changes
- `tariff_id` field now propagates through all 4 layers: DB column → SQLAlchemy `Visit` model → Pydantic `VisitResponse` (and nested in `RecordResponse`) → API response mapper.
- Seed data updated: all 10 visits (6 adult + 4 child) now include `tariff_id`.
- 4 new tests verify the round-trip for both `GET /visits/{id}` and `GET /records/{id}` (visit endpoint + nested in record).
- Conftest `query_db` helper fixed: missing `conn.commit()` before close was silently discarding test DB writes.

## Acceptance Criteria
| # | Criteria | Status |
|---|----------|--------|
| 1 | `Visit.visits` table has `tariff_id` column | ✅ Done |
| 2 | `VisitResponse` schema includes `tariff_id` | ✅ Done |
| 3 | `RecordResponse` schema includes nested `visits[].tariff_id` | ✅ Done |
| 4 | Seed data has `tariff_id` on all 10 visits | ✅ Done |
| 5 | `GET /api/v1/visits/{id}` returns `tariff_id` | ✅ Done |
| 6 | `GET /api/v1/records/{id}` returns nested `visits[].tariff_id` | ✅ Done |

## Test Results
- **4 new tests**: all passing (scenarios 1-4 in spec)
- **Total backend**: 595 passed, 0 regressions

## Multi-Phase Context
This is **Phase 0** of a 3-phase plan:
- **Phase 0** (this PR): `tariff_id` round-trip — the data plumbing
- **Phase 1**: Visit CRUD endpoints (create, update, delete)
- **Phase 2**: Payment PATCH endpoint

## References
- **GitHub Issue**: GH-104
- **Design Spec**: `docs/specs/2026-06-25-backend-visit-payment-api-design.md`
- **Plan**: `docs/plans/2026-06-25-backend-visit-payment-api.md`
- **PR**: _(to be added after PR creation)_
