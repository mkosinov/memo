# GH #94 — Undo toast with animated countdown ring (deferred visit/payment deletions)

- **Date**: 2026-09-17
- **Branch**: `feat/undo-toast-ring-94`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description)
- **Base**: `1e08f6e` (#263 master role v1, merged 2026-09-17) — 6 commits (`8cde93f..4433ade`), 12 files, +419 / −22
- **Issue**: #94 — undo toast with animated countdown ring (visits/payments deferred deletions)
- **Spec**: `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-16-undo-toast-countdown-ring-plan.md`

## Summary of Changes

- **`UIContext` wiring (`8cde93f`, T1):** `Toast` gains `countdownMs?: number`; `showToast` gains a
  4th optional parameter (and tolerates the window in the 3rd slot of the kindless-undo form). The
  auto-hide duration becomes `undoFn ? (countdownMs ?? 5000) : 4500` — undo-toast lifetime now equals
  the deferred window, while non-undo toasts keep 4500 ms and undo toasts without `countdownMs` keep
  the 5000 ms default. The `loading` branch is untouched; the 40+ existing call sites are unaffected
  (parameter is optional).
- **`CountdownRing` component (`28237fe`, T2):** new `app/components/toast/CountdownRing.tsx` — SVG
  with the existing spinner geometry (viewBox 12, r 4.5, strokeWidth 1.5): a neutral track circle plus
  a `currentColor` progress circle (`strokeDasharray = 2π·4.5 ≈ 28.27`,
  `strokeDashoffset = (1 − remaining/window) · 28.27`, rotated −90° so the fill starts at 12 o'clock).
  A single `setInterval(1000)` drives both the ring step and the digit (`ceil(remaining/1000)`, min 1);
  no CSS keyframes, no inline `animationDuration`. The interval is cleared on unmount and when the
  window is exhausted; the wrapper is `aria-hidden="true"` (D5); the component never hides itself —
  toast lifetime stays with `UIContext` (D4).
- **`ToastContainer` render gate (`6b76d59`, T3):** `CountdownRing` renders left of the message when
  `toast.countdownMs !== undefined` — gated on `countdownMs`, **not** on `toast.undo` (D1), so the
  schedule activity undo toast (`ActivityCard.tsx:78`, no `countdownMs`) correctly stays ringless.
  «Отменить» and «×» are unchanged (D9: dismiss ≠ cancel — «×» hides the toast, the deferred commit
  still fires at window expiry).
- **`PendingActionsContext` sole producer (`cad9506`, T4):** `enqueuePendingAction` passes
  `action.delayMs` as the toast `countdownMs` (kind slot `undefined`), making the deferred window,
  the toast lifetime and the commit timer one source — `delayMs`.
- **e2e S4 (`d135a00`, T5):** new regression test in `unified-rows.spec.ts` —
  `scenario S4: re-delete visit after undo — new toast, deferred DELETE, gone after reload`; waits for
  the deferred DELETE response before the reload assertions (no digit/timing asserts — D6).
- **Deliberately unchanged:** records deletion flow (instant toast + DeleteDialog on 409 — split to
  #285), activity-card undo toast (ringless), toast texts, «×» semantics, visible-stack limit of 5,
  non-undo timings, `prefers-reduced-motion` (no special handling — D8), backend (zero change).

## Behavioral Delta

- **S1/S6:** deferred delete of a visit/payment now shows the undo toast with a countdown ring and a
  ticking digit (5→1) left of the message; previously the same toast had no icon.
- **S3:** window expiry unchanged — toast disappears, deferred DELETE fires; the toast now lives
  exactly `delayMs` (previously a second, independent 5000 ms hide-timer ran on the same window).
- **S2, S4, S5:** unchanged behavior (undo reverts; re-delete after undo gets a fresh toast/countdown;
  records toast is instant and ringless).
- Everything else (texts, «Отменить», «×», stack limit, non-undo toasts) is behaviorally identical.

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | `UIContext` — `countdownMs` field + `showToast` parameter + undo duration | small | ✅ (`8cde93f`) |
| T2 | `CountdownRing` component — single interval for ring + digit | standard | ✅ (`28237fe`) |
| T3 | `ToastContainer` — render gate on `countdownMs !== undefined` | small | ✅ (`6b76d59`) |
| T4 | `PendingActionsContext` — sole producer, passes `delayMs` | small | ✅ (`cad9506`) |
| T5 | e2e S4 regression test in `unified-rows.spec.ts` | small | ✅ (`d135a00`) |
| T6 | `design-system.md` + `CHANGELOG.md` + full verification | small | ✅ (`4433ade`) |

## User Scenarios (spec §6) — all covered, green

| # | Scenario | Anchor | Status |
|---|----------|--------|--------|
| S1 | Deferred visit delete → undo toast with countdown ring | existing `e2e/unified-rows.spec.ts` | ✅ |
| S2 | Cancel within the window → toast gone, row restored | existing `e2e/unify-caches.spec.ts:274-279` | ✅ |
| S3 | Window expires → toast gone, deferred DELETE fired | existing `e2e/unified-rows.spec.ts:773-812` | ✅ |
| S4 | Delete → undo → delete again → fresh toast, new countdown | new test in `e2e/unified-rows.spec.ts` (`d135a00`) | ✅ |
| S5 | Records delete unchanged — instant toast, no ring, 409 → DeleteDialog | existing `e2e/activity-details-modal.spec.ts:154` | ✅ |
| S6 | Deferred payment delete → same undo toast with ring | existing `e2e/unified-rows.spec.ts:996-1030` | ✅ |

## Test Results

- **admin vitest:** **2017 passed / 0 failed (131 files)** — new `CountdownRing.test.tsx` suite plus
  UIContext duration cases, ToastContainer ring gate pair, PendingActionsContext arity updates and
  shared mock-context updates.
- **tsc --noEmit:** clean. **lint:** clean.
- **e2e pair (`unified-rows` + `unify-caches`):** **30/30** — one documented pre-existing in-suite
  timing flake (`unify-caches` US-2) failed once, then passed standalone ×3 and on re-run; the diff
  was verified unable to affect its timing.
- **Visual suite:** 52 passed / 15 failed — analyzed as environment drift (static wave6 harness never
  loads the app; glyph-level font/AA rasterization; documented drift class, precedent #182);
  **baselines were NOT touched**. Separate live visual-compliance check: **PASS (6/6 spec checks)**,
  screenshots in `/tmp/visual-compliance/`.
- **Backend:** not touched (zero backend change).
- **Purity check:** `git grep "countdownMs"` in `frontend/admin` reaches only `UIContext`,
  `ToastContainer`, `CountdownRing`, `PendingActionsContext` and their tests; the ring renders only
  via the `countdownMs !== undefined` gate.
- **Acceptance (spec §8):** all DoD items met — ring + digit on visit/payment undo toasts, one source
  for window/lifetime/commit (`delayMs`), activity toast ringless, «×» semantics unchanged, non-undo
  and records flows unchanged, S1–S6 covered, unit green, design-system updated.

## Key Files Changed

- Created: `frontend/admin/app/components/toast/CountdownRing.tsx`,
  `frontend/admin/__tests__/CountdownRing.test.tsx`.
- Modified (prod): `contexts/UIContext.tsx`, `contexts/PendingActionsContext.tsx`,
  `app/components/toast/ToastContainer.tsx`.
- Modified (tests): `__tests__/UIContext.test.tsx`, `__tests__/ToastContainer.test.tsx`,
  `__tests__/PendingActionsContext.test.tsx`, `__tests__/helpers/mockContexts.ts`,
  `e2e/unified-rows.spec.ts`.
- Docs (feature branch): `docs/design-system.md` (Toast section + motion row), `CHANGELOG.md`
  (`4433ade`); meta: this status file, `PLAN.md`.
- No backend, no migrations, no spec/plan edits on this branch.

## Docs Impact

- Spec (`docs/specs/2026-09-16-undo-toast-countdown-ring-design.md`) and plan
  (`docs/plans/2026-09-16-undo-toast-countdown-ring-plan.md`) live on main and were not touched here.
- `docs/design-system.md` — new «Undo countdown ring» block in the Toast section + «Undo ring (toast)»
  row in the motion table (committed in `4433ade`, not duplicated here).
- `CHANGELOG.md` — `[Unreleased] — 2026-09-16` entry (committed in `4433ade`).
- No domain-rules change: pure presentation concern, no business-logic contract moved.

## Known Non-Blocking Observations

- The visual-suite failures belong to the documented pre-existing local font/render drift family (also
  red on `main`); CI baselines are authoritative — no baselines were re-recorded.
- `unify-caches` US-2 showed a latent in-suite timing sensitivity around the 5 s deferred DELETE in the
  combined run; it is pre-existing and unrelated to this diff (green standalone ×3 and on re-run).
- `docs/memo-full-spec.md` §6 decision 7 («Toast with undo (no timer) — less noisy than countdown») is
  a historical design-rationale row from 2026-05-27 and is now superseded in part by #94 for deferred
  deletions; that doc is a frozen artifact and was intentionally left untouched.

## References

- **GitHub Issue**: #94 (related: #285 — deferred deletion for records, #286 — activity conversion)
- **Design Spec**: `docs/specs/2026-09-16-undo-toast-countdown-ring-design.md` (rev2)
- **Plan**: `docs/plans/2026-09-16-undo-toast-countdown-ring-plan.md`
- **PR**: _(to be added after PR creation)_
