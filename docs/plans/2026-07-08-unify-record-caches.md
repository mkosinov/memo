# Unify records/visits/payments caches — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `['record', recordId]` the single source of truth for a record's visits/payments, remove the divergent cache/mutation/optimistic layers, and move deferred-delete to an app-level provider — eliminating "row disappears", "F5 needed", and "undo dies on modal close".

**Architecture:** Canonical detail store (`['record', recordId]`) is seeded from list responses and synchronously patched by every fine-grained mutation, which also patches the relevant list keys (`['records', df, dt]`, `['records', 'client', clientId]`, `['payments']`). Visit tables derive saved rows via `useMemo` from cache-backed props and hold only unsaved drafts in local state. `useOptimisticVisitMutation` and the coarse full-array visit path are removed. A generic `PendingActionsProvider` (command pattern, `kind='delete'` only) owns deferred-delete timers so they survive modal unmount.

**Tech Stack:** Next.js 14 (App Router), TypeScript, React Query (TanStack v5), vitest + @testing-library/react, Playwright.

**Spec:** `docs/specs/2026-07-08-unify-record-caches-design.md` (GH #127, supersedes #130)

---

## Behavioral Delta

How this behaves for the user, mapped to spec acceptance criteria (§4 User Scenarios):

- **US-1 (add visitor persists)** → In the activity modal, "+ Добавить" → type name → Enter: the new row stays visible. No flicker, no F5.
- **US-2 (delete stays deleted across tabs)** → Delete a visitor → row vanishes immediately → switch modal tab and back → the row does NOT reappear.
- **US-3 (undo restores)** → Delete a visitor → toast "Удалено. Отменить" → click "Отменить" within 5s → row returns, nothing was deleted on the server.
- **US-4 (undo survives modal close)** → Delete a visitor → close the modal before 5s → the delete still commits → reopen → row is gone (no zombie).
- **US-5 (payment totals live-update)** → Add/delete a payment → the /records table totals update without reload.
- **US-6 (cross-page consistency)** → Edit a record in the /schedule modal → the same record on /clients shows current data.
- **US-7 (deleted payment updates client stats)** → Delete a payment → client total_paid recomputes correctly after commit.

---

## File Structure

**New files:**
- `frontend/admin/contexts/PendingActionsContext.tsx` — generic deferred-action provider + `usePendingActions()` hook.
- `frontend/admin/lib/cache/recordCacheSync.ts` — pure helpers to patch canonical + list caches consistently (single place for cache-write logic).
- Test files alongside each (see tasks).

**Modified files:**
- `frontend/admin/hooks/useRecordMutations.ts` — fine-grained mutations write canonical + list keys via helpers; deferred-delete delegates to PendingActions; remove `invalidateAll` hammer.
- `frontend/admin/hooks/useRecordData.ts` — unchanged signature; ensure it's the canonical reader (may add seeding note).
- `frontend/admin/contexts/RecordsContext.tsx` — seed canonical `['record', id]` from list; keep `['records', df, dt]` + `['payments']` readers.
- `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx` — useMemo(saved)+useState(drafts), delete useEffect-sync.
- `frontend/admin/app/components/shared/record/blocks/RecordPaymentsTable.tsx` — same pattern.
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` — fully hook-driven; drop visits/payments props; remove optimistic layer usage.
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` — stop passing visits/payments to ClientTab.
- `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` — visit CRUD via fine-grained; remove optimistic layer usage.
- `frontend/admin/app/providers.tsx` — mount `PendingActionsProvider`.
- `frontend/admin/hooks/useOptimisticVisitMutation.ts` — **DELETED**.

---

## Task ordering rationale

Foundation-first, each task leaves the app working:
1. Cache-sync helpers (pure, testable) — no behavior change yet.
2. PendingActions provider (isolated, no consumers yet).
3. Rewire mutations to helpers + provider (behavior improves, old paths still present).
4. Tables → useMemo+drafts (fixes row-disappears).
5. ClientTab hook-driven + remove optimistic layer (fixes dual-source).
6. ClientRecordTab fine-grained + remove optimistic layer.
7. Delete useOptimisticVisitMutation + cleanup invalidateAll.
8. E2E scenarios US-1..US-7.

---

## Task 1: Cache-sync helpers (canonical + list keys)

### Classification: standard

### Required Docs
- `docs/specs/2026-07-08-unify-record-caches-design.md` — §2.1 (Option A), §7 (don't under-invalidate).
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — unit test patterns, real QueryClient wrapper.
- Scratchpad recon (cache read/write graph) — reader→writer per key.

### Task Description
Create pure helper functions that encapsulate ALL record/visit/payment cache writes so every
mutation patches the canonical store AND the list keys consistently. This is the single place
that knows the cache-key topology.

Create `frontend/admin/lib/cache/recordCacheSync.ts` exporting (exact signatures):

```ts
import type { QueryClient } from '@tanstack/react-query';
import type { RecordResponse, VisitResponse, PaymentResponse } from '@memo/api-client';

/** Patch a single record everywhere it lives: canonical + every list cache. */
export function patchRecordEverywhere(
  qc: QueryClient,
  recordId: string,
  updater: (record: RecordResponse) => RecordResponse,
): void;

/** Add/replace a visit in the canonical record + mirror into list caches. */
export function upsertVisit(qc: QueryClient, recordId: string, visit: VisitResponse): void;

/** Remove a visit from canonical + list caches. */
export function removeVisit(qc: QueryClient, recordId: string, visitId: string): void;

/** Upsert a payment: canonical per-record key + global ['payments']. */
export function upsertPayment(qc: QueryClient, recordId: string, payment: PaymentResponse): void;

/** Remove a payment from per-record + global ['payments']. */
export function removePayment(qc: QueryClient, recordId: string, paymentId: string): void;

/** Seed canonical ['record', id] from a list-fetched record (if not already present/fresher). */
export function seedRecordFromList(qc: QueryClient, record: RecordResponse): void;
```

Implementation rules:
- `patchRecordEverywhere` uses `qc.setQueryData(['record', recordId], updater-guarded)` and
  `qc.setQueriesData({ queryKey: ['records'] }, ...)` (prefix match → covers `['records',df,dt]`
  AND `['records','client',clientId]`) mapping the matching record through `updater`.
- All updaters MUST guard `old == null` (return old unchanged) — see spec §7 stale-cache.
- `upsertVisit`/`removeVisit` operate on `record.visits` via `patchRecordEverywhere`.
- `upsertPayment`/`removePayment` write BOTH `['payments', recordId]` and `['payments']`
  (global list — filter/replace by id).
- `seedRecordFromList` only sets `['record', id]` if absent (`qc.getQueryData` undefined).

### Steps
- [ ] Write `frontend/admin/__tests__/recordCacheSync.test.ts` (RED). Use real QueryClient
      (`new QueryClient({ defaultOptions: { queries: { retry: false } } })`). Seed
      `['record','r1']`, `['records','2026-01-01','2026-01-31']` (array incl. r1),
      `['payments','r1']`, `['payments']`. Assert each helper mutates ALL relevant keys and
      guards null. Cover: upsertVisit adds to canonical+list; removeVisit removes from both;
      upsertPayment writes per-record+global; removePayment removes from both;
      patchRecordEverywhere with null cache is a no-op; seedRecordFromList no-ops if present.
- [ ] Run `cd frontend/admin && npm run test -- recordCacheSync` → confirm FAIL (module missing).
- [ ] Implement `frontend/admin/lib/cache/recordCacheSync.ts`.
- [ ] Run `npm run test -- recordCacheSync` → confirm PASS.
- [ ] Run `npx tsc --noEmit` (from frontend/admin) → clean.
- [ ] Commit: `feat(#127): add recordCacheSync helpers (canonical + list keys)`

### DoD
- All helpers tested with real QueryClient; null-guards verified; tsc clean.

---

## Task 2: Generic PendingActionsProvider (kind='delete')

### Classification: standard

### Required Docs
- `docs/specs/2026-07-08-unify-record-caches-design.md` — §2.4 (interface + YAGNI boundary), §7 (per-id cancel, snapshot correctness).
- Scratchpad recon (ses_0bc1cb981ffe) — toast infra: `UIContext.showToast(msg, undo)`, ToastContainer renders "Отменить".

### Task Description
Create an app-level provider that owns deferred-action timers so they survive modal unmount.
Generic by mechanism (command pattern); only `kind='delete'` is used now.

Create `frontend/admin/contexts/PendingActionsContext.tsx`:

```ts
export type PendingAction = {
  id: string;                    // dedupe/cancel key
  kind: 'delete';                // OPEN union for future 'report' | 'notify'
  message: string;               // toast text
  delayMs: number;               // undo window
  commit: () => Promise<void>;   // real action on timeout
  undo: () => void;              // rollback optimistic change
};

export function usePendingActions(): {
  enqueuePendingAction: (action: PendingAction) => void;
};
```

Behavior:
- Provider holds a `useRef<Map<string, ReturnType<typeof setTimeout>>>` at APP level (never
  unmounts during normal navigation).
- `enqueuePendingAction(action)`:
  1. If a timer for `action.id` exists → `clearTimeout` + delete (cancel prior, preserve
     current "cancel existing timer" behavior).
  2. Show toast via `useUI().showToast(action.message, () => { action.undo(); clearTimeout+delete for id; })`.
  3. `setTimeout(async () => { await action.commit(); map.delete(id); }, action.delayMs)`.
     Store the timer in the map.
- On provider unmount (app teardown only) → clear all timers.
- **Does NOT render toasts itself** — reuses `useUI().showToast` + existing `ToastContainer`.

### Steps
- [ ] Write `frontend/admin/__tests__/PendingActionsContext.test.tsx` (RED). Mock `useUI`
      (`showToast` captured). Render provider + a child that calls `enqueuePendingAction`.
      Use `vi.useFakeTimers()`. Assert: (a) toast shown with message + undo callback; (b)
      after `advanceTimersByTime(delayMs)` `commit` is called; (c) invoking the captured undo
      callback before timeout → `undo` called, `commit` NOT called after advancing time; (d)
      enqueue same id twice → first timer cancelled (commit called once).
- [ ] Run `npm run test -- PendingActionsContext` → FAIL.
- [ ] Implement `PendingActionsContext.tsx`.
- [ ] Run `npm run test -- PendingActionsContext` → PASS.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `feat(#127): add generic PendingActionsProvider (kind=delete)`

### DoD
- Timer survives across re-renders; undo cancels commit; per-id cancel works; reuses existing toast.

---

## Task 3: Mount PendingActionsProvider in the app tree

### Classification: small

### Required Docs
- Scratchpad recon — provider tree order (must be INSIDE QueryClient + UIProvider).

### Task Description
Mount `PendingActionsProvider` in `frontend/admin/app/providers.tsx` so it wraps all pages
(/schedule, /clients, /records). It must be INSIDE `QueryClientWithErrorReporting` (uses
queryClient) and INSIDE `UIProvider` (uses `useUI`).

Place it between `ClientsProvider` and `UserSettingsProvider` (or wrapping `{children}`).

### Steps
- [ ] Modify `app/providers.tsx`: import + wrap `{children}` with `<PendingActionsProvider>`.
- [ ] Run `npm run test` (full vitest) → existing tests still pass.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `feat(#127): mount PendingActionsProvider in app tree`

### DoD
- Provider mounted inside QueryClient + UIProvider; no test regressions.

---

## Task 4: Rewire useRecordMutations to helpers + PendingActions

### Classification: large

### Required Docs
- `docs/specs/2026-07-08-unify-record-caches-design.md` — §2.1, §2.3 (Variant X), §2.4, §7.
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — real QueryClient test wrapper.
- Existing `frontend/admin/__tests__/useRecordMutations.test.ts` (821 lines) — update, don't rewrite wholesale.

### Task Description
Rewire `frontend/admin/hooks/useRecordMutations.ts`:

1. **Fine-grained visit mutations** (`addVisit`, `patchVisit`, `deleteVisit`) → use
   `recordCacheSync` helpers (`upsertVisit`/`removeVisit`) instead of ad-hoc `setQueryData`
   on `['record', recordId]` only. This makes list caches update too.
2. **Payment mutations** (`addPayment`, `patchPayment`, `deletePayment`) → use
   `upsertPayment`/`removePayment` (canonical per-record + global `['payments']`).
3. **`deleteRecord`** → replace the dead bare `['records']` setQueryData (line 169) with
   `qc.setQueriesData({ queryKey: ['records'] }, remove-record)` (prefix match). **This
   absorbs #130 Bug 1.**
4. **`deleteVisitDeferred` / `deletePaymentDeferred`** → keep the optimistic remove (via
   helpers) but delegate the timer+toast to `usePendingActions().enqueuePendingAction`:
   - snapshot the row BEFORE remove (from canonical cache),
   - optimistic `removeVisit`/`removePayment`,
   - `enqueuePendingAction({ id, kind:'delete', message:'Удалено. Отменить', delayMs:5000,
     undo: () => upsertVisit/upsertPayment(snapshot), commit: () => apiDelete + targeted reconcile })`.
   - Remove the local `pendingDeleteTimers` useRef + cleanup useEffect (now owned by provider).
   **This fixes Bug #2 (survives modal close) and absorbs #130 Bug 2** (commit does targeted
   `['payments']` reconcile via helper).
5. **Replace `invalidateAll()`** on fine-grained mutations with targeted helper updates. Keep
   a narrower invalidation only where a full refetch is genuinely needed (record-level
   saveRecord/createRecord may still invalidate `['records']` + `['record',id]` — but NOT the
   5-key blanket). Document each remaining invalidate with a comment naming its reader.

Keep `saveRecord`/`patchRecord`/`updateRecord`/`createRecord`/`addVisitorToRecord`/
`updateAnonymVisits`/`deleteVisitor` for record-level ops (they are NOT visit-CRUD fine-grained
and can keep coarse patchRecord, but should use targeted invalidation, not the 5-key hammer).

### Steps
- [ ] Update `useRecordMutations.test.ts` (RED): change assertions so deferred-delete calls
      `enqueuePendingAction` (mock the provider hook), fine-grained mutations call the
      `recordCacheSync` helpers (spy/mock them or assert cache state via real QueryClient),
      `deleteRecord` uses `setQueriesData` prefix, `deletePaymentDeferred` commit reconciles
      `['payments']`. Add a test: after `addVisit`, the record inside `['records',df,dt]` also
      contains the new visit (list-key sync).
- [ ] Run `npm run test -- useRecordMutations` → FAIL.
- [ ] Refactor `useRecordMutations.ts` per description. Import helpers + `usePendingActions`.
- [ ] Run `npm run test -- useRecordMutations` → PASS.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `refactor(#127): useRecordMutations → cache helpers + PendingActions, drop invalidateAll hammer`

### DoD
- Fine-grained mutations sync canonical+list; deferred-delete via provider; #130 Bugs 1&2 absorbed; no 5-key blanket invalidation on fine-grained ops; tests pass.

---

## Task 5: RecordVisitsTable → useMemo(saved) + useState(drafts)

### Classification: standard

### Required Docs
- `docs/specs/2026-07-08-unify-record-caches-design.md` — §2.1 (useMemo+drafts).
- Current `RecordVisitsTable.tsx` (the useEffect at 224-247 to delete).

### Task Description
Rewrite row-state management in
`frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx`:

- **Saved rows** = `useMemo(() => visits.map(v => visitResponseToRow(v, visitorsMap)), [visits, visitorsMap])`.
  Single source of truth = the `visits` prop (cache-backed after Task 4).
- **Draft rows** (`id === null`) = separate `const [drafts, setDrafts] = useState<VisitRow[]>([])`.
- **Render** = `[...savedRows, ...drafts]`.
- **Delete the `useEffect` (lines 224-247)** entirely.
- `handleAddClick` → `setDrafts(prev => [...prev, makeEmptyVisitRow(tariffs)])`.
- `handleRemove` (draft) → `setDrafts(prev => prev.filter(r => r !== row))`.
- `handleDeleteRow` (saved) → call `onDeleteVisit(id)` (which now triggers optimistic cache
  remove via Task 4) — do NOT locally filter saved rows; the useMemo reacts to the cache change.
- On successful add (`onSaved`) → remove the draft from `drafts` (server now provides it via
  cache). Preserve submitted values behavior (name/age) until the cache refetch resolves.

### Steps
- [ ] Update `RecordVisitsTable.test.tsx` (RED): assert draft rows render alongside saved;
      adding a draft then "saving" removes it from drafts; deleting a saved row calls
      `onDeleteVisit` and does NOT keep a stale local copy; no useEffect-driven overwrite.
- [ ] Run `npm run test -- RecordVisitsTable` → FAIL.
- [ ] Rewrite component per description.
- [ ] Run `npm run test -- RecordVisitsTable` → PASS.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `refactor(#127): RecordVisitsTable useMemo(saved)+drafts, drop useEffect-sync`

### DoD
- No useEffect rebuild; saved rows derive from prop; drafts isolated; tests pass.

---

## Task 6: RecordPaymentsTable → useMemo(saved) + useState(drafts)

### Classification: standard

### Required Docs
- Same as Task 5. Current `RecordPaymentsTable.tsx` useEffect at 141-158.

### Task Description
Apply the identical pattern to
`frontend/admin/app/components/shared/record/blocks/RecordPaymentsTable.tsx`:
saved rows via `useMemo(payments)`, drafts via `useState`, delete the useEffect (141-158),
delete of a saved payment goes through `onDeletePayment` (optimistic cache remove from Task 4).

### Steps
- [ ] Update `RecordPaymentsTable.test.tsx` (RED): mirror Task 5 assertions for payments.
- [ ] Run `npm run test -- RecordPaymentsTable` → FAIL.
- [ ] Rewrite component.
- [ ] Run `npm run test -- RecordPaymentsTable` → PASS.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `refactor(#127): RecordPaymentsTable useMemo(saved)+drafts, drop useEffect-sync`

### DoD
- Same as Task 5 for payments.

---

## Task 7: ClientTab → fully hook-driven, remove optimistic layer

### Classification: large

### Required Docs
- `docs/specs/2026-07-08-unify-record-caches-design.md` — §2.2, §2.2b.
- Current `ClientTab.tsx` (231 lines) + `ActivityDetailsModal.tsx` (props it passes).
- `ClientRecordTab.tsx` — the hook-driven template.

### Task Description
Make `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` fully
hook-driven and remove the optimistic layer:

- Read `record`, `visits`, `payments`, `visitorsMap`, `tariffs`, `status` from
  `useRecordData(recordId, clientId)` (NOT from props).
- Remove `useOptimisticVisitMutation` usage. Visit table gets `visits` from `useRecordData`
  (canonical), `onChangeVisitor` calls a fine-grained visitor update (keep `handleVisitorChange`
  behavior via a direct `updateVisitor` + `['visitors', clientId]` invalidation, OR a small
  inline callback — do NOT reintroduce override state).
- Visit CRUD → `addVisit` / `patchVisit` / `deleteVisitDeferred` (fine-grained, from
  useRecordMutations). Remove `handleDeleteVisit`/`handleAddVisitor` coarse full-array paths;
  wire the table's `onDeleteVisit` to `deleteVisitDeferred`, `onAddVisit` to `addVisit`.
- Record-level ops (status change, comment, anonym) may stay via `updateRecord` (coarse
  record-level patch) — those are not visit-CRUD.
- Change props: `ClientTab` now takes `recordId`, `clientId` (+ `client` stats, `onClose`,
  `showToast`). Remove `visits`, `payments`, `visitors`, `serviceTariffs`, `onUpdateRecord`,
  `onAddVisitor` props that came from the parent's list cache.
- Update `ActivityDetailsModal.tsx` to pass only `recordId`/`clientId` (+ stats/onClose) and
  STOP passing `record.visits`/`payments`.

### Steps
- [ ] Update `ClientTab.integration.test.tsx` (RED): mock `useRecordData` to return canonical
      visits/payments; assert ClientTab renders from the hook, not props; assert delete-visit
      goes through `deleteVisitDeferred`; assert no `useOptimisticVisitMutation` import.
- [ ] Run `npm run test -- ClientTab` → FAIL.
- [ ] Rewrite `ClientTab.tsx` per description.
- [ ] Update `ActivityDetailsModal.tsx` props for ClientTab.
- [ ] Run `npm run test -- ClientTab` and `-- ActivityDetailsModal` (if exists) → PASS.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `refactor(#127): ClientTab fully hook-driven, drop optimistic layer + prop dual-source`

### DoD
- ClientTab reads canonical store only; parent stops passing list-cache data; visit CRUD fine-grained; tests pass.

---

## Task 8: ClientRecordTab → fine-grained visit CRUD, remove optimistic layer

### Classification: large

### Required Docs
- `docs/specs/2026-07-08-unify-record-caches-design.md` — §2.2b.
- Current `ClientRecordTab.tsx` (304 lines) — uses saveRecord full-array + useOptimisticVisitMutation.

### Task Description
In `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`:
- Remove `useOptimisticVisitMutation` usage. Visit table reads `visits` from `useRecordData`
  (canonical) directly (not `mergedVisits`).
- Move visit add/delete off the coarse `saveRecord({visits: full array})` path onto
  fine-grained `addVisit`/`deleteVisitDeferred`. `handleAddVisitor`/`handleDeleteVisitor`
  become thin wrappers over the fine-grained mutations (which sync the canonical store).
- Keep `saveRecord` for the record-level Save button (custom_price, comment, date/service/
  activity changes) — that's record-level, not visit CRUD.
- `onChangeVisitor` → direct visitor update (as in ClientTab Task 7), not override state.

### Steps
- [ ] Update `ClientRecordTab.*.test.tsx` (RED, the 4 files): assert visit add/delete use
      fine-grained mutations; assert no `useOptimisticVisitMutation`; record-level Save still
      uses `saveRecord`.
- [ ] Run `npm run test -- ClientRecordTab` → FAIL.
- [ ] Rewrite the visit-CRUD wiring in `ClientRecordTab.tsx`.
- [ ] Run `npm run test -- ClientRecordTab` → PASS.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `refactor(#127): ClientRecordTab fine-grained visit CRUD, drop optimistic layer`

### DoD
- Visit CRUD fine-grained; record-level Save unchanged; no optimistic override layer; tests pass.

---

## Task 9: Delete useOptimisticVisitMutation + final invalidateAll cleanup

### Classification: standard

### Required Docs
- `docs/specs/2026-07-08-unify-record-caches-design.md` — §2.2b, §3.

### Task Description
- Delete `frontend/admin/hooks/useOptimisticVisitMutation.ts` (now unused after Tasks 7-8).
- Grep the repo for any remaining imports of it → remove.
- Grep for remaining `invalidateAll` usages in `useRecordMutations.ts`; ensure only
  record-level ops that genuinely need a broad refetch retain a NARROW targeted invalidation
  (documented). Remove any now-dead helper.
- Verify `['records', 'client', clientId]` now receives writes via `setQueriesData(['records'])`
  prefix in the helpers (spec §3 — was previously dead). Add a targeted test if not covered.

### Steps
- [ ] Grep: `rg "useOptimisticVisitMutation" frontend/admin` → expect only the file itself.
- [ ] Delete the file + any dangling imports.
- [ ] Grep: `rg "invalidateAll" frontend/admin/hooks/useRecordMutations.ts` → review each; keep only justified narrow ones (or none).
- [ ] Add/confirm a test asserting a visit mutation updates a record inside a
      `['records','client',clientId]` cache entry (prefix sync).
- [ ] Run `npm run test` (full vitest) → PASS.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `refactor(#127): delete useOptimisticVisitMutation + remove invalidateAll hammer`

### DoD
- Optimistic hook gone; no blanket invalidation; `['records','client',id]` synced; full unit suite green.

---

## Task 10: E2E scenarios US-1..US-7

### Classification: standard

### Required Docs
- `docs/specs/2026-07-08-unify-record-caches-design.md` — §4 User Scenarios, §5 Visual Compliance.
- `.opencode/skills/vitest-playwright-patterns/SKILL.md` — Playwright Full Cycle pattern.
- Existing `e2e/admin-adds-visitor.spec.ts`, `e2e/admin-manages-payments.spec.ts` (clean patterns to reuse).

### Task Description
Add Playwright E2E coverage for the 7 user scenarios. Reuse the clean patterns from
`admin-adds-visitor.spec.ts` / `admin-manages-payments.spec.ts`. Note pre-existing #124 skips
in `unified-rows.spec.ts` (openModal picks wrong activity on multi-record week) — avoid that
trap by seeding single-record activities where needed.

Scenarios → tests:
- US-1 add visitor persists (no F5). US-2 delete stays deleted across tab switch. US-3 undo
  restores. US-4 undo survives modal close. US-5 payment totals live-update. US-6 cross-page
  consistency (/schedule edit → /clients current). US-7 deleted payment updates client stats.

### Steps
- [ ] Write `e2e/unify-caches.spec.ts` with US-1..US-7 (RED — some will fail before the
      refactor is fully wired; but since Tasks 1-9 are done, they should pass — run to confirm
      GREEN, investigate any red).
- [ ] Run `cd frontend/admin && npm run test:e2e -- unify-caches` (or the project's E2E command) → PASS.
- [ ] If any scenario is blocked by #124 → mark `test.fixme` with a comment referencing #124, NOT a silent skip.
- [ ] `npx tsc --noEmit` → clean.
- [ ] Commit: `test(#127): E2E scenarios US-1..US-7 for cache unification`

### DoD
- US-1..US-7 pass (or explicit #124-referenced fixme); no silent skips.

---

## Final verification (architect, after all tasks)
- [ ] Full suite: `cd frontend/admin && npm run test:all` (vitest + playwright) green (modulo documented baseline flakes #123/#124).
- [ ] Visual Compliance Gate (spec §5) against a running dev server.
- [ ] Close #130 as superseded-by-#127.

---

## Self-Review

**Spec coverage:**
- §2.1 Layer1 canonical+list sync → Tasks 1, 4, 9.
- §2.2 ClientTab hook-driven → Task 7.
- §2.2b unify mutations + remove optimistic → Tasks 7, 8, 9.
- §2.3 Variant X deferred-delete → Task 4.
- §2.4 PendingActions provider → Tasks 2, 3, 4.
- §2 useMemo+drafts tables → Tasks 5, 6.
- §3 fix `['records','client',id]` + `['payments']` unify + remove invalidateAll → Tasks 1, 4, 9.
- §3 absorb #130 → Task 4 (Bugs 1&2) + final close.
- §4 US-1..US-7 → Task 10.
No gaps.

**Placeholder scan:** no TBD/TODO; every task has exact files, signatures, commands.

**Type consistency:** helper signatures fixed in Task 1 and consumed unchanged in Task 4;
`PendingAction` type fixed in Task 2 and consumed in Task 4; `useRecordData` return shape
unchanged (recon-confirmed).

**Required Docs check:** every task has a Required Docs section.
