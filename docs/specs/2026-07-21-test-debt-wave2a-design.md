# Design: Test-debt Wave 2A — Cheap wins + dead-test removal

> Spec for Wave 2A of the test-debt cleanup.
> Base commit: `be2fa8c` (main, includes Wave 0 inventory doc).
> Date: 2026-07-21 (revised per user feedback).
> GH issues: #155, #156, #163.
> Related: #124 (Wave 1 openModal fix — merged), #157 #158 (closing via deletion).

## Rationale

After Wave 0 (inventory) and Wave 1 #124 (openModal fix), some disabled tests
are now unblocked; others are low-value point-fix regression tests better
retired than maintained. Wave 2A re-enables 2 (1 E2E + 1 vitest) and deletes
2 dead E2E tests whose regressions are covered by existing visual regression
screenshots. This is pure test-debt cleanup — **no production code changes**.

## Scope

### IN scope (5 changes, one branch `feat-test-debt-wave2a`)

| # | Change | GH issue | Files | Classification |
|---|--------|----------|-------|-----------------|
| 2.1 | scenario 18: un-skip (no poll) | #155 | `frontend/admin/e2e/unified-rows.spec.ts` (~1 line) | trivial |
| 2.2 | US-M09: un-skip fixme + update annotation | #156 | `frontend/admin/e2e/modal-no-jump.spec.ts` (2 lines) | trivial |
| 2.3 | US-M10: DELETE test file (weak z-index proxy, not blur) | #157 (close) | `frontend/admin/e2e/modal-blur-footer.spec.ts` (delete) | trivial |
| 2.4 | US-M01: DELETE test file (point-fix regression, covered by `modal-settings.png`) | #158 (close) | `frontend/admin/e2e/private-toggle-layout.spec.ts` (delete) | trivial |
| 2.5 | vitest #163: full test rewrite for `StatusPicker` | #163 | `frontend/admin/__tests__/ClientsIntegration.test.tsx` (~30 lines) | small |

### OUT of scope (explicit)

- **2.4 (original)** visual-regression snapshot regen (#109) → separate followup micro-PR
- **2.5 (original)** unified-rows stale-cache (#164) → Wave 2B
- **#160** column-mode dropdown race (6 fixme) → Wave 3
- **#159** records detail panel (2 fixme) → Wave 3
- **#155** backend write-visibility root cause → Wave 3 (if CI still flakes after un-skip)
- **#161** wave6 cond-skip verification (6 tests) → Wave 4
- **#162** wave6 "Add visitor button not found" → Wave 4
- **Production code** (.tsx, .ts, .py, .css) → NOT touched

## Design decisions (from user review)

### 2.1 — scenario 18: no poll, just un-skip (#155)

User: "if POST hard-delete is done, GET should immediately return updated stats
because stats are computed per-request on the backend."

Verified: `total_paid` is an inline SQL scalar subquery
(`backend/src/services/client.py:67-74`), computed per-request. No caching.
The DELETE flow (`BaseRepository.delete` → `session.flush()` → DI commit
before response) ensures committed data is visible to subsequent GETs.

The original flake was on `GET /payments/{payment.id}` (line 870, payment
existence check), NOT on stats. If this flakes on CI after un-skip → we
investigate the root cause (SQLite write-visibility), NOT mask it with a poll.
**No poll added.** Just `test.skip` → `test`.

### 2.2 — US-M09: keep as code test, un-skip (#156)

User: "keep this test as a code test." The cross-tab dimension comparison
(width/height/x across settings → client → settings) is a strong behavioral
assertion that a visual screenshot cannot fully replicate (screenshots compare
to baselines, not to each other). Keep as `test(...)`, update `#XXX` → `#156`.

### 2.3 — US-M10: DELETE (weak proxy test) (#157)

User: "delete." The test checks `zIndex > 0` on the dialog element — NOT actual
blur. Bug #86 was about z-index stacking (badge z-110 above modal z-50, fix
raised modal to z-[200]). The existing `modal-settings.png` visual regression
screenshot captures the full modal including any badge overlap — if the z-index
regression returns, the screenshot diff catches it. Zero loss from deletion.

### 2.4 — US-M01: DELETE (point-fix regression test) (#158)

User: "this was a point fix with a test. The test is no longer needed."

Bug #83 was a CSS class change (`flex-row` → `flex-col` on the "Приватное"
label/toggle wrapper in `SettingsTab.tsx:154`). The existing
`modal-settings.png` visual regression screenshot captures the full settings
tab — if `flex-col` is removed, the label/toggle layout changes and the
screenshot diff catches it. The test was a 1-assertion point check with heavy
E2E overhead (open schedule → open modal → switch to settings → measure y
coordinates). Delete the file.

### 2.5 — vitest #163: full rewrite (kept from original spec)

The skipped test has a doubly-wrong premise:
1. `visit-status-icon` testid does not exist — real impl is `StatusPicker`
   with testid `visit-${visitId}-status-{trigger,popover,option-${status}}`.
2. Clicking status does NOT enable `btn-save-record` — visit status changes go
   through `onPatchVisit(visitId, {status})` directly.

**Real implementation (verified):**
- `RecordVisitsTable.tsx:438` renders `<StatusPicker testIdPrefix={isNew ? 'add-visitor-status' : \`visit-${r.id}-status\`} />`
- `StatusPicker.tsx` renders trigger (`${prefix}-trigger`), popover (`${prefix}-popover`), options (`${prefix}-option-${status}`)
- Selecting an option → `onChange(status)` → `onPatchVisit(r.id!, {status})` → `apiPatchVisit(visitId, VisitPatch)`

**New test:** render ClientCardModal → switch to record tab → find
`visit-v1-status-trigger` → click → find `visit-v1-status-option-visited` →
click → assert `patchVisit` called with `('v1', { status: 'visited' })`.

The `@memo/api-client` mock block (lines 11-39) currently does NOT export
`patchVisit` — it must be added. See plan for exact mock setup.

**Domain rules reference:** `docs/domain-rules/visits.md` — VisitStatus enum:
waiting, visited, missed, cancelled. PATCH /api/v1/visits/{id} updates status.

## Verification Strategy

### Local (before push)
- **Vitest:** `cd frontend/admin && pnpm run test` — baseline 1193 pass + 1 skip.
  After 2.5: expect 1194 pass + 0 skip (the vitest `it.skip` is un-skipped).
- **Type-check:** `cd frontend/admin && pnpm run type-check` — no regressions
- **E2E local (optional, flaky):** CI is the decisive arbiter

### CI (decisive)
- `test.yml`:
  - Backend: unchanged (668 pass)
  - Frontend vitest (5 groups): +1 test (2.5 un-skipped) → 1194 pass
  - E2E shard-schedule: should be unaffected (our tests are in shard-rest)
  - E2E shard-rest: +2 tests really running (2.1 scenario 18 + 2.2 US-M09).
    -2 test files deleted (2.3 US-M10 + 2.4 US-M01 — removed from suite).
    Net: shard-rest test count stays similar, 2 more really running.

### Visual Compliance Gate
N/A — Wave 2A touches only test files (`.spec.ts`, `.test.tsx`). No `.tsx`,
`.css`, `.py`, `tailwind.config` changes. Gate skipped.

### Post-CI: scenario 18 flake handling
If scenario 18 (#155) flakes on CI after un-skip (the original symptom: GET
/payments/{id} non-OK after POST):
- **Do NOT add a poll/mask.** User directive: "if CI flakes, we investigate
  WHY it flakes. On prod it categorically should not flake like this."
- Re-skip with accurate annotation → escalate to Wave 3 backend investigation
  (SQLite write-visibility root cause).

## Bundle: Wave 0 inventory doc

The Wave 0 commit `be2fa8c` (`docs/test-debt-inventory.md`) is on local main
but NOT pushed. It will be included via branch base into the
`feat-test-debt-wave2a` worktree so it ships with this PR.

## User Scenarios

| # | Scenario | Test file:line | Kind | Action |
|---|----------|----------------|------|--------|
| US-1 | scenario 18: hard delete removes payment from stats | `unified-rows.spec.ts:854` | E2E API-only | un-skip |
| US-2 | US-M09: modal does not jump when switching tabs | `modal-no-jump.spec.ts:8` | E2E UI | un-skip |
| US-3 | US-M10: schedule footer blurs when modal open | `modal-blur-footer.spec.ts:8` | E2E UI | DELETE file |
| US-4 | US-M01: "Приватное" label stacked above selector | `private-toggle-layout.spec.ts:8` | E2E UI | DELETE file |
| US-5 | visit status cycle via StatusPicker dropdown | `ClientsIntegration.test.tsx:446` | vitest unit | rewrite |

Success = all remaining tests PASS on CI (green PR) + 2 files deleted.

## Open risks

1. **2.1 scenario 18 #155:** May flake (GET /payments/{id} after POST). If so →
   re-skip + investigate root cause (NOT poll). Escalate to Wave 3.
2. **2.5 StatusPicker testid:** The test uses `findByTestId('visit-v1-status-trigger')`.
   Mock visit id is `'v1'` (from `mockRecord.visits[0].id`). If the mock renders
   differently (e.g., loading state before visits table appears), `findByTestId`
   may time out. The test uses `findByTestId` (waits up to 1000ms by default),
   but may need a `waitFor` wrapper if async rendering delays the picker.