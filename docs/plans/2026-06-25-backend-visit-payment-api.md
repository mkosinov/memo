# Backend: Visit/Payment API Completion + `tariff_id` Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the spec at `docs/specs/2026-06-25-backend-visit-payment-api-design.md` (commit `9fa1a69`). `tariff_id` round-trips correctly through Visit; Visit CRUD is complete; `PATCH /api/v1/payments/{id}` is exposed.

**Architecture:** 3 phases, 3 PRs. Phase 0 = minimal `tariff_id` field propagation (no logic). Phase 1 = new `src/domain/record_visits.py` with free functions; `VisitService` CRUD using these functions; `RecordService` refactored to use them. Phase 2 = `PaymentPatch` + PATCH handler + `NOT_NULL_FIELDS` guard.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 (async), Pydantic v2, pytest, SQLite (in-memory for tests).

**Source spec:** `docs/specs/2026-06-25-backend-visit-payment-api-design.md` (commit `9fa1a69`, 817 lines, 23 user scenarios, G1b passed).

---

## File Structure

### Files created
| File | Purpose | Phase | Approx lines |
|------|---------|-------|--------------|
| `backend/src/domain/record_visits.py` | Domain free functions: `recompute_record_seats`, `recompute_record_status`, `check_activity_capacity` | 1 | +90 |
| `backend/tests/test_api_visits.py` | API tests for Visit endpoints (currently doesn't exist; only `test_api_visitors.py` does) | 0+1 | +220 |
| `backend/tests/test_record_visits.py` | Unit tests for the three free functions | 1 | +60 |

### Files modified
| File | Purpose | Phase | Approx lines |
|------|---------|-------|--------------|
| `backend/src/models/visit.py` | Add `tariff_id` column + `tariff` relationship | 0 | +5 |
| `backend/src/schemas/visit.py` | Add `tariff_id` to `VisitResponse`; add `VisitBase/Create/Update/Patch` | 0+1 | +35 |
| `backend/src/schemas/record.py` | Add `tariff_id` to nested `VisitResponse` | 0 | +1 |
| `backend/src/api/v1/visits.py` | Add `tariff_id` to `_map_visit`; add CRUD handlers | 0+1 | +55 |
| `backend/src/services/visit.py` | Add `list/create/update/patch/delete`; refactor `update_status`; remove `_derive_record_status` | 1 | +80 / -30 |
| `backend/src/services/record.py` | Refactor `create/update/patch` to use free functions; **remove** `_check_capacity` | 1 | +20 / -50 |
| `backend/src/schemas/payment.py` | Add `PaymentPatch` | 2 | +10 |
| `backend/src/services/payment.py` | Set `NOT_NULL_FIELDS = {'amount'}` | 2 | +1 |
| `backend/src/api/v1/payments.py` | Add `PATCH /{payment_id}` handler | 2 | +15 |
| `backend/tests/test_api_records.py` | Add tests for tariff_id round-trip in nested visits (Phase 0) | 0 | +20 |
| `backend/tests/test_api_payments.py` | Add PATCH tests (Phase 2) | 2 | +30 |

### Files NOT modified
- `backend/alembic/versions/` — no new migration (DB column already exists from `448bdcc2a6a7`)
- `backend/src/services/payment.py` core logic — `GenericService.patch` is already implemented
- Any frontend file

### Spec discrepancies to fix in implementation
The spec file references test paths under `backend/tests/api/` and `backend/tests/models/`, but the actual layout is `backend/tests/test_api_*.py` (flat, no subdirs). **Use the actual paths from the "Files created/modified" table above** — they have been corrected to match the real layout.

---

## Task Classification Legend
- **Trivial** = no reviewer dispatched; architect spot-check only
- **Small** = spec-reviewer only (max 3 loops)
- **Standard** = spec-reviewer + code-quality-reviewer (each max 3 loops)
- **Large** = Standard + final review of entire feature

---

# Phase 0 — `tariff_id` round-trip (GH-104 minimum)

**Scope:** `tariff_id` propagates from DB → Visit ORM → `VisitResponse` → nested `VisitResponse` → API response. 4 files changed, 4 user scenarios.

**Acceptance gate:** scenarios 1-4 pass. `pytest` all green. `mypy` clean.

---

## Task 0.1: Write failing API tests for `tariff_id` round-trip (scenarios 1-4)

### Classification: small
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — sections "Phase 0" and "User Scenarios 1-4" for exact test expectations
- `docs/specs/2026-06-20-error-flow-design.md` — error response contract
- `docs/specs/testing-strategy-v2.md` — pytest patterns (use `pytest-patterns` skill)

### Task Description
Write **4 failing tests** (TDD RED phase). The tests must:
1. Fail initially because the field is missing in the model/schema/mapper
2. Pass after Task 0.2 is complete

**Files to create/extend:**
- `backend/tests/test_api_visits.py` (NEW file)
- `backend/tests/test_api_records.py` (extend existing)

**Steps:**

- [ ] **Read existing test patterns** — open `backend/tests/test_api_records.py` and `backend/tests/test_api_payments.py` to understand the project's test style (TestClient, factory fixtures, how records/visits/visitors are seeded in tests). **Do not copy code from these — just understand the style.**

- [ ] **Invoke skills first** — before writing any test, invoke:
  - `pytest-patterns` (REQUIRED — see "Required Docs" note)
  - `test-driven-development` (REQUIRED)

- [ ] **Create `backend/tests/test_api_visits.py`** with these test functions (use existing fixtures from `backend/tests/conftest.py` and `backend/tests/fixtures/seed.py` — discover what's available, do NOT create new fixtures):

  ```python
  """Tests for /api/v1/visits endpoints — Phase 0 (tariff_id round-trip)."""
  import pytest
  from httpx import AsyncClient


  @pytest.mark.asyncio
  async def test_get_visit_includes_tariff_id(async_client: AsyncClient, db_session, sample_visit_with_tariff):
      """Scenario 1: GET /api/v1/visits/{id} response includes tariff_id."""
      response = await async_client.get(f"/api/v1/visits/{sample_visit_with_tariff.id}")
      assert response.status_code == 200
      data = response.json()
      assert "tariff_id" in data
      assert data["tariff_id"] == sample_visit_with_tariff.tariff_id


  @pytest.mark.asyncio
  async def test_get_visit_tariff_id_null(async_client: AsyncClient, db_session, sample_visit_no_tariff):
      """Scenario 4: Visit with no tariff returns tariff_id: null."""
      response = await async_client.get(f"/api/v1/visits/{sample_visit_no_tariff.id}")
      assert response.status_code == 200
      assert response.json()["tariff_id"] is None
  ```

  - The two fixtures (`sample_visit_with_tariff`, `sample_visit_no_tariff`) MUST exist in `backend/tests/conftest.py` or be created there as part of this task. They should create a `Visit` ORM object (with/without `tariff_id`) and return it. Use the existing factory pattern in `conftest.py` (look for `make_visit` or similar).
  - If no factory exists, create a `make_visit` factory in `conftest.py` following the existing style.

- [ ] **Extend `backend/tests/test_api_records.py`** with these two test functions (scenarios 2, 3):

  ```python
  @pytest.mark.asyncio
  async def test_get_record_includes_tariff_id_in_visits(async_client, sample_record_with_visit):
      """Scenario 2: GET /api/v1/records/{id} includes tariff_id in nested visits."""
      response = await async_client.get(f"/api/v1/records/{sample_record_with_visit.id}")
      assert response.status_code == 200
      visits = response.json()["visits"]
      assert len(visits) >= 1
      assert "tariff_id" in visits[0]


  @pytest.mark.asyncio
  async def test_patch_record_preserves_tariff_id_in_visits(async_client, sample_record_with_visit, sample_tariff):
      """Scenario 3: PATCH /api/v1/records/{id} accepts tariff_id in visits array."""
      patch_data = {
          "visits": [
              {
                  "id": sample_record_with_visit.visits[0].id,
                  "tariff_id": sample_tariff.id,
                  "price": 3500,
                  "status": "waiting",
              }
          ]
      }
      response = await async_client.patch(
          f"/api/v1/records/{sample_record_with_visit.id}", json=patch_data
      )
      assert response.status_code == 200
      assert response.json()["visits"][0]["tariff_id"] == sample_tariff.id
  ```

- [ ] **Run the 4 tests, expect all to FAIL** (RED phase confirmed):
  ```bash
  cd backend && pytest tests/test_api_visits.py tests/test_api_records.py::test_get_record_includes_tariff_id_in_visits tests/test_api_records.py::test_patch_record_preserves_tariff_id_in_visits -v
  ```
  Expected: 4 failures with errors like `"tariff_id"` not in response / `AttributeError: 'Visit' object has no attribute 'tariff_id'`.

- [ ] **Commit (RED tests):**
  ```bash
  git add backend/tests/test_api_visits.py backend/tests/test_api_records.py backend/tests/conftest.py
  git commit -m "test(backend): add failing tests for visit/record tariff_id round-trip (Phase 0 RED)"
  ```

### Definition of Done
- [ ] 4 new tests exist and FAIL when run
- [ ] No other tests are broken (existing tests still pass)
- [ ] Commit made

---

## Task 0.2: Add `tariff_id` to Visit model, schemas, and mapper (GREEN)

### Classification: small
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "Data model (after Phase 0)" for exact code
- The 4 failing tests from Task 0.1 (read them to understand what to make pass)
- `backend/src/models/visit.py` — current state (18 lines, no tariff_id)
- `backend/src/schemas/visit.py:14-27` — current `VisitResponse`
- `backend/src/schemas/record.py:26-39` — current nested `VisitResponse`
- `backend/src/api/v1/visits.py:34-44` — current `_map_visit`

### Task Description
Make the 4 RED tests pass by adding `tariff_id` to 4 layers. The spec provides exact code (section "Data model (after Phase 0") — use it verbatim.

**Files to modify:**

- [ ] **`backend/src/models/visit.py`** — add the new column and relationship. Use the spec's exact code (lines 125-144 of the spec). Insert `tariff_id` after `visitor_id` line, and `tariff` relationship after `record` relationship.

- [ ] **`backend/src/schemas/visit.py`** — add `tariff_id: str | None = None` to `VisitResponse`. Insert after `visitor_id` line (line 16 of the spec's example).

- [ ] **`backend/src/schemas/record.py`** — add `tariff_id: str | None = None` to the nested `VisitResponse` (the one inside `RecordResponse`, lines 26-39 of the schema). Insert after `visitor_id` line.

- [ ] **`backend/src/api/v1/visits.py`** — add `tariff_id=visit.tariff_id` to `_map_visit` (line 34-44). Insert in the right position alphabetically (after `record_id`, before `visitor_id` or after `visitor_id` — match existing ordering).

- [ ] **Run the 4 tests, expect all to PASS:**
  ```bash
  cd backend && pytest tests/test_api_visits.py tests/test_api_records.py::test_get_record_includes_tariff_id_in_visits tests/test_api_records.py::test_patch_record_preserves_tariff_id_in_visits -v
  ```
  Expected: 4 passed.

- [ ] **Run the FULL test suite to catch regressions:**
  ```bash
  cd backend && pytest tests/ -v
  ```
  Expected: all green (no new failures).

- [ ] **Type check:**
  ```bash
  cd backend && mypy src/
  ```
  Expected: no new errors. (Pre-existing mypy issues, if any, are out of scope.)

- [ ] **Commit (GREEN):**
  ```bash
  git add backend/src/models/visit.py backend/src/schemas/visit.py backend/src/schemas/record.py backend/src/api/v1/visits.py
  git commit -m "feat(backend): add tariff_id to Visit model, schemas, and mapper (Phase 0 GREEN)"
  ```

### Definition of Done
- [ ] All 4 RED tests now pass
- [ ] Full `pytest` suite green
- [ ] `mypy src/` clean
- [ ] Commit made

---

## Task 0.3: Verify Phase 0 acceptance and prepare PR #1

### Classification: trivial
### Required Docs
- This plan, Tasks 0.1 and 0.2
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — "Acceptance gates" section

### Task Description
Verify Phase 0 is complete and ready for PR.

**Steps:**

- [ ] **Run all 23 user scenarios from the spec's `## User Scenarios` section via the test suite.** At this point only scenarios 1-4 are implemented (Phase 0 scope). Run them and confirm:
  ```bash
  cd backend && pytest tests/test_api_visits.py tests/test_api_records.py -v -k "tariff_id or tariff"
  ```
  Expected: 4 tests pass.

- [ ] **Run full backend test suite:**
  ```bash
  cd backend && pytest tests/ -q
  ```
  Expected: 100% green, no regressions.

- [ ] **Run mypy:**
  ```bash
  cd backend && mypy src/
  ```
  Expected: no new errors.

- [ ] **Run alembic check (should pass without new migration):**
  ```bash
  cd backend && alembic check
  ```
  Expected: "No new upgrade operations detected" (or similar success message).

- [ ] **Update scratchpad** — append a note that Phase 0 is complete and ready for PR review.

- [ ] **Report status** to architect with:
  - Files changed: 4 source + 2 test + 1 conftest
  - Test results: 4 new tests pass, 0 regressions
  - mypy: clean
  - alembic: no migration needed
  - State: READY FOR PR #1 REVIEW

### Definition of Done
- [ ] All Phase 0 verifications green
- [ ] Status reported to architect (DONE | DONE_WITH_CONCERNS | BLOCKED)

---

# Phase 1 — Visit CRUD + cascade to Record (seats + status)

**Scope:** New `src/domain/record_visits.py` with 3 free functions. `VisitService` gains `list/create/update/patch/delete`. `RecordService` refactored to use free functions (removes `_check_capacity`). Router gains 5 new handlers. 1 new file + 5 modified, ~480 lines, 16 user scenarios (5-20).

**Acceptance gate:** scenarios 5-20 pass. `pytest` all green. Existing `PUT /visits/{id}/status` still works (scenario 15). Cascade to `record.seats` verified. Capacity check enforced.

---

## Task 1.1: Create `src/domain/record_visits.py` with 3 free functions + unit tests (RED)

### Classification: small
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "Cascade helpers" (lines 306-426) for exact function signatures
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "Architecture > Files modified (Phase 1)" for file purpose
- `backend/src/domain/visit_status.py` — existing pattern (free function `compute_record_status`)
- `backend/src/services/visit.py:39-62` — current `_derive_record_status` (to be removed)
- `backend/src/services/record.py:294-324` — current `_check_capacity` (to be removed)

### Task Description
Create the new domain module with 3 free functions. The spec provides the exact code (lines 318-426 of the spec). **Test-first (RED):** write unit tests that fail because the module doesn't exist, then implement the functions to make them pass.

**Files to create:**

- [ ] **Create `backend/src/domain/record_visits.py`** — Use the spec's code verbatim (lines 318-426 of the spec, with module docstring, imports, and all 3 functions). Verify:
  - All 3 functions are `async def`
  - They take `db_session: AsyncSession` as first param
  - They use the existing patterns from `src/domain/visit_status.py`
  - `check_activity_capacity` raises `HTTPException(409, ...)` with `ErrorCode.ACTIVITY_AT_CAPACITY` — verify this error code exists in `backend/src/errors.py`

- [ ] **Create `backend/tests/test_record_visits.py`** (NEW) with unit tests for all 3 functions. Use the spec's user scenarios 16-21 as the basis. Minimum 4 tests:

  ```python
  """Unit tests for src/domain/record_visits.py free functions."""
  import pytest


  @pytest.mark.asyncio
  async def test_recompute_record_seats_counts_active_visits(db_session, sample_record):
      """Scenario 16: recompute_record_seats sets seats = count(active visits) + anonym_visits."""
      from src.domain.record_visits import recompute_record_seats

      record = await recompute_record_seats(db_session, sample_record.id)
      assert record.seats == len([v for v in sample_record.visits if v.is_active]) + sample_record.anonym_visits


  @pytest.mark.asyncio
  async def test_recompute_record_status_derives_from_visits(db_session, sample_record_with_visits):
      """recompute_record_status derives status from active visits."""
      from src.domain.record_visits import recompute_record_status

      record = await recompute_record_status(db_session, sample_record_with_visits.id)
      # Status must match compute_record_status(visits).value — verify via re-import
      from src.domain.visit_status import compute_record_status, VisitItem
      expected = compute_record_status([
          VisitItem(id=v.id, status=v.status)
          for v in sample_record_with_visits.visits if v.is_active
      ]).value
      assert record.status == expected


  @pytest.mark.asyncio
  async def test_check_activity_capacity_passes_when_room(db_session, sample_activity_with_capacity):
      """check_activity_capacity does not raise when capacity available."""
      from src.domain.record_visits import check_activity_capacity

      # Should not raise
      await check_activity_capacity(db_session, sample_activity_with_capacity.id, seats=1)


  @pytest.mark.asyncio
  async def test_check_activity_capacity_raises_409_when_full(db_session, sample_activity_at_capacity):
      """Scenario 19: check_activity_capacity raises 409 ACTIVITY_AT_CAPACITY when full."""
      from fastapi import HTTPException
      from src.domain.record_visits import check_activity_capacity

      with pytest.raises(HTTPException) as exc_info:
          await check_activity_capacity(db_session, sample_activity_at_capacity.id, seats=1)
      assert exc_info.value.status_code == 409
      assert exc_info.value.detail["code"] == "ACTIVITY_AT_CAPACITY"
  ```

  - Fixtures (`sample_record`, `sample_record_with_visits`, `sample_activity_with_capacity`, `sample_activity_at_capacity`) MUST exist or be created in `conftest.py` (use existing factory patterns).

- [ ] **Run the unit tests, expect them to PASS** (since we created both module and tests together):
  ```bash
  cd backend && pytest tests/test_record_visits.py -v
  ```
  Expected: 4 passed (or 4 fail with import errors that we then fix).

- [ ] **Commit:**
  ```bash
  git add backend/src/domain/record_visits.py backend/tests/test_record_visits.py backend/tests/conftest.py
  git commit -m "feat(backend): add domain/record_visits.py with cascade free functions + unit tests (Phase 1 step 1)"
  ```

### Definition of Done
- [ ] `src/domain/record_visits.py` exists with 3 functions
- [ ] `tests/test_record_visits.py` exists with 4+ tests
- [ ] All tests pass
- [ ] Commit made

---

## Task 1.2: Add `VisitBase/Create/Update/Patch` Pydantic schemas

### Classification: small
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "Schema design (Phase 1 — Visit CRUD)" (lines 170-238) for exact schema code
- `backend/src/schemas/visit.py` — current state
- `backend/src/schemas/visitor.py` — pattern reference (cleanest existing example)
- `backend/src/models/enums.py` — `VisitStatus` enum

### Task Description
Add 4 new Pydantic schemas to `backend/src/schemas/visit.py`. Mirror the `visitor.py` pattern.

**Files to modify:**

- [ ] **Open `backend/src/schemas/visit.py`** and read current state. Add 4 new classes BEFORE the existing `VisitResponse` (keep response at the bottom — convention):

  ```python
  class VisitBase(BaseModel):
      """Shared fields for visit create and update."""

      record_id: str
      visitor_id: str | None = None
      tariff_id: str | None = None
      price: int = Field(ge=0)
      custom_price: int | None = None
      status: VisitStatus = VisitStatus.WAITING


  class VisitCreate(VisitBase):
      """Request schema for creating a new visit (POST /api/v1/visits)."""
      pass


  class VisitUpdate(VisitBase):
      """Request schema for full-replace update (PUT /api/v1/visits/{id})."""
      pass


  class VisitPatch(BaseModel):
      """Request schema for partial update (PATCH /api/v1/visits/{id}).

      All fields optional. None means 'don't change'.
      """

      visitor_id: str | None = None
      tariff_id: str | None = None
      price: int | None = Field(default=None, ge=0)
      custom_price: int | None = None
      status: VisitStatus | None = None
  ```

- [ ] **Verify imports are correct** — `Field` from pydantic, `VisitStatus` from `src.models.enums`. If imports are missing, add them at the top of the file.

- [ ] **Run mypy to catch type errors early:**
  ```bash
  cd backend && mypy src/schemas/visit.py
  ```
  Expected: no errors.

- [ ] **No new tests yet** (schemas are tested transitively when endpoints are tested in Task 1.5).

- [ ] **Commit:**
  ```bash
  git add backend/src/schemas/visit.py
  git commit -m "feat(backend): add VisitBase, VisitCreate, VisitUpdate, VisitPatch schemas (Phase 1 step 2)"
  ```

### Definition of Done
- [ ] 4 new schemas exist
- [ ] mypy clean
- [ ] Commit made

---

## Task 1.3: Add `list/create/update/patch/delete` methods to `VisitService` (TDD)

### Classification: large
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "VisitService uses domain functions" (lines 428-535) for exact method code
- `backend/src/services/visit.py` — current state (only has `get` and `update_status`)
- `backend/src/domain/record_visits.py` — the new free functions from Task 1.1
- `backend/src/models/visit.py` — Visit ORM (with `tariff_id` from Phase 0)
- `docs/specs/2026-06-20-error-flow-design.md` — error response contract

### Task Description
Add 5 new methods to `VisitService`. Refactor `update_status` to use `recompute_record_status`. **Remove** the existing `_derive_record_status` private method.

**Test-first (RED):** Write tests for each new method, watch them fail, then implement, watch them pass.

**Files to modify:**

- [ ] **Write 5 RED unit tests for the new service methods** in a new file `backend/tests/test_visit_service.py` (or extend `test_api_visits.py` if you prefer integration tests). Use existing fixtures from conftest. **For each method, write a test that:**
  - Creates the necessary DB state
  - Calls the service method
  - Asserts the expected return value + side effects on the parent record

  **5 tests minimum:**
  - `test_visit_service_list` — list all active visits
  - `test_visit_service_create_cascades_to_record` — create visit, then `record.status` and `record.seats` are updated (scenarios 5, 16)
  - `test_visit_service_update_full_replace` — full PUT, all fields updated (scenario 14)
  - `test_visit_service_patch_partial` — only sent fields updated, others unchanged (scenario 10)
  - `test_visit_service_delete_soft_deletes_and_cascades` — `is_active=False`, `record.seats -= 1`, `record.status` re-derived (scenarios 12, 17)

- [ ] **Run the 5 tests, expect 5 FAILURES** (RED confirmed):
  ```bash
  cd backend && pytest tests/test_visit_service.py -v
  ```

- [ ] **Open `backend/src/services/visit.py`** and add the 5 new methods + refactor `update_status` to use the free function. Use the spec's code (lines 442-535) as the template:

  - `list(self, db_session, record_id=None)` — returns active visits, optional filter
  - `create(self, db_session, data)` — verify record exists, check capacity, insert, cascade (seats + status)
  - `update(self, db_session, visit_id, data)` — full replace, cascade (status only — seats unchanged)
  - `patch(self, db_session, visit_id, data)` — partial, cascade (status only)
  - `delete(self, db_session, visit_id)` — soft delete, cascade (seats + status)
  - Refactor `update_status` to call `recompute_record_status` instead of inlined logic
  - **Remove** the private method `_derive_record_status` (lines 39-62 of the current file)

- [ ] **Run the 5 tests, expect 5 PASSES** (GREEN):
  ```bash
  cd backend && pytest tests/test_visit_service.py -v
  ```

- [ ] **Run the FULL test suite to verify no regressions:**
  ```bash
  cd backend && pytest tests/ -q
  ```
  Expected: all green.

- [ ] **Run mypy:**
  ```bash
  cd backend && mypy src/services/visit.py
  ```

- [ ] **Commit:**
  ```bash
  git add backend/src/services/visit.py backend/tests/test_visit_service.py
  git commit -m "feat(backend): add VisitService CRUD methods + refactor update_status to use free function (Phase 1 step 3)"
  ```

### Definition of Done
- [ ] 5 new methods exist on `VisitService`
- [ ] `_derive_record_status` removed
- [ ] `update_status` refactored to use `recompute_record_status`
- [ ] 5 service tests pass
- [ ] Full pytest suite green
- [ ] mypy clean
- [ ] Commit made

---

## Task 1.4: Refactor `RecordService` to use free functions + remove `_check_capacity`

### Classification: standard
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "RecordService also uses the free functions (DRY)" (lines 570-602)
- `backend/src/services/record.py` — current state, especially lines 123, 208, 268, 272, 277, 283 (inlined cascade) and 294-324 (`_check_capacity`)
- `backend/src/domain/record_visits.py` — the new free functions

### Task Description
Replace inlined cascade logic in `RecordService` with calls to free functions. **Remove** the private `_check_capacity` method.

**Files to modify:**

- [ ] **Run existing record tests to verify baseline:**
  ```bash
  cd backend && pytest tests/test_api_records.py tests/test_compute_record_status.py -v
  ```
  Expected: all green (this is the baseline).

- [ ] **Open `backend/src/services/record.py`** and refactor:
  - Add import: `from src.domain.record_visits import recompute_record_seats, recompute_record_status, check_activity_capacity`
  - In `create()`: replace `await self._check_capacity(...)` with `await check_activity_capacity(...)`. Remove the existing call to derive `record.status` (lines 119-129 area); replace with `await recompute_record_status(...)`.
  - In `update()`: same — replace inlined cascade (around line 220-228) with `await recompute_record_status(...)`. Also handle `record.seats` via `await recompute_record_seats(...)` if visits are replaced.
  - In `patch()`: replace inlined cascade (lines 267-287) with `await recompute_record_seats(...)` then `await recompute_record_status(...)`.
  - **Remove** the `_check_capacity` private method (lines 294-324).

- [ ] **Run the same tests, expect all to PASS** (regression check):
  ```bash
  cd backend && pytest tests/test_api_records.py tests/test_compute_record_status.py -v
  ```
  Expected: all green (refactor preserves behavior).

- [ ] **Run FULL test suite to catch any cascade of regressions:**
  ```bash
  cd backend && pytest tests/ -q
  ```
  Expected: all green.

- [ ] **Run mypy:**
  ```bash
  cd backend && mypy src/services/record.py
  ```

- [ ] **Commit:**
  ```bash
  git add backend/src/services/record.py
  git commit -m "refactor(backend): use record_visits free functions in RecordService, remove _check_capacity (Phase 1 step 4)"
  ```

### Definition of Done
- [ ] `_check_capacity` removed
- [ ] All 3 methods (`create/update/patch`) call free functions
- [ ] Full pytest suite green
- [ ] mypy clean
- [ ] Commit made

---

## Task 1.5: Add CRUD handlers to visits router (TDD — covers scenarios 5-20)

### Classification: large
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "API surface (after Phase 1 + 2)" and "Router (visits.py) — simplified DI" (lines 540-568)
- `backend/src/api/v1/visits.py` — current state (only has `get` and `update_status`)
- `backend/src/services/visit.py` — service methods from Task 1.3
- `backend/src/schemas/visit.py` — schemas from Task 1.2
- Existing payment router `backend/src/api/v1/payments.py` — pattern reference for CRUD

### Task Description
Add 5 new HTTP handlers: `GET /`, `POST /`, `PUT /{id}`, `PATCH /{id}`, `DELETE /{id}`. Simplify `get_visit_service` (no chained `Depends`).

**Test-first (RED):** Write 12+ API tests covering scenarios 5-20. Watch them fail. Then implement handlers. Watch them pass.

**Files to modify:**

- [ ] **Write 16 RED API tests in `backend/tests/test_api_visits.py`** (extend the file from Phase 0). Use existing fixtures. Map each test to a user scenario:

  | Test | Scenario |
  |------|----------|
  | `test_create_visit_returns_201` | 5 |
  | `test_create_visit_missing_record_id_422` | 6 |
  | `test_create_visit_invalid_record_id_404` | 7 (updated to 404, not 422) |
  | `test_list_visits_returns_all_active` | 8 |
  | `test_list_visits_filtered_by_record` | 9 |
  | `test_patch_visit_partial` | 10 |
  | `test_patch_visit_status_cascades_to_record` | 11 |
  | `test_delete_visit_soft_deletes_and_cascades` | 12 |
  | `test_get_visit_not_found_404` | 13 |
  | `test_update_visit_full_replace` | 14 |
  | `test_existing_status_put_still_works` | 15 (regression test) |
  | `test_create_visit_cascades_to_seats` | 16 |
  | `test_delete_visit_cascades_to_seats` | 17 |
  | `test_patch_visit_does_not_change_seats` | 18 |
  | `test_create_visit_rejects_when_capacity_exceeded` | 19 |
  | `test_create_visit_invalid_record_id_404` | 20 |

- [ ] **Run the 16 tests, expect 16 FAILURES** (RED):
  ```bash
  cd backend && pytest tests/test_api_visits.py -v
  ```

- [ ] **Open `backend/src/api/v1/visits.py`** and add the 5 handlers. Use the spec's code (lines 540-568) as the template:

  ```python
  @lru_cache
  def get_visit_service() -> VisitService:
      """Returns a singleton VisitService (no constructor deps)."""
      return VisitService()


  _ServiceDep = Annotated[VisitService, Depends(get_visit_service)]


  @router.get("", response_model=list[VisitResponse])
  async def list_visits(
      record_id: str | None = None,
      service: _ServiceDep = ...,
      session: SessionDep = ...,
  ) -> list[VisitResponse]:
      visits = await service.list(db_session=session, record_id=record_id)
      return [_map_visit(v) for v in visits]


  @router.post("", response_model=VisitResponse, status_code=201)
  async def create_visit(
      data: VisitCreate,
      service: _ServiceDep = ...,
      session: SessionDep = ...,
  ) -> VisitResponse:
      visit = await service.create(db_session=session, data=data)
      if not visit:
          raise HTTPException(
              status_code=404,
              detail=ErrorDetail(
                  code=ErrorCode.RECORD_NOT_FOUND,
                  message="Parent record not found",
              ).model_dump(),
          )
      return _map_visit(visit)


  # ... PUT, PATCH, DELETE handlers similar pattern ...
  ```

  - Remove the existing `Depends(get_visit_service)` chain if there was one. `VisitService()` has no constructor deps now.

- [ ] **Run the 16 tests, expect 16 PASSES** (GREEN):
  ```bash
  cd backend && pytest tests/test_api_visits.py -v
  ```

- [ ] **Run FULL test suite:**
  ```bash
  cd backend && pytest tests/ -q
  ```

- [ ] **Run mypy:**
  ```bash
  cd backend && mypy src/api/v1/visits.py
  ```

- [ ] **Commit:**
  ```bash
  git add backend/src/api/v1/visits.py backend/tests/test_api_visits.py
  git commit -m "feat(backend): add Visit CRUD handlers (GET/POST/PUT/PATCH/DELETE) (Phase 1 step 5)"
  ```

### Definition of Done
- [ ] 5 new handlers exist
- [ ] 16 API tests pass (scenarios 5-20)
- [ ] Full pytest suite green
- [ ] mypy clean
- [ ] Commit made

---

## Task 1.6: Verify Phase 1 acceptance and prepare PR #2

### Classification: trivial
### Required Docs
- This plan, Tasks 1.1-1.5
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — "Acceptance gates" section

### Task Description
Verify Phase 1 is complete and ready for PR.

**Steps:**

- [ ] **Run scenarios 5-20 (16 tests):**
  ```bash
  cd backend && pytest tests/test_api_visits.py tests/test_record_visits.py tests/test_visit_service.py -v
  ```
  Expected: 16+ tests pass.

- [ ] **Run full backend test suite:**
  ```bash
  cd backend && pytest tests/ -q
  ```
  Expected: 100% green, no regressions.

- [ ] **Run mypy:**
  ```bash
  cd backend && mypy src/
  ```

- [ ] **Run alembic check:**
  ```bash
  cd backend && alembic check
  ```

- [ ] **Update scratchpad** with Phase 1 status.

- [ ] **Report status** to architect.

### Definition of Done
- [ ] All Phase 1 verifications green
- [ ] Status reported to architect

---

# Phase 2 — `PATCH /api/v1/payments/{id}`

**Scope:** Add `PaymentPatch` schema, expose `PATCH` handler, set `NOT_NULL_FIELDS = {'amount'}` on `PaymentService`. 3 files modified, ~50 lines, 3 user scenarios (21-23).

**Acceptance gate:** scenarios 21-23 pass. Existing payment endpoints still work.

---

## Task 2.1: Write failing tests for `PATCH /api/v1/payments/{id}` (scenarios 21-23)

### Classification: small
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "User Scenarios 21-23" and "PaymentPatch" code (lines 240-253)
- `backend/tests/test_api_payments.py` — existing test patterns
- `docs/specs/2026-06-20-error-flow-design.md` — error response contract

### Task Description
Write 3 failing tests (TDD RED).

**Files to modify:**

- [ ] **Read `backend/tests/test_api_payments.py`** to understand existing test patterns.

- [ ] **Add 3 RED tests to `backend/tests/test_api_payments.py`:**

  ```python
  @pytest.mark.asyncio
  async def test_patch_payment_partial(async_client, sample_payment):
      """Scenario 21: PATCH /api/v1/payments/{id} partial update."""
      response = await async_client.patch(
          f"/api/v1/payments/{sample_payment.id}",
          json={"method": "card"},
      )
      assert response.status_code == 200
      data = response.json()
      assert data["method"] == "card"
      assert data["amount"] == sample_payment.amount  # unchanged


  @pytest.mark.asyncio
  async def test_patch_payment_null_amount_stripped(async_client, sample_payment):
      """Scenario 22: PATCH with amount: null is silently stripped."""
      original_amount = sample_payment.amount
      response = await async_client.patch(
          f"/api/v1/payments/{sample_payment.id}",
          json={"amount": None, "method": "cash"},
      )
      assert response.status_code == 200
      assert response.json()["amount"] == original_amount  # NOT nulled out
      assert response.json()["method"] == "cash"


  @pytest.mark.asyncio
  async def test_patch_payment_not_found_404(async_client):
      """Scenario 23: PATCH non-existent ID returns 404."""
      response = await async_client.patch(
          "/api/v1/payments/nonexistent-id",
          json={"method": "card"},
      )
      assert response.status_code == 404
      assert response.json()["detail"]["code"] == "PAYMENT_NOT_FOUND"
  ```

  - `sample_payment` fixture MUST exist in conftest (verify or create).

- [ ] **Run the 3 tests, expect 3 FAILURES** (RED — PATCH not yet implemented):
  ```bash
  cd backend && pytest tests/test_api_payments.py -v -k "patch_payment"
  ```

- [ ] **Commit (RED tests):**
  ```bash
  git add backend/tests/test_api_payments.py
  git commit -m "test(backend): add failing tests for PATCH /api/v1/payments/{id} (Phase 2 RED)"
  ```

### Definition of Done
- [ ] 3 new tests exist and FAIL
- [ ] Commit made

---

## Task 2.2: Add `PaymentPatch` schema

### Classification: trivial
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "PaymentPatch" (lines 240-253)
- `backend/src/schemas/payment.py` — current state

### Task Description
Add `PaymentPatch` schema to `backend/src/schemas/payment.py`.

**Files to modify:**

- [ ] **Open `backend/src/schemas/payment.py`** and add the new schema (use spec's exact code, lines 245-253):

  ```python
  class PaymentPatch(BaseModel):
      """Request schema for partial update (PATCH /api/v1/payments/{id}).

      All fields optional. None means 'don't change'.
      Setting `amount: null` is a no-op (stripped by the service via NOT_NULL_FIELDS).
      """

      amount: int | None = Field(default=None, gt=0)
      method: PaymentMethod | None = None
  ```

- [ ] **Verify imports** — `Field` from pydantic, `PaymentMethod` from `src.models.enums`.

- [ ] **Run mypy:**
  ```bash
  cd backend && mypy src/schemas/payment.py
  ```

- [ ] **Commit:**
  ```bash
  git add backend/src/schemas/payment.py
  git commit -m "feat(backend): add PaymentPatch schema (Phase 2 step 2)"
  ```

### Definition of Done
- [ ] `PaymentPatch` exists
- [ ] mypy clean
- [ ] Commit made

---

## Task 2.3: Set `NOT_NULL_FIELDS = {'amount'}` on `PaymentService`

### Classification: trivial
### Required Docs
- `backend/src/services/payment.py` — current state
- `backend/src/repositories/generic.py` — `GenericService.patch` implementation (lines 91-...)

### Task Description
Set the `NOT_NULL_FIELDS` class attribute on `PaymentService` to strip `null` for `amount` in PATCH requests.

**Files to modify:**

- [ ] **Open `backend/src/services/payment.py`** and add a class attribute:

  ```python
  class PaymentService(GenericService[Payment, ...]):
      """..."""

      NOT_NULL_FIELDS = {"amount"}
      # ... rest of class
  ```

  - Verify `NOT_NULL_FIELDS` is checked in `GenericService.patch` (look in `backend/src/repositories/generic.py`).
  - The expected behavior: a PATCH with `{"amount": null, "method": "cash"}` strips `amount` and only updates `method`.

- [ ] **No new tests** (verified by Task 2.1's `test_patch_payment_null_amount_stripped`).

- [ ] **Commit:**
  ```bash
  git add backend/src/services/payment.py
  git commit -m "feat(backend): set NOT_NULL_FIELDS={'amount'} on PaymentService (Phase 2 step 3)"
  ```

### Definition of Done
- [ ] `NOT_NULL_FIELDS = {"amount"}` set
- [ ] Commit made

---

## Task 2.4: Add `PATCH /{payment_id}` handler in router (GREEN)

### Classification: small
### Required Docs
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — section "Phase 2 — Payment PATCH" (lines 604-636) for handler code
- `backend/src/api/v1/payments.py` — current state
- The 3 RED tests from Task 2.1 (read them to understand what to make pass)

### Task Description
Add the PATCH handler to the payments router.

**Files to modify:**

- [ ] **Open `backend/src/api/v1/payments.py`** and add the PATCH handler. Use the spec's code (lines 611-629) as the template:

  ```python
  @router.patch("/{payment_id}", response_model=PaymentResponse)
  async def patch_payment(
      payment_id: str,
      data: PaymentPatch,
      service: _ServiceDep,
      session: SessionDep,
  ) -> PaymentResponse:
      """Partial-update a payment (PATCH)."""
      payment = await service.patch(db_session=session, id=payment_id, data=data)
      if not payment:
          raise HTTPException(
              status_code=404,
              detail=ErrorDetail(
                  code=ErrorCode.PAYMENT_NOT_FOUND,
                  message="Payment not found",
              ).model_dump(),
          )
      return payment
  ```

  - Verify `service.patch()` is inherited from `GenericService` and accepts `(db_session, id, data)`.

- [ ] **Run the 3 tests from Task 2.1, expect 3 PASSES** (GREEN):
  ```bash
  cd backend && pytest tests/test_api_payments.py -v -k "patch_payment"
  ```

- [ ] **Run FULL test suite to catch regressions:**
  ```bash
  cd backend && pytest tests/ -q
  ```

- [ ] **Run mypy:**
  ```bash
  cd backend && mypy src/api/v1/payments.py
  ```

- [ ] **Commit:**
  ```bash
  git add backend/src/api/v1/payments.py
  git commit -m "feat(backend): add PATCH /api/v1/payments/{id} handler (Phase 2 step 4 — GREEN)"
  ```

### Definition of Done
- [ ] PATCH handler exists
- [ ] 3 PATCH tests pass
- [ ] Existing payment tests still pass (POST, PUT, DELETE regression)
- [ ] Full pytest suite green
- [ ] mypy clean
- [ ] Commit made

---

## Task 2.5: Verify Phase 2 acceptance and prepare PR #3

### Classification: trivial
### Required Docs
- This plan, Tasks 2.1-2.4
- `docs/specs/2026-06-25-backend-visit-payment-api-design.md` — "Acceptance gates" section

### Task Description
Verify Phase 2 is complete and ready for PR.

**Steps:**

- [ ] **Run scenarios 21-23 (3 tests):**
  ```bash
  cd backend && pytest tests/test_api_payments.py -v -k "patch_payment"
  ```
  Expected: 3 passed.

- [ ] **Run full backend test suite:**
  ```bash
  cd backend && pytest tests/ -q
  ```
  Expected: 100% green.

- [ ] **Run mypy:**
  ```bash
  cd backend && mypy src/
  ```

- [ ] **Run alembic check:**
  ```bash
  cd backend && alembic check
  ```

- [ ] **Update scratchpad** with Phase 2 status. All 23 scenarios should be passing.

- [ ] **Report status** to architect with final summary.

### Definition of Done
- [ ] All Phase 2 verifications green
- [ ] All 23 user scenarios pass
- [ ] Status reported to architect

---

# Cross-cutting verification

After all 3 phases are done, the architect will:
1. Dispatch code-quality-reviewer (full two-stage review)
2. Verify `mypy`, `alembic check`, full `pytest` all clean
3. Coordinate PR creation (1 PR per phase, 3 PRs total)
4. Coordinate merge to main

---

# Open Questions for User (resolve before starting Phase 0)

### Q1: Seed update for GH-104 acceptance #6
**Issue:** GH-104 acceptance criteria require "All seeded visits have a `tariff_id` set". The spec is silent on this.

**Options:**
- **A. Add to Phase 0** (recommended) — small, 1 file change (`backend/src/seed/seed.py`). Add `tariff_id` to each visit in seed. Phase 0 will go from ~40 lines to ~50 lines.
- **B. Defer to follow-up issue** — Phase 0 ships without seed update; user creates separate issue. Phase 0 stays small.

### Q2: PR split
The spec recommends 3 PRs (one per phase). The handoff says "3 PRs". **Confirmed 3 PRs.** No action needed.

### Q3: Worktree base branch
The 7 spec commits are in `local main` (9fa1a69) but not yet pushed to `origin/main` (cee8811).

**Options:**
- **A. Worktree from local main** (recommended) — spec is available in worktree. Push spec commits at finishing step. **Default for this plan.**
- **B. Push spec first via `--no-verify`** — pre-push hook is broken (ELOOP on `packages/domain/node_modules`). User should approve bypassing the hook.

### Q4: Plan granularity
This plan breaks Phase 1 into 5 sub-tasks (1.1-1.5). Each is a coherent TDD cycle (test + implement + verify). Some may be further split if a single sub-agent dispatch is too large (>500 lines). **Architect will decide per dispatch.**

---

# Self-Review (architect's notes)

### Spec coverage
- ✅ All 23 user scenarios mapped to a task
- ✅ All spec-mentioned files covered
- ✅ No "TODO" / "TBD" / "implement later"
- ✅ Each task has Required Docs
- ✅ TDD pattern: RED → GREEN → REFACTOR for each chunk

### Discrepancies found and fixed
1. **Test paths:** Spec says `backend/tests/api/`, actual is `backend/tests/test_api_*.py` (flat). **Plan uses correct paths.**
2. **Scenario numbers in Implementation phases section of spec** are inconsistent with the Scenarios section. **Plan uses canonical numbering from the Scenarios section.**

### Risks
- The `RecordService._check_capacity` removal is a breaking change. The free function `check_activity_capacity` must be a drop-in replacement. Task 1.4 explicitly runs `test_api_records.py` to verify no regression.
- `VisitService` is hand-rolled (per spec design decision) — keep code clean and DRY.

### Notes for implementer
- **Required skills per task** — invoke `pytest-patterns` and `test-driven-development` BEFORE writing code. Both are listed in the project's `.opencode/skills/`.
- **For TDD, do NOT skip the RED step** — write the failing test, run it, watch it fail, then implement. This is non-negotiable per the project's workflow.
- **The pre-push hook is broken** (ELOOP on `packages/domain/node_modules`). Don't try to push during implementation — the architect handles pushing at the finishing step.
