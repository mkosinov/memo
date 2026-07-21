# Test-debt Wave 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-enable 5 disabled tests (4 E2E + 1 vitest) that are now unblocked by the #124 Wave 1 openModal fix, plus harden one flaky E2E test with a retry/poll pattern.

**Architecture:** Three independent small tasks touching only test files (`.spec.ts`, `.test.tsx`). No production code changes. Task 2.1 adds an `expect.poll` retry to a flaky API-only E2E test. Task 2.2 un-skips 3 `test.fixme` E2E tests that were blocked by openModal (now fixed). Task 2.3 rewrites a vitest test whose premise was doubly wrong — the testid it referenced does not exist and the assertion target (`btn-save-record`) is unrelated to visit status changes.

**Tech Stack:** Playwright E2E (TypeScript), Vitest + @testing-library/react (TypeScript/React)

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Scenario 18 re-enabled** → E2E test verifies that hard-deleting a payment removes it from client stats; the GET-after-POST flake is mitigated by a 5s retry/poll — the test no longer flakes on backend write-visibility timing.
- **US-M09 re-enabled** → E2E test verifies that switching client tabs in the activity modal does not change the modal's width/height/position (no "jump").
- **US-M10 re-enabled** → E2E test verifies that the schedule footer is visually blurred when a modal dialog is open (modal has a backdrop overlay with positive z-index).
- **US-M01 re-enabled** → E2E test verifies that the "Приватное" label is stacked above the toggle selector in the Settings tab of the activity modal.
- **Vitest status-cycle re-enabled** → Unit test verifies that selecting "visited" from the per-visit StatusPicker dropdown calls `patchVisit` with `{ status: 'visited' }` — replacing the stale `visit-status-icon` / `btn-save-record` assertions that no longer match the implementation.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/admin/e2e/unified-rows.spec.ts` | modify (sc.18 only) | Replace `test.skip` with `test(...)`, add `expect.poll` retry on GET /payments/{id} |
| `frontend/admin/e2e/modal-blur-footer.spec.ts` | modify (test + header) | `test.fixme` → `test`, update `#XXX` → `#157` |
| `frontend/admin/e2e/modal-no-jump.spec.ts` | modify (test + header) | `test.fixme` → `test`, update `#XXX` → `#156` |
| `frontend/admin/e2e/private-toggle-layout.spec.ts` | modify (test + header) | `test.fixme` → `test`, update `#XXX` → `#158` |
| `frontend/admin/__tests__/ClientsIntegration.test.tsx` | modify (1 test + mock block) | Replace `it.skip` with rewritten `it`, add `patchVisit` to mock block |

---

## Task 1: Scenario 18 — retry/poll around GET /payments/{id} (#155)

### Classification: small
### Required Docs
- `docs/domain-rules/payments.md` — payment entity, API endpoints (DELETE → 204, GET → 200/404)
- `docs/specs/2026-07-21-test-debt-wave2a-design.md` — task 2.1 section (exact code snippet)
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — Playwright `expect.poll` idiomatic retry pattern

### Task Description

**File:** `frontend/admin/e2e/unified-rows.spec.ts` (line 854)

The test is currently skipped with `test.skip(true, 'pre-existing backend flake (GH #155): GET /payments/{id} non-OK immediately after POST — pure API test (no openModal); exposed by #124 Wave 1 test-ordering shift. Skip pending backend write-visibility fix.');`

This is a pure API test (`async ({ request })` — no `page` fixture). The flake: `GET /api/v1/payments/${payment.id}` returns non-OK immediately after `POST /api/v1/payments` creates it. The fix is to add a retry/poll on the GET at line 870.

**Steps:**

- [ ] **Read lines 852-898** of `unified-rows.spec.ts` to see the current test structure.
- [ ] **Replace the test signature** (line 854):
  ```typescript
  // BEFORE:
  test.skip('scenario 18: hard delete removes payment from stats', async ({ request }) => {
    test.skip(true, 'pre-existing backend flake (GH #155): ...');
  // AFTER:
  test('scenario 18: hard delete removes payment from stats', async ({ request }) => {
  ```
- [ ] **Wrap the GET verification** (lines 870-871) in `expect.poll`:
  ```typescript
  // BEFORE:
  const getResp = await request.get(`${BACKEND}/api/v1/payments/${payment.id}`);
  expect(getResp.ok()).toBeTruthy();

  // AFTER:
  // GH #155: backend write not immediately readable — poll until OK
  await expect.poll(async () => {
    const r = await request.get(`${BACKEND}/api/v1/payments/${payment.id}`);
    return r.ok();
  }, { timeout: 5_000, intervals: [200, 500, 1000] }).toBeTruthy();
  ```
- [ ] **Verify** the `try/finally` cleanup block (lines 894-898) is unchanged — cleanup still runs if the poll passes or fails.
- [ ] **Run vitest** (type-check the test file compiles): `cd frontend/admin && pnpm run test -- --run unified-rows` — though this is an E2E test, vitest should not report compilation errors.
- [ ] **Commit:** `fix(#155): add retry/poll to scenario 18 GET /payments/{id} — un-skip`

**DoD:**
- `test.skip(true, ...)` replaced with `test(...)`
- Line 870 GET wrapped in `expect.poll` with 5s timeout
- `try/finally` cleanup preserved
- No other lines changed in this file

---

## Task 2: Un-skip 3 fixme E2E tests (US-M09, US-M10, US-M01) (#156, #157, #158)

### Classification: small
### Required Docs
- `docs/specs/2026-07-21-test-debt-wave2a-design.md` — task 2.2 section (per-file instructions)
- `frontend/admin/e2e/fixtures/helpers.ts` — `openModal` and `waitForScheduleReady` signatures (openModal now targets by activity_id after #124 Wave 1)

### Task Description

3 E2E spec files each have a single `test.fixme` blocked by the old openModal bug (now fixed). Each needs: `test.fixme` → `test`, annotation `#XXX` → real issue number, header comment `#XXX` → real issue number.

### Task 2a: modal-blur-footer.spec.ts (#157, US-M10)

**File:** `frontend/admin/e2e/modal-blur-footer.spec.ts`

- [ ] **Line 6 header comment:** `#XXX (to be filed separately)` → `#157`
- [ ] **Line 8 test signature:**
  ```typescript
  // BEFORE:
  test.fixme('US-M10: Schedule footer blurs when modal is open [deferred: openModal dialog not opening, see GH issue #XXX]', async ({ page }) => {
  // AFTER:
  test('US-M10: Schedule footer blurs when modal is open [GH #157 — unblocked by #124 Wave 1 openModal fix]', async ({ page }) => {
  ```
- [ ] **Verify** the rest of the test body is unchanged (lines 9-30).

### Task 2b: modal-no-jump.spec.ts (#156, US-M09)

**File:** `frontend/admin/e2e/modal-no-jump.spec.ts`

- [ ] **Line 6 header comment:** `#XXX (to be filed separately)` → `#156`
- [ ] **Line 8 test signature:**
  ```typescript
  // BEFORE:
  test.fixme('US-M09: Modal does not jump when switching tabs [deferred: openModal dialog not opening, see GH issue #XXX]', async ({ page }) => {
  // AFTER:
  test('US-M09: Modal does not jump when switching tabs [GH #156 — unblocked by #124 Wave 1 openModal fix]', async ({ page }) => {
  ```
- [ ] **Verify** the rest of the test body is unchanged (lines 9-43).

### Task 2c: private-toggle-layout.spec.ts (#158, US-M01)

**File:** `frontend/admin/e2e/private-toggle-layout.spec.ts`

- [ ] **Line 6 header comment:** `#XXX (to be filed separately)` → `#158`
- [ ] **Line 8 test signature:**
  ```typescript
  // BEFORE:
  test.fixme('US-M01: "Приватное" label is stacked above selector [deferred: settings tab not found, see GH issue #XXX]', async ({
  // AFTER:
  test('US-M01: "Приватное" label is stacked above selector [GH #158 — unblocked by #124 Wave 1 openModal fix]', async ({
  ```
- [ ] **Verify** the rest of the test body is unchanged (lines 10-36).

### Task 2 commit

- [ ] **Commit:** `fix(#156,#157,#158): un-skip US-M09, US-M10, US-M01 — openModal fixed in #124 Wave 1`

**DoD:**
- 3 files: each `test.fixme` → `test`, `#XXX` → real issue number (in test name + header comment)
- No test body logic changed
- No other files touched

---

## Task 3: Rewrite vitest ClientsIntegration:446 for StatusPicker (#163)

### Classification: small
### Required Docs
- `docs/domain-rules/visits.md` — VisitStatus enum (waiting, visited, missed, cancelled), PATCH /api/v1/visits/{id} endpoint
- `docs/specs/2026-07-21-test-debt-wave2a-design.md` — task 2.3 section (real impl verified, new test code)
- `frontend/admin/app/components/shared/StatusPicker.tsx` — testid pattern: `${prefix}-trigger`, `${prefix}-popover`, `${prefix}-option-${status}`
- `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx:438` — StatusPicker rendered with `testIdPrefix={isNew ? 'add-visitor-status' : \`visit-${r.id}-status\`}`
- `frontend/admin/hooks/useRecordMutations.ts:320-329` — `patchVisit` calls `apiPatchVisit(visitId, data)` then `upsertVisit`
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — vitest patterns, @testing-library/react usage

### Task Description

**File:** `frontend/admin/__tests__/ClientsIntegration.test.tsx` (line 446)

The skipped test (`it.skip`) has a doubly-wrong premise:
1. `visit-status-icon` testid does not exist — the real impl is `StatusPicker` with testid `visit-${visitId}-status-{trigger,popover,option-${status}}`.
2. Clicking status does NOT enable `btn-save-record` — visit status changes go through `onPatchVisit(visitId, {status})` directly, not through record-level `hasChanges`/`handleSave`.

Additionally, the `@memo/api-client` mock block (lines 11-39) does NOT export `patchVisit`. The `useRecordMutations` hook calls `apiPatchVisit` from `@memo/api-client`, so it must be added to the mock.

### TDD approach

**RED first:** Write the new test, run it, confirm it fails (mock not set up → `apiPatchVisit` is undefined → error).

**GREEN:** Add `patchVisit: vi.fn()` to mock block, import it, set up mock return value, run test → passes.

### Steps

- [ ] **Read lines 1-52** of `ClientsIntegration.test.tsx` to see the mock block and imports.
- [ ] **Read lines 117-151** to see mock data (`mockRecord` has visit `id: 'v1'`, `status: 'waiting'`; `mockClientWithRecords` has record `rec1` with date `2026-05-10`).
- [ ] **Read lines 176-215** to see the `beforeEach` mock setup (useQuery, useMutation, useQueryClient mocks).

**RED phase:**

- [ ] **Replace the skipped test** (lines 446-469) with the new test:
  ```typescript
  it('record tab visit status cycles via StatusPicker', async () => {
    const { ClientCardModal } = await import('@/app/(main)/clients/components/ClientCardModal');
    render(
      <UIProvider><QueryClientProvider client={createQueryClient()}>
        <ClientCardModal client={mockClientWithRecords} isOpen={true} onClose={vi.fn()} mode="view" />
      </QueryClientProvider></UIProvider>,
    );

    // Switch to record tab
    fireEvent.click(screen.getByText(/10\.05\.2026/));
    await waitFor(() => {
      expect(screen.getByTestId('client-record-tab')).toBeInTheDocument();
    });

    // Wait for visits table to render, find the status picker trigger
    // testid pattern: visit-${visitId}-status-trigger (visit id = 'v1' from mockRecord)
    const statusTrigger = await screen.findByTestId('visit-v1-status-trigger');
    fireEvent.click(statusTrigger);

    // Popover opens, select "visited" option
    const visitedOption = await screen.findByTestId('visit-v1-status-option-visited');
    fireEvent.click(visitedOption);

    // Assert patchVisit was called with { status: 'visited' }
    await waitFor(() => {
      expect(patchVisit).toHaveBeenCalledWith(
        'v1',
        expect.objectContaining({ status: 'visited' }),
      );
    });
  });
  ```
- [ ] **Run the test:** `cd frontend/admin && pnpm run test -- --run ClientsIntegration` → expect FAIL (RED) because `patchVisit` is not imported/mocked. Error will be `patchVisit is not defined` or `apiPatchVisit is not a function`.

**GREEN phase:**

- [ ] **Add `patchVisit` to the mock block** (line 11-39, the `vi.mock('@memo/api-client', ...)` return object):
  ```typescript
  // Add after line 36 (deletePayment) or anywhere in the returned object:
  patchVisit: vi.fn(),
  ```
- [ ] **Import `patchVisit`** — add to the import block (lines 41-52):
  ```typescript
  import {
    getClientsWithStats,
    updateClient as apiUpdateClient,
    deleteClient as apiDeleteClient,
    getRecord,
    patchRecord,
    updateRecord,
    deleteRecord,
    createPayment,
    getClientVisitors,
    patchVisit,          // ← ADD THIS
    ApiError,
  } from '@memo/api-client';
  ```
  Note: the import name is `patchVisit` (the mock uses `patchVisit` as the key). The test asserts on `patchVisit` directly.
- [ ] **Set up mock return** in `beforeEach` (after line 183 where other mocks are set up):
  ```typescript
  vi.mocked(patchVisit).mockResolvedValue({ ...mockRecord.visits[0], status: 'visited' });
  ```
  This returns an updated visit object so `upsertVisit` in `useRecordMutations` has data to work with.
- [ ] **Run the test:** `cd frontend/admin && pnpm run test -- --run ClientsIntegration` → expect PASS (GREEN).

**REFACTOR phase:**

- [ ] **Remove the stale comment** that referenced `visit-status-select` / `visit-status-icon` (the old `// SKIPPED: ...` comment is removed with the old test).
- [ ] **Run full vitest suite:** `cd frontend/admin && pnpm run test` → expect 1194 pass + 0 skip (was 1193 + 1 skip). The `it.skip` is now `it` and passes.
- [ ] **Run type-check:** `cd frontend/admin && pnpm run type-check` → expect clean (no type errors from new test code).

- [ ] **Commit:** `fix(#163): rewrite visit-status-cycle vitest test for StatusPicker — un-skip`

**DoD:**
- `it.skip` replaced with `it` (new test body)
- `patchVisit: vi.fn()` added to `@memo/api-client` mock block
- `patchVisit` imported and mock return set in `beforeEach`
- Test asserts `patchVisit` called with `('v1', { status: 'visited' })`
- Full vitest suite: 1194 pass + 0 skip (up from 1193 + 1 skip)
- Type-check clean
- No production code changed

---

## Verification (all 3 tasks done)

- [ ] **Vitest full suite:** `cd frontend/admin && pnpm run test` → 1194 pass + 0 skip (baseline was 1193 + 1 skip)
- [ ] **Type-check:** `cd frontend/admin && pnpm run type-check` → clean
- [ ] **Git diff stat:** confirm only 5 files changed (unified-rows.spec.ts, modal-blur-footer.spec.ts, modal-no-jump.spec.ts, private-toggle-layout.spec.ts, ClientsIntegration.test.tsx)
- [ ] **CI is the decisive arbiter for E2E** — local shard env is flaky per #124 experience. Push and let CI verify:
  - E2E shard-rest: +4 tests really running (sc.18 + US-M09 + US-M10 + US-M01). All should PASS.
  - Cascade verify: `activity-details-modal.spec.ts:219` test 4 (defensive guard) also runs on CI — should PASS without code change.

## Risk handling (post-CI)

If any E2E test FAILs on CI:
1. **Scenario 18 (#155):** If poll times out at 5s → re-skip with accurate annotation, escalate to Wave 3 backend investigation. Do NOT increase timeout beyond 5s.
2. **US-M09/US-M10 (#156/#157):** If dialog not visible → openModal regression. Re-skip + investigate. Do NOT modify openModal in this PR.
3. **US-M01 (#158):** If `settings-tab` testid not found → testid drift (not openModal). Re-skip with accurate issue reference. Do NOT add testids to production code in this PR.
4. **Vitest #163:** If `patchVisit` mock doesn't match real call signature → adjust mock in the test file only (no production code changes).