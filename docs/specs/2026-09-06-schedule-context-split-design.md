# GH #141 — Split ScheduleContext (god-context) + usePersistedState; kill mutation race

- **Issue:** #141 `refactor(admin): распилить ScheduleContext (550-строчный god-context) + usePersistedState`
- **Status:** DESIGN phase, G1a passed 2026-09-06; panel review folded (G1b revision 1, same day)
- **Scope:** `frontend/admin` only — zero backend changes, zero api-client changes
- **Grounding:** host recon 2026-09-06 (file:line facts reflect the live tree: `contexts/ScheduleContext.tsx` = 577 lines); panel review verified facts against the tree (5 reviewers)

---

## 1. Context & Problem

`frontend/admin/contexts/ScheduleContext.tsx` (577 lines) packs ~40 fields into ONE context value consumed by 10 components (`useSchedule()` callers). Mixed responsibilities:

- server data: activities (range query `qk.activityRange` :292-295), masters/services/locations (shared-cache raw + domain hooks :296-303), derived `enrichedData`/`filteredItems`/`scheduleIndex` (:478-509)
- mutations with optimistic update (create :320, update :335, delete :377)
- view state: `viewMode`, `selectedDay`, `columnMode`, master/location filters (:166-171)
- persisted display settings: `cellHeight`, `gridFrequency`, `workingHoursStart/End` — three localStorage read functions over four keys (:43-86, the working-hours one parameterized ×2) + manual `localStorage.setItem` in each setter (:176-219)
- DOM event bus listeners `__memo-*` (:222-285) — owned by #138, see §8
- period navigation `prevPeriod`/`nextPeriod` (:445-475)

**Cost:** any state change (e.g. `cellHeight` on zoom) produces a new context value → ALL 10 consumers re-render, including pure data consumers (issue DoD-1). The provider is mounted on TWO pages: `app/(main)/schedule/page.tsx:37` AND `app/(main)/clients/page.tsx:135` (the latter feeds `ClientRecordTab`).

Known defects:

1. **Mutation timeout race** (:326-333): `Promise.race` rejects PATCH after 5s → optimistic rollback (:365-370) while the HTTP request keeps living and may still be applied server-side → UI shows old value, server has new one. The settle-refetch (:371-374) races the slow write and usually reads pre-commit state.
2. **Filter init deadlock** (:306-313): filters initialize only when `masters.length > 0 && locations.length > 0` — with an empty locations dictionary master filters never initialize.
3. **`copyLastWeek` silent stub** (:441-443) wired to a real Toolbar button — **out of scope, moved to #242**.

Related, already landed: #140 (entity hooks, raw/lookup pairs share cache keys) and #139 (DataTable). Not started: #138 (view-state → URL, remove `__memo-*` bus).

## 2. Locked decisions (G1a user-approved 2026-09-06; rev. 1 — G1b panel review, same day)

1. **Three-way split of the context value** behind one provider composition: **data** / **view** / **grid settings**. Consumers subscribe only to what they use. Zoom (`cellHeight`) changes touch only the settings value → data consumers do not re-render (DoD-1). `useSchedule()` is **deleted** (no compat shim) — all 10 consumers migrate to precise hooks (§3).
2. **`usePersistedState`** — one generic localStorage hook replaces the read functions + manual writes. Migrated: the 4 grid keys **and** DataTable column-visibility storage (`app/components/shared/DataTable.tsx:22,66`) — after this, no hand-rolled localStorage outside the hook (DoD-2). `UserSettingsContext` is explicitly NOT migrated (server-synced hybrid pattern, different concern).
3. **Remove the artificial 5s timeout** in the activity update mutation: no `Promise.race`, mutation settles naturally (success or real network error). Optimistic rollback on real errors and settle-refetch stay — server is the single source of truth, screen always converges. Residual window (user reloads mid-flight; request already at server) is accepted as inherent — no client-side fix exists; #243 tracks the sibling holes in records. **Domain rule updated together with this spec** (`docs/domain-rules/activities.md`, Frontend §: "Race protection").
4. **Saving indicator**: a visible "сохраняем…" state while any schedule mutation (create/update/delete) is in flight.
5. **Unsaved-changes guard — REVISED at G1b (was: custom in-app dialog + beforeunload).** Final scope: **native `beforeunload` dialog only** (reload / tab close), attached solely while a schedule mutation is in flight. The custom in-app route-change dialog («Дождаться / Уйти сейчас») is **dropped**: Next.js 14 App Router has no navigation-interception API (would require wrapping every `<Link>` + popstate, with bypass holes), and in-app navigation does not kill the in-flight request — the mutation completes, its invalidation fires on the global queryClient, and returning to the page shows converged server state. The custom dialog added convenience ("wait then auto-navigate"), not consistency; the only real loss risk (reload/close) is fully covered by the native dialog. Panel finding (feasibility + best-practices + simplicity), user decision 2026-09-06.
6. **`copyLastWeek` stays a stub untouched** — implementation is #242.
7. **Visits/payments deletion consistency is out of scope** — tracked as #243.
8. **#138 operates strictly AFTER this issue** on the new view context (URL migration, `__memo-*` bus removal). The 6 event listeners/dispatchers (:222-285) move into the view context **as-is, untouched**. The outside-provider dispatcher (`Menubar.tsx:201-256`) keeps working unchanged — the provider stays mounted on both pages.

## 3. Split contract (binding)

Single composition point stays: `ScheduleProvider` (mounted in BOTH `app/(main)/schedule/page.tsx` and `app/(main)/clients/page.tsx`). It mounts three nested providers; each value memoized independently.

| Destination | Hook | Fields (from current `ScheduleContextType` :88-147) |
|---|---|---|
| **ScheduleDataContext** | `useScheduleData()` | `activities` (filtered items), `scheduleIndex`, `masters`, `services`, `locations`, `loading`, `error`, `addActivity`, `updateActivity`, `deleteActivity`, `copyLastWeek` (stub, #242), `gridStartMinutes`/`gridEndMinutes` (derived; see below) |
| **ScheduleViewContext** | `useScheduleView()` | `viewMode`/`setViewMode`, `selectedDay`/`setSelectedDay`, `columnMode`/`setColumnMode`, `filterMasterIds`/`filterLocationIds` + setters, `stamp`/`setStamp` (creation draft — UI state), `currentWeek`/`setCurrentWeek` (navigation state; `prevPeriod`/`nextPeriod`), all six `__memo-*` listeners/dispatchers (verbatim, #138 will remove) |
| **GridSettingsContext** | `useGridSettings()` | `cellHeight`/`setCellHeight`, `gridFrequency`/`setGridFrequency`, `workingHoursStart`/`setWorkingHoursStart`, `workingHoursEnd`/`setWorkingHoursEnd` — all four on `usePersistedState` |

**Dependency graph (explicit — the data context is NOT independent):** the provider composition reads view (filters) and settings (working hours) values and passes them INTO the data provider as inputs. `filteredItems` = f(enrichedData, filters); `gridStartMinutes`/`gridEndMinutes` = `calculateGridTimeRange(filteredItems, workingHoursStart, workingHoursEnd)` — **single derivation site preserved** (GH #142 rule; views never call `calculateGridTimeRange`). With no activities, bounds fall back to the working-hours range (e.g. `[]` + 9..21 → 540/1260) — same as today. Consequences, accepted: filter toggles and working-hours changes (rare) re-render data consumers — identical to today's behavior; zoom (frequent) does not — this satisfies DoD-1. `currentWeek` derives from `useNavigation()`; the data provider calls `useNavigation()` internally for the range query and `dayIndex`→date math in `addActivity` (NavigationContext untouched).

`isSaving` is NOT a context field — see §5 (mutationKey + `useMutationState`).

File layout: `contexts/schedule/` — `ScheduleDataContext.tsx`, `ScheduleViewContext.tsx`, `GridSettingsContext.tsx`, `ScheduleProvider.tsx` (composition). Import alias `@/contexts/schedule/*` resolves via the existing `@/*` mapping. Old `contexts/ScheduleContext.tsx` is deleted. Query keys, cache-sharing (raw/domain), optimistic-cache mechanics stay byte-identical — only ownership moves.

**Consumer migration map — regenerated from actual destructuring (panel-verified; components stack the hooks they need):**

| Consumer | Reads after split |
|---|---|
| `app/components/schedule/WeekView.tsx` | data + view + settings |
| `app/components/schedule/DayView.tsx` | data + view + settings |
| `app/components/layout/Topbar.tsx` (:21-45 — 24 fields) | data + view + settings |
| `app/components/layout/Toolbar.tsx` (:52) | data (`copyLastWeek` only) |
| `app/components/stamp/StampPanel.tsx` (:10) | view (`stamp`) + data (masters/services/locations) |
| `app/components/schedule/ActivityCard.tsx` (:25 — `cellHeight` for card geometry) | data + settings |
| `app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` | data |
| `app/components/modal/ActivityDetailsModal/SettingsTab.tsx` (:32 — `gridFrequency`) | data + settings |
| `app/(main)/schedule/page.tsx` (:14 — inner `ScheduleView` reads `viewMode`) | view (+ mounts provider) |
| `app/(main)/clients/components/ClientRecordTab.tsx` (:35 — `gridFrequency` only) | settings |

The indicator (§4-5) renders in Topbar — visible wherever the provider is mounted (both pages), accepted.

## 4. `usePersistedState` (new, `hooks/usePersistedState.ts`)

```ts
function usePersistedState<T>(key: string, fallback: T, decode: (raw: string) => T | null): [T, (v: T) => void]
```

- lazy init: read → `decode` → fallback on null/throw/garbage (replaces the three read functions + their try/catch);
- **SSR mechanics identical to today, deliberately**: lazy `useState` initializer + `typeof window === 'undefined'` guard — the exact pattern the four grid settings use now. No `useSyncExternalStore`, no cross-tab `storage` event subscription (no requirement today — recorded so future work knows it was considered);
- setter: `JSON.stringify` in try/catch (storage may be full/blocked). For valid integer inputs output is byte-identical to today's `String(...)` writes;
- **write-side validation stays at the domain layer**: `useGridSettings` keeps today's clamp/validate wrappers (`VALID_CELL_HEIGHTS`, frequency options, 0..23 hours) around the hook's setter — the hook owns storage mechanics, the domain owns value semantics;
- **storage keys and formats unchanged**: `memo-cell-height`, `memo-grid-frequency`, `memo-working-hours-start`, `memo-working-hours-end` (plain numbers), DataTable's existing JSON array — no data migration.

**DataTable migration** (`app/components/shared/DataTable.tsx:19-66`): the hook replaces the raw read/write block. DataTable's column-aware check (parsed ids ⊆ current `columns` prop) is runtime-dependent and stays IN the component — `decode` handles storage validity only. Behavior identical.

`UserSettingsContext.tsx` keeps its own localStorage access (documented exemption in DoD-2).

## 5. Mutation correctness + indicator + guard

**Timeout removal:** `updateActivityMutationFn` (:326-333) loses `Promise.race`/`setTimeout` — calls `apiPatchActivity` directly. `onMutate` optimistic write, `onError` rollback, `onSettled` invalidation stay unchanged. No retry policy changes (mutations don't retry by default). Slow server ⇒ optimistic UI holds the new position until settle — no premature rollback race.

**Indicator:** the three mutations get a shared `mutationKey` (e.g. `['schedule-activity']`); Topbar renders the "сохраняем…" chip driven by `useMutationState({ filters: { mutationKey }, select: (states) => states.some(s => s.isPending) })` — TanStack v5's designed tool for this; no provider wiring, no context field. Multiple simultaneous in-flight mutations collapse into one boolean flag — sufficient.

**Guard** (new `hooks/useUnsavedChangesGuard(isDirty: boolean)`): when dirty (any schedule mutation pending), attach `beforeunload` listener (native dialog — browsers control copy); when clean, detach. Attach-ONLY-while-dirty is deliberate (MDN: permanent `beforeunload` listeners evict pages from bfcache). In-app navigation is NOT intercepted (decision §2.5): the request keeps flying and data converges via the global queryClient on any later visit.

## 6. Filter initialization fix

Replace the both-non-empty gate (:306-313) with per-directory init: when the masters query has **settled successfully** (isSuccess — distinct from loading and error), set `filterMasterIds` once to all master ids; same independently for locations. Empty dictionary ⇒ filters initialize to `[]` (renders as "show all" — current display semantics). Later-added masters remain invisible until the user touches filters — existing behavior, unchanged.

## 7. User scenarios (drive the plan's Behavioral Delta)

- **С1 Zoom isolation:** admin zooms the grid — components that don't render grid geometry do not re-render (ActivityDetailsModal, StampPanel fields; cards/views/topbar legitimately re-render — they draw the grid). Verified by render-counter test on a data-only consumer.
- **С2 Slow save:** server takes long on drag/edit — activity stays at the new position, "сохраняем…" chip visible; on settle the screen converges to server truth. No 5s rollback.
- **С3 Leave mid-save:** admin reloads/closes the tab while saving — native browser warning; can stay. In-app navigation is free: the save completes in the background and the screen converges on return.
- **С4 Empty locations dictionary:** master filters initialize; grid renders "show all".
- **С5 Persisted settings survive reload:** zoom / grid frequency / working hours / table column visibility — same values as before reload, now via one shared hook.

## 8. Out of scope / constraints (binding)

- **#138** (view-state → URL, `__memo-*` removal) — strictly after #141, operates on the new `ScheduleViewContext`; listeners move verbatim; Menubar dispatcher unchanged (provider stays on both pages).
- **#242** `copyLastWeek` — stub stays, button stays, no signal added.
- **#243** visits/payments deletion consistency — untouched.
- `UserSettingsContext` — untouched. Backend, api-client, NavigationContext — untouched. No new dependencies.

## 9. Definition of Done

- Test: changing `cellHeight` does not re-render a data-only consumer (render-counter test).
- `grep -rn "localStorage" frontend/admin/{contexts,hooks,app}` → hits ONLY in `hooks/usePersistedState.ts` and `contexts/UserSettingsContext.tsx` (documented exemption). E2e specs are outside this grep's scope.
- `grep -n "Promise.race" frontend/admin/contexts/` → empty (issue DoD-3).
- `grep -rn "useSchedule\b" frontend/admin/` → empty (no stragglers after hook deletion).
- Indicator visible while a schedule mutation is pending (unit); guard attaches/detaches `beforeunload` on dirty/clean transitions (unit).
- Filter-init test covers empty-locations; persisted-state tests cover garbage/corrupt storage fallback.
- Domain rule updated (`docs/domain-rules/activities.md` — Race protection) and committed together with the spec.
- TypeScript strict + existing lint/test suites green.

## 10. Test impact summary

**Scale (panel-verified; G2 amendment: 26, not 24 — plan-review recount): 26 test files reference `useSchedule`/`ScheduleContext`/`ScheduleProvider`** — all migrate. Groups: `__tests__/ScheduleContext.test.tsx` (717 lines — splits per destination context); component tests mocking `useSchedule` (`Topbar`, `CellHeight`, `CellHeight.Topbar`, `Toolbar`, `Menubar`, `StampPanel`, `ActivityCard`, `DayView`, `WeekView`, `DayColumn`, `OverlapPopover`, `ActivityDetailsModal`, `optimisticUpdate`, `timezone-dnd-bug`, `scheduleIntegration`, `page`, `ClientsPage`, `ClientsIntegration`, `ClientTab.integration`, `ClientRecordTab.{interactions,api,layout}`); shared helpers `__tests__/helpers/mockContexts.ts` and `__tests__/helpers/renderWithProviders.tsx` — the single `useSchedule` mock splits into three (`useScheduleData`/`useScheduleView`/`useGridSettings`). New suites: `usePersistedState.test.ts`, guard tests, zoom-isolation test. E2e suites referencing `__memo-*` events keep working (events unchanged); no new e2e required for С1/С2/С3 (unit-level).
