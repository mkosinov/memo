# E2E Fix + Speedup Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 4 failing e2e tests in PR #63 (root cause: `capacity` handling) + consolidate nullable fields across DB/Pydantic + reduce e2e duration to fit under 15-min CI timeout.

**Architecture:**
- Task 1 (DONE): diagnostic — root cause found in `transformers.ts:60`
- Task 2: regression unit test for correct capacity behavior
- Task 3: Option A fix — remove `maxCapacity` from Service, remove capacity from handleServiceChange
- Task 4: nullable audit — align Pydantic Optional fields with SQLite NOT NULL constraints
- Task 5: CI sharding + retries reduction
- Task 6: verify CI green

**Tech Stack:** Next.js 14 + TypeScript + Playwright + FastAPI + Pydantic v2 + SQLite + GitHub Actions matrix strategy.

**Worktree:** `/root/workspace/memo/.worktrees/feat-photo-searchable-select/` (branch `feat/photo-searchable-select`, PR #63).

---

## Task 2: Regression unit test for capacity behavior

### Classification: small
### Required Docs
- `frontend/admin/__tests__/ScheduleContext.test.tsx` (read lines 308-341 — existing "calls patchActivity" test pattern)
- `frontend/admin/contexts/ScheduleContext.tsx` (read lines 395-419 — updateActivityFn)
- `frontend/admin/lib/transformers.ts` (read lines 54-66 — current transformService)

### Task Description

Add two tests that lock in the correct behavior after the fix. These serve as regression protection.

**Subagent: `frontend-coder`**

**Steps:**
- [ ] **1.** Open `frontend/admin/__tests__/ScheduleContext.test.tsx`.
- [ ] **2.** Find the existing test at line 308 ("calls patchActivity mutation when updateActivity is called").
- [ ] **3.** Add **Test A** right after it — "does NOT include capacity in PATCH when capacity is null":
  ```typescript
  it('excludes capacity from PATCH payload when capacity is null', async () => {
    // ... mock same as existing test (getMasters, getServices, getLocations, getActivities) ...
    // ... mock patchActivity with vi.fn().mockResolvedValue({...}) ...
    
    renderWithContext();
    await waitFor(() => { expect(screen.getByTestId('activity-count').textContent).toBe('1'); });
    
    act(() => { screen.getByTestId('update-activity').click(); });
    
    await waitFor(() => { expect(patchActivity).toHaveBeenCalled(); });
    // Key assertion: payload does NOT contain capacity when it would be null
    const callArgs = patchActivity.mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty('capacity');
  });
  ```
- [ ] **4.** Add **Test B** — "sends snake_case fields with correct capacity when capacity is defined":
  ```typescript
  it('includes capacity in PATCH payload when capacity has a value', async () => {
    // ... same mocks ...
    renderWithContext();
    await waitFor(() => { expect(screen.getByTestId('activity-count').textContent).toBe('1'); });
    
    // Simulate updateActivity with a defined capacity
    act(() => { screen.getByTestId('update-activity-with-capacity').click(); });
    
    await waitFor(() => { expect(patchActivity).toHaveBeenCalled(); });
    const callArgs = patchActivity.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('capacity', 8);
    expect(callArgs[1]).toHaveProperty('service_id');
    expect(callArgs[1]).toHaveProperty('duration');
  });
  ```
  Note: You may need to add a second button `update-activity-with-capacity` in the test helper component that calls `updateActivity('a1', { capacity: 8, serviceId: 's5', durationMinutes: 120 })`.
- [ ] **5.** Add/update **Test C** — "does NOT have maxCapacity in Service type" (compile-time check):
  ```typescript
  it('transformService does not produce maxCapacity', async () => {
    // This is a compile-time + runtime check
    const mockRaw = { id: 's1', title: 'Test', duration: 120, min_age: 12, max_age: null, tariffs: [], tags: [], description: '', image_url: '', specialty: '', record_info: '', is_active: true, created_at: '', updated_at: '' } as any;
    const result = transformService(mockRaw);
    expect(result).not.toHaveProperty('maxCapacity');
  });
  ```
  This test imports `transformService` from `lib/transformers` — add import at top of file if not present.
- [ ] **6.** Run tests: `cd frontend/admin && pnpm exec vitest run __tests__/ScheduleContext.test.tsx`
- [ ] **7.** Tests should **FAIL** today (because maxCapacity still exists and capacity null is still sent). This is the RED gate.
- [ ] **8.** Commit: `git add frontend/admin/__tests__/ScheduleContext.test.tsx && git commit -m "test(ScheduleContext): add regression tests for capacity in PATCH payload"`

---

## Task 3: Option A fix — remove maxCapacity, fix capacity handling

### Classification: small
### Required Docs
- `frontend/admin/lib/transformers.ts` (read lines 54-66 — transformService)
- `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx` (read lines 53-71 — handleServiceChange)
- `frontend/admin/contexts/ScheduleContext.tsx` (read lines 395-419 — updateActivityFn)
- Skill `test-driven-development` (RED → GREEN → REFACTOR)

### Task Description

Fix the root cause: remove the wrong `maxCapacity` mapping and stop sending `capacity` when service changes (capacity is a location property, not a service property).

**Subagent: `frontend-coder`**

**Steps:**
- [ ] **1.** `frontend/admin/lib/transformers.ts:60` — remove the line `maxCapacity: raw.max_age`:
  ```typescript
  // BEFORE:
  export function transformService(raw: ServiceResponse): Service {
    return {
      id: raw.id,
      name: raw.title,
      duration: raw.duration / 60,
      durationMinutes: raw.duration,
      maxCapacity: raw.max_age,  // DELETE THIS LINE
      minAge: `${raw.min_age}`,
      maxAge: raw.max_age != null ? `${raw.max_age}` : undefined,
      defaultAdultPrice: raw.tariffs?.[0]?.price ?? 0,
      description: raw.description,
    };
  }
  
  // AFTER:
  export function transformService(raw: ServiceResponse): Service {
    return {
      id: raw.id,
      name: raw.title,
      duration: raw.duration / 60,
      durationMinutes: raw.duration,
      minAge: `${raw.min_age}`,
      maxAge: raw.max_age != null ? `${raw.max_age}` : undefined,
      defaultAdultPrice: raw.tariffs?.[0]?.price ?? 0,
      description: raw.description,
    };
  }
  ```
- [ ] **2.** Check the `Service` type in domain package (`packages/domain` or `@memo/domain`) — remove `maxCapacity` from the type definition. Search: `find /root/workspace/memo/.worktrees/feat-photo-searchable-select/packages -name "*.ts" -exec grep -l "maxCapacity" {} \;`
- [ ] **3.** `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx:60-67` — remove `capacity: svc.maxCapacity` from `handleServiceChange`:
  ```typescript
  // BEFORE:
  onUpdate({
    serviceId: newServiceId,
    serviceName: svc.name,
    minAge: svc.minAge,
    duration: svc.duration,
    durationMinutes: svc.durationMinutes || svc.duration * 60,
    capacity: svc.maxCapacity,  // DELETE THIS LINE
  });
  
  // AFTER:
  onUpdate({
    serviceId: newServiceId,
    serviceName: svc.name,
    minAge: svc.minAge,
    duration: svc.duration,
    durationMinutes: svc.durationMinutes || svc.duration * 60,
  });
  ```
- [ ] **4.** `frontend/admin/contexts/ScheduleContext.tsx:402` — add null guard (belt + suspenders):
  ```typescript
  // BEFORE:
  if (updates.capacity !== undefined) payload.capacity = updates.capacity;
  
  // AFTER:
  if (updates.capacity !== undefined && updates.capacity !== null) payload.capacity = updates.capacity;
  ```
- [ ] **5.** Search for any other references to `maxCapacity` in the frontend codebase: `grep -rn "maxCapacity" /root/workspace/memo/.worktrees/feat-photo-searchable-select/frontend/admin/`. Remove or update any remaining usages.
- [ ] **6.** Run the regression tests from Task 2: `cd frontend/admin && pnpm exec vitest run __tests__/ScheduleContext.test.tsx`
- [ ] **7.** Run all frontend vitest: `cd frontend/admin && pnpm exec vitest run`
- [ ] **8.** Run the failing e2e test locally:
  ```bash
  cd frontend/admin && pnpm exec playwright test e2e/activity-details-modal.spec.ts --reporter=line
  ```
  Expected: all 8+ tests in this file PASS.
- [ ] **9.** If all pass, run the 4 originally failing e2e tests together:
  ```bash
  pnpm exec playwright test \
    e2e/activity-details-modal.spec.ts \
    e2e/clients.spec.ts \
    e2e/records.spec.ts \
    --reporter=line
  ```
  Expected: ALL PASS.
- [ ] **10.** If tests #2-#4 still fail, STOP and report to @architect — do NOT speculatively fix them.
- [ ] **11.** Commit: `git add -A && git commit -m "fix(schedule): remove maxCapacity from Service, stop sending capacity on service change"`

---

## Task 4: Nullable consolidation — align DB NOT NULL with Pydantic schemas

### Classification: standard
### Required Docs
- `backend/src/schemas/activity.py` — ActivityBase, ActivityCreate, ActivityUpdate, ActivityPatch
- `backend/src/models/activity.py` — SQLAlchemy model (check nullable on each column)
- Backend SQLite schema: check `memo.db` for actual constraints (run `sqlite3 backend/memo.db ".schema activities"`)
- `backend/src/schemas/master.py`, `service.py`, `location.py`, `record.py`, `client.py`, `payment.py` — all entity schemas
- `backend/src/models/` — all entity models
- Skill `domain-rules` (entity fields, validation rules)

### Task Description

Audit all entity schemas and models to find mismatches between:
- Pydantic schema: field is `Optional[X] = None` (nullable)
- SQLAlchemy model: column is `nullable=True` (allows NULL in DB)
- SQLite table: column is `NULL` or `NOT NULL`

**Subagent: `backend-coder`**

**Steps:**
- [ ] **1.** For each entity (activity, master, service, location, record, client, payment, visitor), extract the SQLite schema:
  ```bash
  cd /root/workspace/memo/.worktrees/feat-photo-searchable-select/backend
  sqlite3 memo.db ".schema activities" > /tmp/schema_activities.sql
  sqlite3 memo.db ".schema masters" > /tmp/schema_masters.sql
  # ... repeat for all tables
  ```
- [ ] **2.** For each entity, compare the Pydantic schema fields with the SQLite constraints:
  - Pydantic `Optional[X] = None` → DB allows NULL → ✅ consistent
  - Pydantic `X` (required) → DB `NOT NULL` → ✅ consistent
  - Pydantic `Optional[X] = None` → DB `NOT NULL` → ❌ **MISMATCH** — Pydantic allows None but DB rejects it
  - Pydantic `X` (required) → DB `NULL` → ❌ **MISMATCH** — Pydantic requires value but DB allows None
- [ ] **3.** Write a table of all mismatches to `.opencode/scratchpad.md` under `## Task 4 Findings`.
- [ ] **4.** For each mismatch, decide the correct behavior:
  - If field SHOULD be NOT NULL in DB (e.g., `capacity`): change Pydantic schema to `X` (required) in base/create/update, keep `Optional[X] = None` in Patch schema (for partial updates)
  - If field SHOULD be nullable: change SQLAlchemy model to `nullable=True` and run Alembic migration
- [ ] **5.** Apply fixes to Pydantic schemas (`backend/src/schemas/*.py`).
- [ ] **6.** If SQLAlchemy model changes needed: create Alembic migration (`cd backend && alembic revision --autogenerate -m "description" && alembic upgrade head`).
- [ ] **7.** If no model changes needed (only Pydantic schema changes): skip migration.
- [ ] **8.** Run backend tests: `cd backend && python -m pytest -x -v`
- [ ] **9.** Commit: `git add -A && git commit -m "fix(schemas): align Pydantic Optional fields with SQLite NOT NULL constraints"`

---

## Task 5: CI speedup — retries + sharding

### Classification: small
### Required Docs
- `frontend/admin/playwright.config.ts` (lines 24-25 — current retries/workers)
- `.github/workflows/test.yml` (lines 101-154 — current e2e job)

### Task Description

Two independent config changes for e2e speedup.

**Subagent: `frontend-coder` (config) + `infra` (CI yaml)**

**Steps:**

### 5a. Reduce retries
- [ ] **1.** Open `frontend/admin/playwright.config.ts`.
- [ ] **2.** Line 24: change `retries: process.env.CI ? 2 : 0` → `retries: process.env.CI ? 1 : 0`.
- [ ] **3.** Commit: `git add frontend/admin/playwright.config.ts && git commit -m "ci(playwright): reduce CI retries from 2 to 1"`

### 5b. Shard e2e in CI
- [ ] **4.** Open `.github/workflows/test.yml`.
- [ ] **5.** Replace the `e2e-tests` job with a matrix-sharded version. Key changes:
  - Add `strategy.matrix.shard: [1, 2]` + `fail-fast: false`
  - Add `timeout-minutes: 25` to the job
  - Pass `--shard=${{ matrix.shard }}/2` to `pnpm exec playwright test`
- [ ] **6.** Example (adapt to current structure):
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
      - uses: actions/checkout@v4
      - name: Install uv
        uses: astral-sh/setup-uv@v3
      - name: Install pnpm
        uses: pnpm/action-setup@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - name: Set up Python
        run: uv python install 3.12
      - name: Install backend dependencies
        working-directory: backend
        run: uv sync --extra dev
      - name: Install frontend dependencies
        run: pnpm install --frozen-lockfile
      - name: Install Playwright browsers
        working-directory: frontend/admin
        run: pnpm exec playwright install --with-deps chromium
      - name: Run E2E tests (shard ${{ matrix.shard }}/2)
        run: |
          cd backend
          uv run python -m src.seed
          uv run uvicorn src.main:app --host 0.0.0.0 --port 8000 &
          BACKEND_PID=$!
          cd ../frontend/admin
          for i in $(seq 1 30); do
            if curl -sf http://localhost:8000/api/v1/health > /dev/null 2>&1; then break; fi
            sleep 2
          done
          pnpm exec playwright test --shard=${{ matrix.shard }}/2
          EXIT_CODE=$?
          kill $BACKEND_PID 2>/dev/null || true
          exit $EXIT_CODE
        env:
          DATABASE_URL: sqlite+aiosqlite:///./test_memo.db
          TEST_DB_PATH: ../../backend/test_memo.db
          NEXT_PUBLIC_API_URL: http://127.0.0.1:8000
  ```
- [ ] **7.** Commit: `git add .github/workflows/test.yml && git commit -m "ci: shard e2e tests across 2 parallel jobs, add 25min timeout"`

---

## Task 6: Push + verify CI green

### Classification: trivial
### Task Description

**Subagent: `general` or `infra`**

**Steps:**
- [ ] **1.** Push: `git push origin feat/photo-searchable-select`
- [ ] **2.** Wait: `gh pr checks 63 --watch --interval 30`
- [ ] **3.** Verify ALL checks are SUCCESS:
  - backend-tests (unit, api, integration, misc)
  - frontend-tests (1-5)
  - backend-coverage
  - e2e-tests shard 1 — duration < 12 min
  - e2e-tests shard 2 — duration < 12 min
- [ ] **4.** If any check FAILS: report to @architect with details.
- [ ] **5.** If all GREEN: report final duration per shard to user. PR is ready to merge.
