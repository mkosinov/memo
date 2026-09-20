# GH #138 — Schedule/Records view state in the URL (`?view/?date/?col`, `?from/?to`)

- **Date**: 2026-09-19
- **Branch**: `feat/138-schedule-url-state`
- **Status**: Completed (PR pending — architect handles finishing; issue closure via the IMPL PR description; the only DoD item pending CI is «e2e зелёные» — full-shard local runs un-adjudicable, see Test Results)
- **Base**: `8b9774ab` (main) — 13 commits (`8b9774ab..37c4197b`), 52 files, +2710 / −1341
- **Issue**: #138 — «URL как источник правды» (schedule + records view state lives in the URL)
- **Spec**: `docs/specs/2026-07-17-schedule-view-url-state-138-design.md` (rev5, on main, unchanged by IMPL)
- **Plan**: `docs/plans/2026-09-19-schedule-view-url-state-138-plan.md` (10 tasks, on main, unchanged by IMPL)

## Summary of Changes

- **Schedule view state in the URL (spec §2.1):** new `hooks/useScheduleView.ts` — single
  read/write point for `/schedule?view=week|day&date=YYYY-MM-DD&col=masters|locations`.
  Strict parsing (enum whitelist; `date` must be a real calendar date — rollovers like
  `2026-02-31` rejected) with silent fallback to defaults (`week` / `masters` / today).
  One serialized writer: a `latestParamsRef` makes sequential synchronous writes compose
  (Topbar's column select fires `setColumnMode` + `setViewMode` in one handler) and a single
  router call per update; nav steps (view/date/prev/next/today) push, the column display
  toggle replaces (no history steps). `currentWeek` derived as the Monday of `?date`.
- **ScheduleViewContext is a proxy:** view state no longer owned locally — the context
  spreads the hook's value verbatim; only stamp and the two filter id lists stay local.
  `/schedule` page wrapped in `<Suspense>` (Next.js requirement for `useSearchParams`).
- **Records period in the URL:** `useRecordsPeriod` (`?from/?to`) — same strict-parse +
  fallback idiom; `RecordsFilters` setters go through the hook (sequential-write safe);
  direct `useSearchParams` reads removed from page bodies (Next.js CSR bailout guard).
- **NavigationContext deleted:** the in-memory navigation context and its provider are
  removed from the layout tree; all consumers re-homed (Topbar on hook setters,
  `/clients` on GridSettingsProvider).
- **CustomEvent `__memo-*` test bus removed from production code:** DayView/WeekView/
  `ScheduleColumnHeader`/Topbar no longer emit test-only events; Menubar MiniCalendar
  became the **navigator + period indicator** — navigation (prev/next/today/day) and the
  visual period marker (current-week/day highlight on `/schedule`, red range on `/records`)
  are driven by URL state; `__memo-mc*`-based specs migrated to real interactions
  (`dayview-column-reorder` DnD, `dayview-slot-create` stamp/slot flows,
  `schedule-archived-visibility`, `schedule-column-visibility`, `schedule-empty-week`,
  `schedule-saving-toast`, `copy-last-week`, `server-push-offline`,
  `visual-compliance-checks`), plus new `schedule-url-state.spec.ts` (US-1..US-7:
  deep links, canonicalization, browser-back, «Today», cross-page, invalid params,
  records period round-trip, refresh persistence).
- **DayView column reorder is keyboard-operable:** `KeyboardSensor` (DnD-kit) +
  activator-node fix; e2e US-6 exercises the reorder on keyboard; no key hijacking when
  drag is not active.
- **Production fixes surfaced by the migration:** sequential URL writes compose (T3);
  MiniCalendar range clipped to the visible month (T4); `memo-deps` fix in the records
  period effect (T5).

## Behavioral Delta

| # | Scenario | Before | After |
|---|----------|--------|-------|
| S1 | Open `/schedule?view=day&date=2026-09-15&col=locations` | In-memory state, defaults only | Renders exactly that view; invalid params fall back silently |
| S2 | Browser back after nav steps / column toggle | Restored ad hoc via NavigationContext | History-exact: steps push, display toggle replaces |
| S3 | «Today» | In-memory | `?date=<today>` written to the URL |
| S4 | Copy URL to another tab / refresh | State lost | State fully restored from the URL |
| S5 | `/records?from=&to=` | In-memory period | Period in URL; invalid → defaults; MiniCalendar shows the red range |
| S6 | E2E view-state injection | `CustomEvent __memo-*` backdoors in production code | Real interactions only (clicks/DnD/keyboard) |

## Tasks (plan)

| # | Task | Classification | Status |
|---|------|----------------|--------|
| T1 | `useScheduleView` hook | standard | ✅ |
| T2 | ScheduleViewContext proxy + Data + Toolbar + Suspense | large | ✅ |
| T3 | Topbar on hook setters + hook sequential-write fix | small | ✅ |
| T4 | Menubar/MiniCalendar navigator + indicator + range-clipping fix | large | ✅ |
| T5 | Records period in URL (`useRecordsPeriod`) + memo-deps fix | standard | ✅ |
| T6 | `/clients` on GridSettingsProvider | small | ✅ |
| T7 | NavigationContext deleted | small | ✅ |
| T8 | Test hooks removed + KeyboardSensor (+ activator-node fix in the T9 cycle) | standard | ✅ |
| T9 | E2E migration (11 specs) + US-1..US-7 + keyboard reorder + US-5 wait-order fix | large | ✅ |
| T10 | Final verification | small | ✅ |

## Test Results

- **admin vitest:** **2218 passed / 0 failed** (137 files).
- **tsc:** clean.
- **lint:** 0 errors / 35 warnings (budget `--max-warnings 38`).
- **E2E:** `schedule-url-state.spec.ts` US-1..US-7 green in targeted runs; the 11 migrated
  specs green on real interactions. **Full-shard local runs were un-adjudicable** — the
  host was saturated by a foreign job and the browser cache purge polluted results, so
  adjudication is delegated to CI (the authoritative gate, per tests_workflow caveats).
  Spec §9 DoD is met on all items except «e2e зелёные», which is pending CI for the same
  reason.

## Acceptance Criteria

Spec §9 DoD — all items met; «e2e зелёные» pending CI (local environment un-adjudicable;
documented above).

## Key Files Changed

- New: `frontend/admin/hooks/useScheduleView.ts` (+ unit suite `useScheduleView.test.ts`),
  `frontend/admin/e2e/schedule-url-state.spec.ts` (US-1..US-7).
- Rewired: `frontend/admin/contexts/schedule/ScheduleViewContext.tsx` (URL proxy),
  `frontend/admin/contexts/RecordsContext.tsx` + `hooks/useRecordsPeriod.ts` (`?from/?to`),
  `frontend/admin/app/components/layout/{Menubar,Topbar,Toolbar}.tsx`,
  `frontend/admin/app/components/schedule/{DayView,WeekView,ScheduleColumnHeader}.tsx`,
  `frontend/admin/app/(main)/{layout,schedule/page,records/page,clients/page}.tsx`,
  `frontend/admin/app/(main)/records/components/RecordsFilters.tsx`.
- Deleted: `frontend/admin/contexts/NavigationContext.tsx` + suite
  (`__tests__/NavigationContext.test.tsx`).
- E2E migrated off `__memo-*`: `dayview-column-reorder`, `dayview-slot-create`,
  `schedule-archived-visibility`, `schedule-column-visibility`, `schedule-empty-week`,
  `schedule-saving-toast`, `copy-last-week`, `server-push-offline`,
  `visual-compliance-checks`, `error-messages`, `unify-caches` + helpers.

## Docs Impact

- Spec + plan live on main and were not touched on this branch.
- `CHANGELOG.md` `[Unreleased] — 2026-09-19` entry added.
- `PLAN.md` — completion blockquote + Priorities table row added.
- No domain-rules changes needed (frontend-only feature; no domain semantics changed).

## Known Non-Blocking Observations

- The 35 lint warnings sit under the 38 budget; the #301 «threshold to 0» follow-up
  continues to track them.
- Full-shard e2e adjudication is deferred to CI; targeted runs (US-1..US-7 + migrated
  specs) were green locally.

## References

- **GitHub Issue**: #138
- **Design Spec**: `docs/specs/2026-07-17-schedule-view-url-state-138-design.md` (rev5, on main)
- **Plan**: `docs/plans/2026-09-19-schedule-view-url-state-138-plan.md` (on main)
- **PR**: _(to be added after PR creation)_
