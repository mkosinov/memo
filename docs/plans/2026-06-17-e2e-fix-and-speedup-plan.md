# E2E Fix + Speedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 4 failing e2e tests in PR #63 (PR `feat/photo-searchable-select`) and reduce e2e job duration to fit comfortably under 15-min CI timeout.

**Architecture:**
- Track A: bug-fix — investigate real root cause of `PATCH /api/v1/activities/ev_35 → 422`, then add regression unit test + fix.
- Track B1: trivial config change — reduce Playwright retries from 2 to 1.
- Track B2: CI sharding — split 156 e2e tests across 2 GitHub Actions shards via `playwright --shard=N/M`.

**Tech Stack:** Next.js 14 + TypeScript + Playwright + FastAPI + Pydantic v2 + GitHub Actions matrix strategy.

**Worktree:** `/root/workspace/memo/.worktrees/feat-photo-searchable-select/` (already exists, branch `feat/photo-searchable-select` for PR #63).

---

## Context: Diagnostic Findings (from Phase 1+2)

### Failures observed in last full run (CI run #27675909955, 2026-06-17 08:28–08:43)
- **10 failed attempts / 146 passed / 13.7 min duration**
- 4 unique failing tests:
  1. `e2e/activity-details-modal.spec.ts:206` "Settings update — service_id changes in DB"
  2. `e2e/clients.spec.ts:434` "Record tab shows all fields"
  3. `e2e/records.spec.ts:307` "Sorting — click header toggles sort direction"
  4. `e2e/records.spec.ts:575` "Payment status — displays payment indicator"

### Primary symptom (test #1)
- Test calls `serviceSelect.selectOption(differentService.id)` on `ev_35` activity
- Backend log: `PATCH /api/v1/activities/ev_35 HTTP/1.1" 422 Unprocessable Entity`
- After 1s wait, DB still shows `service_id = "s1"` instead of expected `"s5"`
- Retry x2 — all fail with same symptom

### Code paths involved
- Frontend trigger: `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx:53-71` (`handleServiceChange` → `onUpdate({serviceId, serviceName, minAge, duration, durationMinutes, capacity})`)
- Frontend mapper (already exists): `frontend/admin/contexts/ScheduleContext.tsx:395-419` (`updateActivityFn` — already maps `serviceId → service_id`, `masterId → master_id`, etc.)
- API client: `packages/api-client/src/endpoints.ts:184-192` (`patchActivity` — sends JSON body)
- Backend router: `backend/src/api/v1/activities.py:91-102` (PATCH uses `ActivityPatch` schema)
- Backend schema: `backend/src/schemas/activity.py:34-45` (`ActivityPatch` — all fields `Optional`, should accept any subset)
- Backend service: `backend/src/services/generic.py:72-81` (`patch` uses `model_dump(exclude_unset=True)`)

### Important correction
- **Original hypothesis (no camelCase mapper) was WRONG.** Mapper exists at `contexts/ScheduleContext.tsx:395-419`.
- **Real root cause unknown** — must be investigated by reproducing locally and inspecting PATCH body + backend validation error message.
- Failure #1 returns 422 (backend rejected the body), so the bug is in what the body contains, not in how it's routed.

---

## Task 1: Local reproduction + root cause analysis

### Classification: small
### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx` (read lines 53-71 to understand exactly what fields are sent)
- `frontend/admin/contexts/ScheduleContext.tsx` (read lines 395-419 to understand current payload mapping)
- `backend/src/schemas/activity.py` (read ActivityPatch — all fields should be Optional)
- `frontend/admin/e2e/activity-details-modal.spec.ts` (read lines 204-247 — the failing test)
- Skill `dev-workflow` (PTY rules, test execution)

### Task Description
The 422 in CI logs does not tell us WHAT field is rejected or WHY. We must reproduce the exact request locally and capture the full PATCH body + backend validation error.

**Subagent: `frontend-coder` (knowledge of Next.js dev + Playwright)**

**Steps:**
- [ ] **1.** Open worktree: `cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/`
- [ ] **2.** Read `.opencode/scratchpad.md` to confirm workflow state.
- [ ] **3.** Start dev environment using project `dev.sh` (per `dev-workflow` skill — PTY required, do NOT use plain bash for long-running processes).
- [ ] **4.** Verify backend is healthy: `curl http://localhost:8000/api/v1/health`
- [ ] **5.** Open admin UI in headless browser; navigate to schedule view; wait for activities to load.
- [ ] **6.** Open an activity modal (click any visible activity card like `ev_35`).
- [ ] **7.** In the Settings tab, programmatically change the `select-service` dropdown to a different service id (use the same logic as `activity-details-modal.spec.ts:206` — `serviceSelect.selectOption(differentService.id)` then `blur()`).
- [ ] **8.** Capture two things:
  - (a) The **full PATCH request body** sent to `/api/v1/activities/ev_35` (use Playwright `page.route()` to intercept, or inspect backend uvicorn logs which log request bodies).
  - (b) The **backend validation error message** for 422 (FastAPI returns `{"detail": [...]}` with field-level errors — extract this from the response or backend logs).
- [ ] **9.** Write findings to `.opencode/scratchpad.md` under a new section `## Task 1 Findings` with:
  - Exact PATCH body as JSON
  - Exact 422 error from backend (field name + reason)
  - Hypothesis: which field/value causes the rejection
- [ ] **10.** DO NOT FIX anything yet — only diagnose. Report back to @architect with findings.

**Output:** A diagnosis section in scratchpad + a clear hypothesis of what to fix in Task 3.

---

## Task 2: Add regression unit test

### Classification: small
### Required Docs
- `frontend/admin/__tests__/ScheduleContext.test.tsx` (read full file — see existing test patterns, especially line 308 "calls patchActivity mutation when updateActivity is called")
- `frontend/admin/contexts/ScheduleContext.tsx` (read lines 1-100 to understand provider/mocks setup)

### Task Description
Add a unit test in `ScheduleContext.test.tsx` that locks in correct PATCH payload mapping. This is a RED test that fails today if the mapper sends the wrong field names — protects against regression.

**Subagent: `frontend-coder`**

**Steps:**
- [ ] **1.** Open `frontend/admin/__tests__/ScheduleContext.test.tsx`.
- [ ] **2.** Find the existing test at line 308 ("calls patchActivity mutation when updateActivity is called"). Mirror its structure.
- [ ] **3.** Add a new test `it('sends snake_case fields in PATCH payload when updating service', async () => { ... })` placed right after the existing test. The test should:
  - Mock `getMasters`, `getServices`, `getLocations`, `getActivities` (copy from existing test).
  - Mock `patchActivity` with `vi.fn().mockResolvedValue(...)`.
  - Call `updateActivity('a1', { serviceId: 's5', durationMinutes: 120, capacity: 8 })`.
  - Assert `patchActivity` was called with `'a1'` and a payload object that:
    - Contains key `service_id` (NOT `serviceId`)
    - Contains key `duration` (NOT `durationMinutes`)
    - Contains key `capacity`
    - Does NOT contain key `serviceId`
    - Does NOT contain key `durationMinutes`
- [ ] **4.** Run the test: `cd frontend/admin && pnpm exec vitest run __tests__/ScheduleContext.test.tsx`
- [ ] **5.** Test should PASS today (because the mapper exists) — this is a regression test, not a RED test. If it FAILS, report back to @architect (mapper may have a bug).
- [ ] **6.** Commit: `git add frontend/admin/__tests__/ScheduleContext.test.tsx && git commit -m "test(ScheduleContext): assert snake_case PATCH payload for service update"`

**Why this is "small" not "standard":** single test file, ~30 lines added, follows existing pattern.

---

## Task 3: Fix the real root cause

### Classification: small OR standard (depends on Task 1 findings)
### Required Docs
- `.opencode/scratchpad.md` → read `## Task 1 Findings` (your diagnosis)
- `backend/src/schemas/activity.py` (if fix is backend)
- `frontend/admin/contexts/ScheduleContext.tsx` (if fix is frontend)
- Skill `test-driven-development` (RED → GREEN → REFACTOR)

### Task Description
Based on Task 1 diagnosis, apply the minimal fix. **Do NOT** speculatively rewrite the mapper — fix exactly what the diagnostic shows is broken.

**Subagent: `frontend-coder` (frontend fix) OR `backend-coder` (backend fix) — pick based on Task 1 findings.**

**Steps:**
- [ ] **1.** Read Task 1 Findings from scratchpad.
- [ ] **2.** If diagnosis is "wrong field name" or "wrong type" in frontend payload → fix `frontend/admin/contexts/ScheduleContext.tsx:395-419` `updateActivityFn`.
- [ ] **3.** If diagnosis is "backend schema rejects valid value" → fix `backend/src/schemas/activity.py::ActivityPatch` (e.g., add validator, allow Optional with `None`, etc.).
- [ ] **4.** If diagnosis is "missing field handling" (e.g., `startTime`/`day` not built into payload correctly when other fields present) → fix the conditional in `updateActivityFn`.
- [ ] **5.** Run the regression test from Task 2: `cd frontend/admin && pnpm exec vitest run __tests__/ScheduleContext.test.tsx`
- [ ] **6.** Re-run the failing e2e test locally (this catches the full UI → API → DB flow):
  ```bash
  cd frontend/admin
  pnpm exec playwright test e2e/activity-details-modal.spec.ts:206 --reporter=line
  ```
  Expected: PASS.
- [ ] **7.** If PASS, run all 4 originally failing tests together:
  ```bash
  pnpm exec playwright test \
    e2e/activity-details-modal.spec.ts \
    e2e/clients.spec.ts \
    e2e/records.spec.ts \
    --reporter=line
  ```
  Expected: ALL PASS. (The other 3 fails may resolve automatically once test #1 passes — they share the same backend state and may have been collateral failures.)
- [ ] **8.** If any of tests #2-#4 still fail, **STOP** and report findings to @architect. Do NOT speculatively fix them — they need their own diagnosis.
- [ ] **9.** Commit: `git add <changed files> && git commit -m "fix(schedule): <one-line description from Task 1 diagnosis>"`

**Output:** Fix committed. All 4 originally failing tests now pass locally (or specific subset reported back).

---

## Task 4: Apply Track B1 + B2 (speedup)

### Classification: small (config + CI yaml change, two files)
### Required Docs
- `frontend/admin/playwright.config.ts` (lines 24-25 — current retries/workers)
- `.github/workflows/test.yml` (lines 101-154 — current e2e job)

### Task Description
Two changes that are independent of the bug fix and can be applied together:

**Subagent: `infra` (CI yaml) or `frontend-coder` (config)**

**Steps:**

### 4a. Reduce retries (Track B1)
- [ ] **1.** Open `frontend/admin/playwright.config.ts`.
- [ ] **2.** Change line 24 from `retries: process.env.CI ? 2 : 0` to `retries: process.env.CI ? 1 : 0`.
- [ ] **3.** Commit: `git add frontend/admin/playwright.config.ts && git commit -m "ci(playwright): reduce CI retries from 2 to 1"`

### 4b. Shard e2e in CI (Track B2)
- [ ] **4.** Open `.github/workflows/test.yml`.
- [ ] **5.** Replace the `e2e-tests` job (lines 101-154) with a matrix sharded version. The new job should:
  - Have `strategy.matrix.shard: [1, 2]` (start with 2 shards; can bump to 3 later if needed)
  - Pass `--shard=${{ matrix.shard }}/2` to `pnpm exec playwright test`
  - Add `timeout-minutes: 25` to the job (safety net under 30-min GitHub max for free tier)
  - Keep all other steps identical (uv, pnpm, playwright install, seed, uvicorn, curl healthcheck)
- [ ] **6.** Example replacement (do NOT copy verbatim — adapt to current structure):
  ```yaml
  e2e-tests:
    runs-on: ubuntu-latest
    needs: [backend-tests, frontend-tests]
    timeout-minutes: 25
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2]
    steps:
      # ... same setup as before ...
      - name: Run E2E tests (shard ${{ matrix.shard }}/2)
        run: |
          cd backend
          uv run python -m src.seed
          uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 &
          BACKEND_PID=$!
          cd ../frontend/admin
          for i in $(seq 1 30); do
            if curl -sf http://localhost:8000/api/v1/health > /dev/null 2>&1; then
              break
            fi
            sleep 2
          done
          pnpm exec playwright test --shard=${{ matrix.shard }}/2
          EXIT_CODE=$?
          kill $BACKEND_PID 2>/dev/null || true
          exit $EXIT_CODE
  ```
- [ ] **7.** Commit: `git add .github/workflows/test.yml && git commit -m "ci: shard e2e tests across 2 parallel jobs"`

**Why:** 156 tests sequential ≈ 14 min. Splitting into 2 shards ≈ 7 min each, run in parallel. Combined with `retries=1`, more headroom under 15-min timeout.

---

## Task 5: Push + verify CI is green and fast

### Classification: trivial
### Required Docs
- None (verification only)

### Task Description
**Subagent: `general` (read-only verification) or `infra` (if push needed)**

**Steps:**
- [ ] **1.** Push branch: `git push origin feat/photo-searchable-select` (the PR is already open and tracks this branch).
- [ ] **2.** Wait for CI to start: `gh pr checks 63 --watch --interval 30`
- [ ] **3.** Verify ALL of the following are SUCCESS:
  - backend-tests (unit, api, integration, misc)
  - frontend-tests (1-5)
  - backend-coverage
  - **e2e-tests (shard 1)** — duration target < 12 min
  - **e2e-tests (shard 2)** — duration target < 12 min
- [ ] **4.** Get final durations: `gh run list --branch feat/photo-searchable-select --limit 1 --json jobs --jq '.jobs[] | select(.name | startswith("e2e-tests")) | {name, startedAt, completedAt}'`
- [ ] **5.** Write summary to `.opencode/scratchpad.md` under `## Task 5 Results`:
  - Total duration per shard
  - Pass/fail counts per shard
  - Any remaining flakes (tests that failed once but passed on retry)
- [ ] **6.** Report to user: PR #63 is ready to merge (or list remaining issues).

**Success criteria:**
- Both e2e shards < 12 min
- All other checks pass
- No more `PATCH 422` errors in logs

---

## Self-Review Notes

- **Scope check:** Plan is small (5 tasks, ~1-2 hours total). Within reason.
- **Placeholders:** All file paths, commands, and code patterns are concrete. Task 3 intentionally defers exact fix to diagnostic — that's correct because we don't know the bug yet.
- **Spec coverage:**
  - Track A (fix failing tests) → Tasks 1, 2, 3 ✓
  - Track B1 (retries) → Task 4a ✓
  - Track B2 (sharding) → Task 4b ✓
  - Verification → Task 5 ✓
- **Risk:** Task 3 depends on Task 1 findings. If findings reveal a deeper issue (e.g., 4 separate root causes), plan will need revision — handled by "STOP and report" step in Task 3.
- **No premature optimization:** We do NOT touch `workers` in Playwright config (Track B3) — it requires per-worker DB isolation, deferred.
