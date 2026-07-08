# Design Spec: Unify records/visits/payments caches (single source of truth)

- **Date:** 2026-07-08
- **GH Issue:** #127 (supersedes #130)
- **Type:** Frontend refactor (React Query cache architecture + component design)
- **Workflow:** Full (brainstorming → spec → plan → TDD). NOT FasTP.
- **Scope:** Frontend only. No backend/schema changes.

---

## 1. Problem

Records/visits/payments data is duplicated across multiple React Query caches with
**no single source of truth**. Fine-grained mutations write to one cache while the UI
reads from another → stale rows, "need F5" bugs, rows disappearing after add, undo
that dies on modal close.

### Current cache map (confirmed by recon 2026-07-08)

**Visits live in 3 caches:**

| queryKey | data | reader | writer |
|----------|------|--------|--------|
| `['records', dateFrom, dateTo]` | records + nested visits | RecordsContext:50 | none direct (only invalidated via `['records']` prefix) |
| `['records', 'client', clientId]` | records (one client) | ClientCardModal(clients):55 | **NOBODY** → always stale after edits |
| `['record', recordId]` | single record + visits | useRecordData:15 | addVisit:283, patchVisit:299, deleteVisit:312, deleteVisitDeferred:356/371 |

**Payments live in 2 caches:** `['payments']` global (RecordsContext:87) + `['payments', recordId]` (useRecordData:47).

### Root cause

1. Inline-edit visit mutations write/invalidate ONLY `['record', recordId]` (detail),
   but schedule grid + modal tab list read from `['records', df, dt]` (list) → list stays stale.
2. `ActivityDetailsModal` reads visits from BOTH caches at once (tab list from
   `['records', df, dt]`, ClientTab body from `['record', recordId]`) → guaranteed divergence during edit.
3. `['records', 'client', clientId]` (/clients) has NO writer → always stale after edits.

### Audit finding (owner comment 2026-07-08)

Cache unification alone fixes only **~60%** of symptoms. The remaining ~40% are
**component-design bugs** independent of cache keys:

| File:line | Class | Why it survives cache unification |
|-----------|-------|-----------------------------------|
| RecordVisitsTable.tsx:224-247 + RecordPaymentsTable.tsx:141-158 | `useEffect` rebuilds local `rows` from props | Even with one cache, the effect overwrites local editing state mid-edit → "row disappears" (Bug #3) is a React anti-pattern, not a cache-key bug |
| ClientTab.tsx:39-69 | Prop/hook dual-sourcing | visits/payments from props, visitorsMap from `useRecordData` → two sources, invalidated at different granularity |
| useRecordMutations.ts:338-347 deferred-delete timers (useRef Map) | Timer lifetime tied to component | Modal close unmounts hook → cleanup useEffect cancels pending DELETE (Bug #2) → zombie row |

The spec below covers **both layers** so the visible bugs do not survive the refactor.

---

## 2. Design

Two independent layers. Layer 1 fixes the ~60% (cache); Layer 2 fixes the ~40% (component design). They are complementary — neither alone fully fixes Bug #3.

### Layer 1 — Single source of truth (Option A)

**Canonical store:** `['record', recordId]` is the single source of truth for one record
(its visits + payments).

- List caches (`['records', df, dt]`, `['records', 'client', clientId]`) are **seeded**
  from responses and **synchronously patched** on every record mutation — the mutation
  updates BOTH the detail key AND the relevant list key(s).
- `['records', 'client', clientId]` is **included** in the sync (previously dead — no writer).
- `['payments']` global + `['payments', recordId]` are **unified** to the canonical store.
- `invalidateAll()` blanket-hammer (useRecordMutations:50-58) is **replaced** by targeted
  canonical updates + targeted list patches. Blanket invalidation of records+activities+
  payments+clients+record on every mutation is removed.

**Why Option A (not B normalize-list, not C entity-normalization):**
- Mutations already write to `['record', recordId]` → minimal drift from current model.
- YAGNI: a normalized entity cache (Redux/RTK-style) is overkill for 3-5 screens with one
  primary entity. React Query already provides caching/refetch. A normalization layer would
  be a "mini-backend in the frontend" — not justified at this scale.
- `['records', 'client', clientId]` filters by client, not date → does not fit Option B's
  single date-keyed list store.

### Layer 2 — Component-design fixes (independent of Layer 1)

#### 2.1 useEffect-rebuild → useMemo(saved) + useState(drafts)

Applies to `RecordVisitsTable` and `RecordPaymentsTable`.

Current anti-pattern: one local `useState<Row[]>` holds BOTH saved rows (mirror of cache)
AND draft rows (`id===null`, unsaved). A `useEffect` re-derives it from props on every
`visits`/`payments` change, heuristically merging via `find(id)` / `filter(id===null)`.
This creates a second source of truth and races optimistic `setQueryData`.

New model:
- **Saved rows** = `useMemo` derived from the cache-backed prop (`visits` / `payments`).
  Single source of truth = cache. NOT stored in `useState`.
- **Draft rows** (`id===null`) = a separate small `useState<Row[]>`, local until saved.
  On save, the draft is removed (server now provides it via the cache).
- **Render** = `[...savedRows, ...draftRows]`.
- The `useEffect` (RecordVisitsTable:226-247, RecordPaymentsTable:141-158) is **deleted**.

Editing an existing (saved) row goes through a mutation → cache updates → useMemo
recomputes. No race, no local mirror to overwrite.

#### 2.2 ClientTab → fully hook-driven

`ClientTab` currently dual-sources: `visits`/`payments` from props (parent
ActivityDetailsModal ← RecordsContext), `visitorsMap` from its own `useRecordData()`.

Fix: `ClientTab` reads **everything** from `useRecordData(recordId, clientId)` — visits,
payments, visitorsMap all from the canonical `['record', recordId]` store. The
prop-passing of visits/payments from the parent is removed. This mirrors `ClientRecordTab`
(the /clients tab), which is already fully hook-driven — an existing correct template.

#### 2.3 Deferred-delete = optimistic setQueryData (Variant X)

Deleting a **saved** row (5s undo window) must "hide" the row before the real DELETE fires,
while keeping the cache as the single source of truth:

- `×` on saved row → mutation calls `setQueryData` on the canonical store, removing the
  visit/payment from the cache immediately. `useMemo(saved)` recomputes → row disappears.
- Toast "Удалено. Отменить" (5s).
- "Отменить" → `setQueryData` restores the item into the cache → row reappears.
- 5s elapsed → real DELETE + confirm (targeted invalidation / cache reconcile).
- `×` on a **draft** row (`id===null`) → instant local removal from `useState(drafts)`,
  no toast, no server call (unchanged).

No separate `pendingDeleteIds` Set — the cache is the source of truth for "hidden" too.

#### 2.4 App-level undo provider (Bug #2)

Deferred-delete timers currently live in `useRecordMutations`' `useRef<Map>` (338-347),
with a cleanup `useEffect` that clears them on unmount. Closing the modal unmounts the hook
→ pending DELETE cancelled → cache says "deleted", server says "not deleted" → zombie row
returns on reopen (this is the C-clarification symptom).

Fix: move the pending-delete queue (timers + toast + optimistic cache operations) into an
**app-level provider** mounted above the modals. The provider owns the full deferred-delete
lifecycle:
- schedules the timer (survives modal unmount → DELETE completes),
- performs the optimistic cache remove/restore (Variant X),
- renders the undo toast at app level.

Because the timer no longer lives in the modal, closing the modal does not cancel the DELETE.

---

## 3. Scope

### In scope
- Layer 1 cache unification (canonical `['record', recordId]`, list-key sync, `['payments']` unify, remove `invalidateAll` hammer).
- Fix `['records', 'client', clientId]` (add writer / include in sync).
- Layer 2: useMemo+drafts tables, ClientTab hook-driven, optimistic deferred-delete, app-level undo provider.
- **Absorbs #130** (deleteRecord bare-key + deletePaymentDeferred missing invalidation dissolve under single source of truth). Close #130 as superseded-by-#127 once this lands.

### Out of scope (explicit)
- **ScheduleContext `['activities']`** — separate cache domain (schedule grid). NOT touched.
- Backend / schema / API changes — none.
- Normalized entity cache (Option C) — deferred; revisit only if a 3rd realtime screen or
  cross-entity shared sub-objects appear.

### Blast radius (files)
`RecordsContext`, `useRecordData`, `useRecordMutations`, `useOptimisticVisitMutation`,
`ActivityDetailsModal`, `ClientTab`, `ClientRecordTab`, `ClientCardModal` (both /records and
/clients variants), `RecordVisitsTable`, `RecordPaymentsTable`, + new app-level undo provider.

---

## 4. User Scenarios (each maps to an E2E test)

- **US-1 — Add visitor persists.** Open activity modal → "+ Добавить" → type name → Enter →
  the saved row stays visible (no "row disappears", no F5 needed).
- **US-2 — Delete visitor stays deleted across tabs.** Delete a visitor → row disappears
  immediately → switch modal tab and back → the row does NOT return (no stale list cache).
- **US-3 — Undo restores.** Delete a visitor → toast "Удалено. Отменить" appears → click
  "Отменить" within 5s → the row returns and no DELETE was sent to the server.
- **US-4 — Undo survives modal close.** Delete a visitor → close the modal before 5s elapse →
  the DELETE still fires → reopen the modal → the row is gone (no zombie row).
- **US-5 — Payment totals live-update.** Add or delete a payment in the modal → the totals in
  the /records table update without F5.
- **US-6 — Cross-page consistency.** Edit a record in the /schedule modal → open the same
  record on /clients → the data is current (shared canonical store, no stale
  `['records','client',id]`).
- **US-7 — Deleted payment updates client stats.** Delete a payment → client stats
  (total_paid) recompute correctly (deferred DELETE commits; stats reflect it).

---

## 5. Visual Compliance Checks

- [ ] After add-visitor + Enter, the new row is present in the visits table (not gone).
- [ ] After delete-visitor, the row is absent from the visits table.
- [ ] The undo toast "Удалено. Отменить" is visible after deleting a saved row.
- [ ] Payment totals in the /records table reflect an added/deleted payment without reload.

---

## 6. Testing Strategy

- **Unit (vitest):** cache read/write assertions per mutation (canonical + list-key sync),
  useMemo(saved)+drafts render logic, optimistic deferred-delete cache remove/restore,
  app-level undo provider timer survival across unmount. Reuse `createQueryClientWrapper`
  (real QueryClient) for cache-behavior tests.
- **E2E (playwright):** US-1..US-7. Reuse `admin-adds-visitor.spec.ts` /
  `admin-manages-payments.spec.ts` patterns (these run clean). Note pre-existing #124 skips
  in `unified-rows.spec.ts` (openModal picks wrong activity on multi-record week).
- **Regression baseline:** ensure existing `useRecordMutations.test.ts` (821 lines) and
  `useRecordData.test.tsx` still pass or are updated intentionally.

---

## 7. Open risks / notes

- Removing `invalidateAll()` must not under-invalidate: each mutation's targeted updates must
  cover every reader of the changed data. The plan must enumerate reader→writer pairs per
  mutation (recon map in scratchpad is the source).
- App-level undo provider changes app composition (a new provider high in the tree) — verify
  it wraps all pages that use deferred-delete (/schedule, /clients, /records).
- ClientCardModal (/clients) currently fetches its own `['records','client',id]` — decide in
  the plan whether it seeds the canonical store or reads a synced list key.
