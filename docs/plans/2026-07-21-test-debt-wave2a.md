# Test-debt Wave 2A Implementation Plan (revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-enable 2 disabled tests (1 E2E + 1 vitest), delete 2 dead E2E test files, reduce disabled-test count by 2.

**Architecture:** Five changes touching only test files (`.spec.ts`, `.test.tsx`) and deleting 2 E2E spec files. No production code changes. Task 2.1 un-skips a flaky E2E test without poll (root-cause investigation deferred to CI verdict). Task 2.2 un-skips a cross-tab modal-dimension regression test. Tasks 2.3 and 2.4 delete point-fix tests covered by existing visual regression screenshots. Task 2.5 rewrites a vitest test whose premise was doubly wrong.

**Tech Stack:** Playwright E2E (TypeScript), Vitest + @testing-library/react (TypeScript/React)

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **Scenario 18 re-enabled** → E2E test verifies that hard-deleting a payment removes it from client stats; no retry/poll masking — if the backend flakes, we investigate the root cause.
- **US-M09 re-enabled** → E2E test verifies that switching client tabs in the activity modal does not change the modal's width/height/position (cross-tab behavioral check, kept as code test per user).
- **US-M10 deleted** → weak z-index proxy test removed; regression covered by existing `modal-settings.png` visual screenshot.
- **US-M01 deleted** → point-fix regression test removed; layout covered by existing `modal-settings.png` visual screenshot.
- **Vitest status-cycle rewritten** → unit test verifies that selecting "visited" from the per-visit StatusPicker dropdown calls `patchVisit` with `{ status: 'visited' }`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `frontend/admin/e2e/unified-rows.spec.ts` | modify (1 line) | `test.skip` → `test` on scenario 18 |
| `frontend/admin/e2e/modal-no-jump.spec.ts` | modify (2 lines) | `test.fixme` → `test`, `#XXX` → `#156` |
| `frontend/admin/e2e/modal-blur-footer.spec.ts` | **DELETE** | Remove weak z-index proxy test (covered by visual regression) |
| `frontend/admin/e2e/private-toggle-layout.spec.ts` | **DELETE** | Remove point-fix regression test (covered by visual regression) |
| `frontend/admin/__tests__/ClientsIntegration.test.tsx` | modify (1 test + mock block) | Replace `it.skip` with rewritten `it`, add `patchVisit` to mock block |

---

## Task 1: Scenario 18 — un-skip (no poll) (#155)

### Classification: trivial
### Required Docs
- `docs/specs/2026-07-21-test-debt-wave2a-design.md` — section 2.1 (no poll rationale)
- `docs/domain-rules/payments.md` — payment entity, DELETE → 204, GET → 200/404

### Task Description

**File:** `frontend/admin/e2e/unified-rows.spec.ts` (line 854)

The test is currently skipped: `test.skip(true, 'pre-existing backend flake (GH #155): ...')`. Stats are computed per-request (SQL scalar subquery, `backend/src/services/client.py:67-74`) — no caching issue. The flake was on `GET /payments/{id}` (line 870, payment existence), not stats. Per user directive: un-skip WITHOUT poll. If CI flakes → investigate root cause (Wave 3).

**Steps:**

- [ ] **Read line 854** of `unified-rows.spec.ts` to see the current `test.skip` signature.
- [ ] **Replace the test signature:**
  ```typescript
  // BEFORE (line 854-855):
  test('scenario 18: hard delete removes payment from stats', async ({ request }) => {
    test.skip(true, 'pre-existing backend flake (GH #155): GET /payments/{id} non-OK immediately after POST — pure API test (no openModal); exposed by #124 Wave 1 test-ordering shift. Skip pending backend write-visibility fix.');
  // AFTER:
  test('scenario 18: hard delete removes payment from stats', async ({ request }) => {
  ```
  That is: delete the `test.skip(true, '...')` line (line 855). The test body (lines 856-898) is unchanged.
- [ ] **Verify** no other lines changed in this file.

- [ ] **Commit:** `fix(#155): un-skip scenario 18 — no poll, investigate root cause if CI flakes`

**DoD:**
- `test.skip(true, '...')` line removed
- Test body unchanged
- No other lines changed

---

## Task 2: US-M09 — un-skip fixme + update annotation (#156)

### Classification: trivial
### Required Docs
- `docs/specs/2026-07-21-test-debt-wave2a-design.md` — section 2.2
- `frontend/admin/e2e/fixtures/helpers.ts` — `openModal` and `waitForScheduleReady` (openModal targets by activity_id after #124 Wave 1)

### Task Description

**File:** `frontend/admin/e2e/modal-no-jump.spec.ts`

`test.fixme` blocked by old openModal bug (now fixed). Un-skip + update annotation `#XXX` → `#156`.

**Steps:**

- [ ] **Line 6 header comment:** `#XXX (to be filed separately)` → `#156`
- [ ] **Line 8 test signature:**
  ```typescript
  // BEFORE:
  test.fixme('US-M09: Modal does not jump when switching tabs [deferred: openModal dialog not opening, see GH issue #XXX]', async ({ page }) => {
  // AFTER:
  test('US-M09: Modal does not jump when switching tabs [GH #156 — unblocked by #124 Wave 1 openModal fix]', async ({ page }) => {
  ```
- [ ] **Verify** the rest of the test body is unchanged (lines 9-43).

- [ ] **Commit:** `fix(#156): un-skip US-M09 modal-no-jump — openModal fixed in #124 Wave 1`

**DoD:**
- `test.fixme` → `test`, `#XXX` → `#156` (in test name + header comment)
- No test body logic changed

---

## Task 3: US-M10 — DELETE test file (#157)

### Classification: trivial
### Required Docs
- `docs/specs/2026-07-21-test-debt-wave2a-design.md` — section 2.3 (deletion rationale)

### Task Description

**File:** `frontend/admin/e2e/modal-blur-footer.spec.ts` (30 lines, DELETE entire file)

The test checks `zIndex > 0` on `[role="dialog"]` — NOT actual blur. Bug #86 was z-index stacking (badge z-110 above modal z-50, fix raised modal to z-[200]). The existing `modal-settings.png` visual regression screenshot captures the full modal — if z-index regresses, the screenshot diff catches it.

**Steps:**

- [ ] **Delete** `frontend/admin/e2e/modal-blur-footer.spec.ts`
- [ ] **Verify** no imports of this file elsewhere (it's a standalone spec, no imports expected)
- [ ] **Verify** no `test.describe` block references it from another file

- [ ] **Commit:** `refactor(#157): delete modal-blur-footer.spec.ts — weak z-index proxy covered by visual regression`

**DoD:**
- File deleted
- No other files reference it

---

## Task 4: US-M01 — DELETE test file (#158)

### Classification: trivial
### Required Docs
- `docs/specs/2026-07-21-test-debt-wave2a-design.md` — section 2.4 (deletion rationale)

### Task Description

**File:** `frontend/admin/e2e/private-toggle-layout.spec.ts` (36 lines, DELETE entire file)

Point-fix regression test for bug #83 (CSS `flex-row` → `flex-col` on "Приватное" label/toggle in `SettingsTab.tsx:154`). The existing `modal-settings.png` visual regression screenshot captures the full settings tab — if `flex-col` regresses, the screenshot diff catches it.

**Steps:**

- [ ] **Delete** `frontend/admin/e2e/private-toggle-layout.spec.ts`
- [ ] **Verify** no imports of this file elsewhere (standalone spec)
- [ ] **Verify** no `test.describe` block references it from another file

- [ ] **Commit:** `refactor(#158): delete private-toggle-layout.spec.ts — point-fix covered by visual regression`

**DoD:**
- File deleted
- No other files reference it

---

## Task 5: Rewrite vitest ClientsIntegration:446 for StatusPicker (#163)

### Classification: small
### Required Docs
- `docs/domain-rules/visits.md` — VisitStatus enum (waiting, visited, missed, cancelled), PATCH /api/v1/visits/{id}
- `docs/specs/2026-07-21-test-debt-wave2a-design.md` — section 2.5 (real impl verified, mock setup)
- `frontend/admin/app/components/shared/StatusPicker.tsx` — testid pattern: `${prefix}-trigger`, `${prefix}-popover`, `${prefix}-option-${status}`
- `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx:438` — StatusPicker rendered with `testIdPrefix={isNew ? 'add-visitor-status' : \`visit-${r.id}-status\`}`
- `frontend/admin/hooks/useRecordMutations.ts:320-329` — `patchVisit` calls `apiPatchVisit(visitId, data)` then `upsertVisit`
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — vitest patterns, @testing-library/react usage

### Task Description

**File:** `frontend/admin/__tests__/ClientsIntegration.test.tsx` (line 446)

The skipped test has a doubly-wrong premise:
1. `visit-status-icon` testid does not exist — real impl is `StatusPicker` with testid `visit-${visitId}-status-{trigger,popover,option-${status}}`.
2. Clicking status does NOT enable `btn-save-record` — visit status changes go through `onPatchVisit(visitId, {status})` directly.

The `@memo/api-client` mock block (lines 11-39) does NOT export `patchVisit`. Must be added.

### TDD approach

**RED first:** Write the new test, run it, confirm it fails (mock not set up).

**GREEN:** Add `patchVisit: vi.fn()` to mock block, import it, set up mock return value, run test → passes.

### Steps

- [ ] **Read lines 1-52** of `ClientsIntegration.test.tsx` (mock block + imports).
- [ ] **Read lines 117-151** (mock data: `mockRecord` has visit `id: 'v1'`, `status: 'waiting'`).
- [ ] **Read lines 176-215** (`beforeEach` mock setup: useQuery, useMutation, useQueryClient).

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
- [ ] **Run the test:** `cd frontend/admin && pnpm run test -- --run ClientsIntegration` → expect FAIL (RED) because `patchVisit` is not imported/mocked.

**GREEN phase:**

- [ ] **Add `patchVisit` to the mock block** (line 11-39, the `vi.mock('@memo/api-client', ...)` return object):
  ```typescript
  // Add after deletePayment (or anywhere in the returned object):
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
- [ ] **Set up mock return** in `beforeEach` (after line 183 where other mocks are set up):
  ```typescript
  vi.mocked(patchVisit).mockResolvedValue({ ...mockRecord.visits[0], status: 'visited' });
  ```
  Returns an updated visit object so `upsertVisit` in `useRecordMutations` has data to work with.
- [ ] **Run the test:** `cd frontend/admin && pnpm run test -- --run ClientsIntegration` → expect PASS (GREEN).

**REFACTOR phase:**

- [ ] **Remove the stale comment** that referenced `visit-status-select` / `visit-status-icon`.
- [ ] **Run full vitest suite:** `cd frontend/admin && pnpm run test` → expect 1194 pass + 0 skip (was 1193 + 1 skip).
- [ ] **Run type-check:** `cd frontend/admin && pnpm run type-check` → expect clean.

- [ ] **Commit:** `fix(#163): rewrite visit-status-cycle vitest test for StatusPicker — un-skip`

**DoD:**
- `it.skip` replaced with `it` (new test body)
- `patchVisit: vi.fn()` added to `@memo/api-client` mock block
- `patchVisit` imported and mock return set in `beforeEach`
- Test asserts `patchVisit` called with `('v1', { status: 'visited' })`
- Full vitest suite: 1194 pass + 0 skip
- Type-check clean
- No production code changed

---

## Verification (all 5 tasks done)

- [ ] **Vitest full suite:** `cd frontend/admin && pnpm run test` → 1194 pass + 0 skip (baseline was 1193 + 1 skip)
- [ ] **Type-check:** `cd frontend/admin && pnpm run type-check` → clean
- [ ] **Git diff stat:** confirm 5 files changed (1 modified spec, 1 modified spec, 2 deleted specs, 1 modified test)
- [ ] **CI is the decisive arbiter for E2E** — push and let CI verify:
  - E2E shard-rest: +2 tests really running (sc.18 + US-M09). -2 test files (US-M10 + US-M01 deleted).
  - The 3 deleted test files should not appear in the test suite at all.

## Risk handling (post-CI)

1. **Scenario 18 (#155):** If flakes on CI → re-skip with accurate annotation, escalate to Wave 3 backend investigation. Do NOT add poll. User directive: investigate root cause.
2. **US-M09 (#156):** If dialog not visible → openModal regression. Re-skip + investigate. Do NOT modify openModal in this PR.
3. **Vitest #163:** If `patchVisit` mock doesn't match real call signature → adjust mock in test file only (no production code).