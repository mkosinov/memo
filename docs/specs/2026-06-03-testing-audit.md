# Testing Audit — Memo Project

**Date:** 2026-06-03
**Author:** @architect
**Status:** Current state after testing strategy implementation

---

## What's Good

| Aspect | Status |
|--------|--------|
| Backend CRUD | 221 tests, basic scenario coverage |
| Backend edge cases | 27 tests (enum, validation, boundary) |
| Enum validation | Working — `status="banana"` → 422 |
| Fixture factories | Composable, clean, fast |
| E2E infrastructure | db-query, factories, helpers — ready |
| E2E scenarios | 13 with direct DB verification |

## What's Bad

| Aspect | Problem |
|--------|---------|
| **E2E coverage** | Only ActivityDetailsModal. Schedule, Records, other pages — 0 tests |
| **Visual regression** | None. One screenshot exists — broken |
| **CI/CD** | No workflow. Tests run manually |
| **Test isolation (E2E)** | Tests on dev DB. Cleanup unreliable |
| **Speed** | Backend full run — timeout (>3min). E2E — 40s for 13 tests |
| **Pre-existing bugs** | Menubar test fails. Nobody fixes |
| **Coverage metrics** | No tools. Don't know real % |
| **Cross-browser** | Chromium only. No Firefox/Safari |
| **Accessibility** | 0 tests |
| **Performance** | 0 tests |

## Score

```
Testing:           ████░░░░░░  4/10
Infrastructure:    ██████░░░░  6/10
Coverage:          ███░░░░░░░  3/10
Confidence in tests: █████░░░░░  5/10
```

## Key Risks

1. **E2E covers ~15% of user flows** — modal works, but schedule, records, navigation untested
2. **No CI** — tests fail silently, nobody checks before merge
3. **No visual tests** — UI can break visually, tests show "pass"
4. **Backend tests slow** — full run >3 minutes, developer won't wait

## Action Items

| Priority | Action | Time |
|----------|--------|------|
| 🔴 P0 | CI workflow (pytest + vitest + playwright) | 2-3 hours |
| 🔴 P0 | Separate test/dev DB for E2E | 1-2 hours |
| 🟡 P1 | E2E for Schedule + Records | 1-2 days |
| 🟡 P1 | Visual regression (Playwright screenshots) | 4-6 hours |
| 🟢 P2 | Coverage metrics (pytest-cov, vitest coverage) | 2-3 hours |
| 🟢 P2 | Cross-browser (Firefox + WebKit) | 2-3 hours |

## Summary

Infrastructure is solid, but coverage is weak. OK for MVP, but production needs CI expansion and broader E2E coverage.

---

## Test Counts (as of 2026-06-03)

| Layer | Tool | Count | Pass Rate |
|-------|------|-------|-----------|
| Backend unit/API | pytest | 221 | ~100% |
| Backend edge cases | pytest | 27 | 100% |
| Frontend unit | vitest | 300 | 99.7% (1 pre-existing) |
| E2E | Playwright | 13 | 100% |
| **Total** | | **561** | |

## Files Created During This Session

### Testing Strategy
- `docs/specs/2026-06-03-testing-strategy.md` — architecture, quality gates, 3-track plan
- `docs/specs/2026-06-03-backend-testing.md` — backend junior handbook
- `docs/specs/2026-06-03-frontend-testing.md` — frontend junior handbook

### Backend
- `backend/tests/conftest.py` — fixture factories (6 composable factories)
- `backend/tests/fixtures/` — JSON seed data + SeedLoader
- `backend/tests/test_edge_cases.py` — 27 edge case tests

### Frontend
- `frontend/admin/__tests__/helpers/` — mockData, mockContexts, renderWithProviders
- `frontend/admin/e2e/fixtures/` — db-query, factories, helpers
- `frontend/admin/e2e/activity-details-modal.spec.ts` — rewritten with DB verification
