# Design: Test-debt Wave 2A — Cheap wins + un-skip verification

> Spec for Wave 2A of the test-debt cleanup.
> Base commit: `be2fa8c` (main, includes Wave 0 inventory doc).
> Date: 2026-07-21.
> GH issues: #155, #156, #157, #158, #163.
> Related: #124 (Wave 1 openModal fix — merged), #164 (Wave 2B stale-cache — out of scope).

## Rationale

After Wave 0 (inventory) and Wave 1 #124 (openModal fix), several disabled tests
are now likely unblocked. Wave 2A re-enables them and fixes one vitest test
that mismatches the current implementation. This is pure test-debt cleanup —
**no production code changes**. The goal is to reduce the disabled-test count
by 5 (4 E2E + 1 vitest) and verify they PASS on CI.

## Scope

### IN scope (3 tasks, one branch `feat-test-debt-wave2a`)

| # | Task | GH issue | Files | Classification |
|---|------|----------|-------|-----------------|
| 2.1 | scenario 18: retry/poll around `GET /payments/{id}` | #155 | `frontend/admin/e2e/unified-rows.spec.ts` (~5 lines) | small |
| 2.2 | US-M09 + US-M10 + US-M01: un-skip 3 `test.fixme` + verify | #156, #157, #158 | `modal-blur-footer.spec.ts`, `modal-no-jump.spec.ts`, `private-toggle-layout.spec.ts` | small |
| 2.3 | vitest ClientsIntegration:446: full test rewrite for `StatusPicker` | #163 | `frontend/admin/__tests__/ClientsIntegration.test.tsx` (~30 lines) | small |

### Cascade free-win verify (no code change)

`activity-details-modal.spec.ts:219` — test 4 "Settings update — service_id changes
in DB" has a defensive guard `if (!activity) { test.skip(); return; }` after
`openModal`. After #124 Wave 1, `openModal` reliably returns an activity, so
this guard should never fire. **No code change** — just verify the test PASSes
on CI. If it FAILs → it's a real bug (not our regression), escalate.

### OUT of scope (explicit)

- **2.4** visual-regression snapshot regen (#109) → separate followup micro-PR
  (requires `workflow_dispatch` on pushed branch for baseline regen).
- **2.5** unified-rows stale-cache (#164) → Wave 2B (needs React Query audit first).
- **#160** column-mode dropdown race (6 fixme) → Wave 3 (real product bug in Topbar.tsx).
- **#159** records detail panel (2 fixme) → Wave 3.
- **#155** backend write-visibility root cause → Wave 3 (we only harden the test in 2.1).
- **#161** wave6 cond-skip verification (6 tests) → Wave 4.
- **#162** wave6 "Add visitor button not found" → Wave 4.
- **Production code** (.tsx, .ts, .py, .css) → NOT touched at all.

## Task Details

### 2.1 — scenario 18: retry/poll around GET /payments/{id} (#155)

**Problem:** `unified-rows.spec.ts:854` scenario 18 is a pure API test
(`async ({ request })` — no `page` fixture, never calls `openModal`). It was
skipped after #124 Wave 1 because un-skipping 7 earlier scenarios shifted test
ordering and exposed a backend write-visibility flake: `GET /payments/{id}`
returns non-OK immediately after `POST /api/v1/payments` creates the payment.

**Fix:** Replace `test.skip(true, 'pre-existing backend flake...')` with
`test(...)`. Wrap the line-870 `expect(getResp.ok()).toBeTruthy()` in an
`expect.poll` with timeout 5s and intervals [200, 500, 1000]:

```typescript
// Verify payment exists via API (retry — backend write may not be immediately readable, GH #155)
await expect.poll(async () => {
  const r = await request.get(`${BACKEND}/api/v1/payments/${payment.id}`);
  return r.ok();
}, { timeout: 5_000, intervals: [200, 500, 1000] }).toBeTruthy();
```

This pattern is already used in `activity-details-modal.spec.ts:248` — it is
the idiomatic retry approach in this codebase. The `try/finally` cleanup block
is preserved unchanged.

**Annotation update:** Replace `test.skip(true, 'pre-existing backend flake (GH #155)...')`
with a `test(...)` call. Add a comment above the poll explaining the retry:
`// GH #155: backend write not immediately readable — poll until OK`.

### 2.2 — US-M09 + US-M10 + US-M01: un-skip 3 fixme (#156, #157, #158)

**Problem:** 3 E2E tests marked `test.fixme` because `openModal` was not opening
the dialog (blocking all 3). The annotation used `#XXX` placeholder (no real
issue filed). Wave 0 created issues #156, #157, #158. #124 Wave 1 fixed
`openModal` to target by `activity_id` via `resolveRecordDate` — these tests
should now PASS.

**Fix (per file):**

1. **`modal-blur-footer.spec.ts:8`** (US-M10, #157):
   - `test.fixme(` → `test(`
   - Annotation: `[deferred: openModal dialog not opening, see GH issue #XXX]` → `[GH #157 — unblocked by #124 Wave 1 openModal fix]`
   - Also update stale header comment `#XXX` → `#157`

2. **`modal-no-jump.spec.ts:8`** (US-M09, #156):
   - `test.fixme(` → `test(`
   - Annotation: `[deferred: openModal dialog not opening, see GH issue #XXX]` → `[GH #156 — unblocked by #124 Wave 1 openModal fix]`
   - Also update stale header comment `#XXX` → `#156`

3. **`private-toggle-layout.spec.ts:8`** (US-M01, #158):
   - `test.fixme(` → `test(`
   - Annotation: `[deferred: settings tab not found, see GH issue #XXX]` → `[GH #158 — unblocked by #124 Wave 1 openModal fix]`
   - Also update stale header comment `#XXX` → `#158`
   - **Note:** This test also clicks `[data-testid="tab-settings"]` then expects
     `[data-testid="settings-tab"]`. If the settings-tab testid has drifted,
     the test will fail on `toBeVisible()` — that would be a real UI testid
     mismatch (separate issue), NOT an openModal problem.

**Risk handling:** If any of the 3 FAILs on CI:
- Check if it's an openModal regression (dialog not visible) → re-skip + investigate
- Check if it's a testid drift (selector not found) → re-skip with correct issue reference
- Check if it's a real UI bug → re-skip, leave issue open with CI artifact comment

### 2.3 — vitest ClientsIntegration:446: full test rewrite (#163)

**Problem:** `ClientsIntegration.test.tsx:446` is `it.skip` with comment
"Real ClientRecordTab uses visit-status-select (dropdown), not
visit-status-icon (button)". This premise is **doubly wrong**:

1. `visit-status-select` does NOT exist anywhere in the codebase.
2. `visit-status-icon` does NOT exist either — the real implementation is
   `StatusPicker` (`variant="icon"`) rendered by `RecordVisitsTable` with
   testid prefix `visit-${visitId}-status`.
3. Clicking status does NOT enable `btn-save-record` — visit status changes go
   through `onPatchVisit(visitId, {status})` directly (not through the
   record-level `hasChanges` / `handleSave` flow).

**Real implementation (verified):**
- `RecordVisitsTable.tsx:438` renders `<StatusPicker testIdPrefix={isNew ? 'add-visitor-status' : \`visit-${r.id}-status\`} />`
- `StatusPicker.tsx` renders:
  - Trigger button: `data-testid="${prefix}-trigger"`
  - Popover: `data-testid="${prefix}-popover"` (when open)
  - Options: `data-testid="${prefix}-option-${status}"` (waiting, visited, missed, cancelled)
- Selecting an option calls `onChange(status)` → `onPatchVisit(r.id!, {status})`

**New test (replaces the skipped one):**

```typescript
it('record tab visit status cycles via StatusPicker', async () => {
  // Setup: render ClientCardModal with a record that has 1 visit
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
  // testid pattern: visit-${visitId}-status-trigger
  const statusTrigger = await screen.findByTestId(/visit-.*-status-trigger/);
  fireEvent.click(statusTrigger);

  // Popover opens, select "visited" option
  const visitedOption = await screen.findByTestId(/visit-.*-status-option-visited/);
  fireEvent.click(visitedOption);

  // Assert patchVisit mock was called with { status: 'visited' }
  await waitFor(() => {
    expect(patchVisit).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ status: 'visited' }),
    );
  });
});
```

**TDD approach:**
- RED: write the new test first → it fails (mock not set up, or selectors wrong)
- GREEN: wire up `patchVisit` mock in the test's mock setup block, adjust selectors
- The mock setup for `patchVisit` must match existing patterns in the test file
  (check how `createPayment`, `deleteRecord`, `updateRecord` are mocked)

**Annotation:** Remove `it.skip` → `it`. Remove the stale comment about
`visit-status-select` / `visit-status-icon`.

**Domain rules reference:** `docs/domain-rules/visits.md` — VisitStatus enum:
waiting, visited, missed, cancelled. PATCH /api/v1/visits/{id} updates status.

### Cascade free-win verify (no code change)

`activity-details-modal.spec.ts:215` test 4 "Settings update — service_id
changes in DB" has `if (!activity) { test.skip(); return; }` at line 219.
After #124 Wave 1, `openModal` reliably returns an activity object. This test
is NOT fixme or skip-annotated — it's a regular `test(...)` with a defensive
inner guard. We just verify it PASSes on CI. No code change in this file.

## Verification Strategy

### Local (before push)
- **Vitest:** `cd frontend/admin && pnpm run test` — baseline 1193 pass + 1 skip.
  After 2.3: expect 1194 pass + 0 skip (the vitest `it.skip` is un-skipped).
- **Type-check:** `cd frontend/admin && pnpm run type-check` — no regressions
  (test-only changes, but the rewritten test may have type errors).
- **E2E local (optional, flaky):** shard-rest local run to spot-check 2.1 + 2.2.
  CI is the decisive arbiter (local shard env is flaky per #124 experience).

### CI (decisive)
- `test.yml` all jobs:
  - Backend: unchanged (668 pass, we touch no backend)
  - Frontend vitest (5 groups): +1 test (2.3 un-skipped) → 1194 pass
  - E2E shard-schedule: should be unaffected (our tests are in shard-rest files)
  - E2E shard-rest: +4 tests really running (2.1 scenario 18 + 2.2 × 3 fixme).
    All 4 should PASS. Cascade guard (activity-details-modal test 4) also runs.

### Visual Compliance Gate
N/A — Wave 2A touches only test files (`.spec.ts`, `.test.tsx`). No `.tsx`,
`.css`, `.py`, `tailwind.config` changes. Gate skipped per scratchpad policy.

## Bundle: Wave 0 inventory doc

The Wave 0 commit `be2fa8c` (`docs/test-debt-inventory.md`) is on local main
but NOT pushed. It will be cherry-picked (or included via branch base) into
the `feat-test-debt-wave2a` worktree so it ships with this PR.

## User Scenarios

| # | Scenario | Test file:line | Kind |
|---|----------|----------------|------|
| US-1 | scenario 18: hard delete removes payment from stats (retry on GET) | `unified-rows.spec.ts:854` | E2E API-only |
| US-2 | US-M09: modal does not jump when switching tabs | `modal-no-jump.spec.ts:8` | E2E UI |
| US-3 | US-M10: schedule footer blurs when modal is open | `modal-blur-footer.spec.ts:8` | E2E UI |
| US-4 | US-M01: "Приватное" label stacked above selector | `private-toggle-layout.spec.ts:8` | E2E UI |
| US-5 | visit status cycle via StatusPicker dropdown | `ClientsIntegration.test.tsx:446` | vitest unit |

Each scenario maps to a re-enabled test that was previously disabled. Success
= all 5 PASS on CI (green PR). Failure = investigate and either fix or re-skip
with accurate annotation.

## Open risks

1. **2.2 private-toggle-layout #158:** May fail on `settings-tab` testid drift
   (not openModal). If so → re-skip with accurate issue, NOT a Wave 2A blocker.
2. **2.1 scenario 18 #155:** The retry/poll may not be enough if the backend
   has a deeper write-visibility bug (not just timing). If poll times out at
   5s → re-skip, escalate to Wave 3 backend investigation.
3. **2.3 StatusPicker testid:** The test relies on `findByTestId(/visit-.*-status-trigger/)`.
   If the mock visit data doesn't have an `id` field (mock may return `{}` or
   `null`), the testid won't render. The mock setup must include a visit with
   a valid `id` field.