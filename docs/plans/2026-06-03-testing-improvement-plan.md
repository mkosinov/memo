# Testing Improvement Plan

**Date:** 2026-06-03
**Status:** Approved — starting Phase 1

---

## Phase 1: Refactor (3-4 days)

### R1: Replace `create_app()` → `api_client` fixture
- **Why first:** Every subsequent task is slow without this
- **Files:** `tests/test_api_payments.py`, `tests/test_edge_cases.py::TestEnumValidation`, any file calling `create_app()` directly
- **Pattern:** Use `api_client` fixture from conftest (already exists)
- **Verify:** `uv run pytest tests/ -v --tb=short` — all pass, faster execution
- **Time:** 3-4 hours

### R2: Add `xfail(strict=True)` for known gaps
- **Why:** Document bugs BEFORE writing new tests — prevents new tests from repeating old mistakes
- **Known gaps:**
  - `PaymentCreate.amount` accepts 0 and negative (needs `gt=0`)
  - SQLite FK not enforced (record with nonexistent activity_id → 201)
  - Double-delete is idempotent (200 instead of 404)
- **Pattern:** `@pytest.mark.xfail(reason="TODO: ...", strict=True)`
- **File:** `tests/test_edge_cases.py`
- **Time:** 1-2 hours

### R3: E2E cleanup in try/finally
- **Why:** Needed BEFORE expanding E2E — otherwise new tests leak data
- **File:** `e2e/activity-details-modal.spec.ts`
- **Pattern:** Wrap test body in `try { ... } finally { await cleanup(...) }`
- **Time:** 1 hour

### R4: Contract tests (5 endpoints)
- **Why:** Establishes pattern for new tests
- **Endpoints:** Records, Clients, Payments, Activities, Services
- **Pattern:** `Schema.model_validate(response.json())` — raises ValidationError if mismatch
- **File:** `tests/test_edge_cases.py` (new class `TestResponseContracts`)
- **Time:** 3-4 hours

### R5: FK enforcement + fix broken tests
- **Why:** Last refactoring step — most invasive
- **Action:** Add `PRAGMA foreign_keys = ON` to `reset_db` fixture
- **Risk:** Will break tests that create records with invalid FKs
- **Fix:** Update those tests to use valid FKs or mark as xfail
- **Time:** 4-6 hours

---

## Phase 2: Infrastructure (1-2 days)

### I1: CI workflow
- **Why:** After refactor — tests are fast and clean
- **File:** `.github/workflows/test.yml`
- **Jobs:** backend-tests (pytest) → frontend-e2e (vitest + playwright)
- **Time:** 2-3 hours

### I2: Test/Dev DB separation
- **Why:** Refactor already touched conftest — add isolation now
- **Action:** E2E tests use `test_memo.db`, not `memo.db`
- **Time:** 1-2 hours

### I3: Coverage metrics
- **Why:** Needs CI to enforce
- **Action:** Add `--cov-fail-under=80` to `pyproject.toml`
- **Time:** 1 hour

---

## Phase 3: New Tests (5-7 days)

### N1: E2E — Schedule (DnD, navigation)
- **Why:** CI + isolation ready
- **Scenarios:** DnD activity, week navigation, today button
- **Time:** 1-2 days

### N2: E2E — Records (table, filters)
- **Why:** Parallel with N1
- **Scenarios:** Filter by status, search, pagination
- **Time:** 1 day

### N3: Backend integration tests (3-5 flows)
- **Why:** Contract tests establish pattern
- **Flows:** Phone→client→record→visit, payment cascade, delete cascade
- **Time:** 1 day

### N4: Visual regression
- **Why:** E2E stable
- **Action:** Playwright screenshots for key states
- **Time:** 4-6 hours

---

## Execution Order

```
Phase 1: R1 → R2 → R3 → R4 → R5
Phase 2: I1 → I2 → I3 (after Phase 1)
Phase 3: N1+N2 (parallel) → N3 → N4 (after Phase 2)
```

## Dependencies

```
R1 (speed) ──→ R2 (document) ──→ R3 (isolation) ──→ R4 (pattern) ──→ R5 (FK)
                                                                        ↓
                                                              I1 (CI) → I2 (DB) → I3 (coverage)
                                                                                        ↓
                                                                          N1+N2 (E2E) → N3 (flow) → N4 (visual)
```
