# Research: `updateVisitor` bypasses React Query mutation cache — root cause analysis

**Date:** 2026-07-22
**Context:** Memo frontend (Next.js 14 + React Query 5 + TypeScript)
**Triggered by:** E2E test `unified-rows.spec.ts` Scenario 5 ("visits: edit existing visitor name triggers API call") failing after removing a stale skip-guard.

---

## 1. Symptom

E2E test scenario fails:

1. Opens a record modal for seed record `r1` (activity details modal, client tab).
2. Finds an existing saved visit row (`data-testid="visit-row-{id}"`).
3. Fills the name `InlineEditCell` input with "Edited Name".
4. Presses Enter, then explicitly blurs the input.
5. Expects a `PUT /api/v1/visitors/{id}` request via `page.waitForRequest(...)` — **but no PUT is observed in the test's listening window**.

The input value does change in the DOM (Playwright snapshot confirms `textbox: "Edited Name"`), but the network listener never catches the PUT.

**Reproducible 100% of the time** on existing/saved rows. New-row scenarios (8, 9, 11, 14, 15) pass — they go through a different save path.

---

## 2. Architecture context

### Data flow for visitor name editing (existing rows)

```
InlineEditCell (name input)
  → onCommit(value)
    → RecordVisitsTable.onChangeVisitor(visitorId, {name: value})
      → ClientTab.handleVisitorChange(visitorId, {name: value})
        → updateVisitor(visitorId, apiData)        ← direct api() call, NOT useMutation
          .then(() => queryClient.invalidateQueries(['visitors', clientId]))
        ← PUT response discarded
          .catch(err => showToast(err))
```

### Key components

| Component | File | Role |
|-----------|------|------|
| `InlineEditCell` | `app/components/shared/record/InlineEditCell.tsx` | Generic inline-edit cell. Holds `draft` state + `originalRef` ref. On blur/Enter: if `draft !== originalRef.current`, calls `onCommit(draft)` and sets `originalRef.current = draft`. |
| `RecordVisitsTable` | `app/components/shared/record/blocks/RecordVisitsTable.tsx` | Renders visit rows. For existing rows, the name cell's `value` prop comes from `visitor?.name` in `visitorsMap` (derived from React Query cache). |
| `ClientTab` | `app/components/modal/ActivityDetailsModal/ClientTab.tsx` | Houses the table. `handleVisitorChange` is the commit handler — calls `updateVisitor` directly. |
| `useRecordData` | `app/hooks/useRecordData.ts` | React Query hook: `['visitors', clientId]` query → `visitorsMap`. This is the canonical source of visitor data. |
| `updateVisitor` | `packages/api-client/src/endpoints.ts:352` | Plain async function: `api(PUT) → Zod validated response`. Not a `useMutation`. |

### React Query cache structure

Cache key: `['visitors', clientId]`
- Query: `getClientVisitors(clientId)` → `GET /api/v1/clients/{clientId}/visitors`
- Mutation (if it existed): `PUT /api/v1/visitors/{id}` → returns updated `VisitorResponse`
- **No `useMutation` wrapper exists for `updateVisitor`.** The response of the PUT is thrown away.

---

## 3. Root cause analysis

### The commit chain step by step

```
Step 1: User types "Edited Name"
  - InlineEditCell.onChange → setDraft("Edited Name")
  - originalRef.current still holds seed name, e.g. "Анна"

Step 2: User presses Enter / blur fires
  - InlineEditCell.commitIfChanged():
    - draft ("Edited Name") !== originalRef.current ("Анна") → true
    - onCommit("Edited Name") is called
    - originalRef.current = "Edited Name"   ← optimistic update of ref

Step 3: onCommit → handleVisitorChange → updateVisitor(visitorId, {name: "Edited Name"})
  - This is a plain async function that calls fetch(PUT)
  - Returns a Promise<VisitorResponse>
  - The PUT request IS dispatched to the backend

Step 4: .then(() => queryClient.invalidateQueries(['visitors', clientId]))
  - Cache is marked stale → React Query refetches GET /api/v1/clients/{clientId}/visitors
  - BUT: the PUT may not have been committed by the backend yet
  - → refetch returns STALE data (old visitor name)
  - → React Query cache updated with stale data

Step 5: useRecordData sees new query data → re-derives visitorsMap
  - RecordVisitsTable re-renders with new `visits` prop
  - InlineEditCell gets new `value` prop = visitor?.name = stale "Анна"

Step 6: InlineEditCell's useEffect fires:
  useEffect(() => {
    setDraft(value);               // ← draft reset to "Анна"
    originalRef.current = value;   // ← originalRef reset to "Анна"
  }, [value]);

  → Both draft AND originalRef are now the stale server value.
  → The commit is effectively erased.

Step 7: Test's explicit el.blur() fires a second commitIfChanged
  - draft ("Анна") === originalRef.current ("Анна") → no-op
  - No PUT is sent during the test's waitForRequest window
  → TimeoutError
```

### Why new rows don't have this problem

For **new** visit rows, the `InlineEditCell` `value` prop is sourced from local form state (`formState.name`) managed by `useInlineEditRow`, not from the server-cached `visitorsMap`. The row-level `triggerSave` flow doesn't mutate the `value` prop mid-commit.

### Why the PUT IS actually sent (but the test doesn't see it)

The DB shows the visitor's `updated_at` advancing — the PUT does fire on step 3. But `page.waitForRequest()` starts listening only after `nameInput.press('Enter')` returns. The PUT was already dispatched during the `press('Enter')` action. The test's listener misses it.

---

## 4. The `useEffect([value])` design defect

```tsx
// InlineEditCell.tsx:25-28
useEffect(() => {
  setDraft(value);
  originalRef.current = value;
}, [value]);
```

This effect **unconditionally treats every `value` prop change as authoritative**, including those triggered by the component's own `onCommit` → invalidation → re-render cycle. There is no distinction between:

- **(a) External** value changes (server data refresh, navigation) — should sync
- **(b) Self-induced** value changes (own `onCommit` → invalidation → stale refetch) — should NOT sync

This is a production bug: a real user who edits a visitor name and blurs will see their edit silently reverted if any refetch returns stale data (e.g., slow server, concurrent edits, invalidated query).

---

## 5. The mutation cache bypass anti-pattern

### What's wrong

`updateVisitor` is a plain async function that calls `fetch(PUT)` outside React Query's mutation system:
- React Query does not know about the mutation
- The PUT response (which is the updated visitor) is **discarded**
- Cache sync relies on `invalidateQueries` → refetch, not `setQueryData` → direct cache write

### Why this causes a race

```
PUT fires ──→ backend starts processing
                     │
invalidateQueries fires ──→ GET fires ──→ returns data BEFORE PUT committed
                     │                          │
                     │                     cache = stale data
                     │                          │
                     │                  useEffect([value]) → overwrites state
                     │
                     └──→ PUT committed (too late, cache already stale)
```

### What the correct pattern looks like

```tsx
const useUpdateVisitor = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; data: VisitorUpdate }) =>
      updateVisitor(vars.id, vars.data),
    onSuccess: (data, vars) => {
      // Write the mutation response DIRECTLY to cache — no refetch needed
      queryClient.setQueryData(['visitors', vars.clientId], (old: VisitorResponse[]) => {
        return old.map(v => v.id === data.id ? data : v);
      });
    },
  });
};
```

With `setQueryData`:
- The response of the PUT is written to cache immediately
- No `invalidateQueries` → no refetch → no race
- React Query's `isLoading`/`isError` state is available for UI feedback

---

## 6. Scale of the problem

The anti-pattern is not isolated to `updateVisitor`. A full audit of `endpoints.ts` and all call sites found:

| Category | Count |
|----------|-------|
| `useMutation` wrappers (correct) | 28 |
| Direct `api()` + `invalidateQueries` (race-prone) | **10** |
| Direct `api()` + `setQueryData` (low risk, still outside useMutation) | 4 |
| Direct `api()` + no cache sync (stale cache) | **4** |

### Affected functions (no `useMutation` wrapper exists)

| Function | Method | Race risk | Cache sync |
|----------|--------|-----------|------------|
| `updateVisitor` | PUT | **high** | `invalidateQueries` only |
| `createVisitor` | POST | **high** | `invalidateQueries` only |
| `deleteVisitor` | DELETE | **high** | `invalidateQueries` only |
| `updateVisitStatus` | PUT | **high** | `invalidateQueries` only |
| `createRecord` | POST | **high** | `invalidateQueries` only |
| `patchRecord` | PATCH | **high** | `invalidateQueries` only |
| `deleteRecord` | DELETE | medium | `setQueriesData` (filter) + invalidate |
| `createPayment` | POST | medium | `setQueryData` + invalidate |
| `deletePayment` | DELETE | medium | `setQueryData` + invalidate |
| `patchPayment` | PATCH | low | `setQueryData` only |
| `createVisit` | POST | medium | `setQueryData` + invalidate |
| `patchVisit` | PATCH | low | `setQueryData` only |
| `deleteVisit` | DELETE | low | `setQueryData` only |
| `reorderMasters` | PUT | **high** | none |
| `reorderLocations` | PUT | **high** | none |

### Affected files

| File | Direct calls | Pattern |
|------|--------------|---------|
| `app/hooks/useRecordMutations.ts` | 15 functions | Largest cluster — all bypass `useMutation` |
| `app/components/modal/ActivityDetailsModal/ClientTab.tsx` | `updateVisitor` | bypass + invalidate |
| `app/(main)/clients/components/ClientRecordTab.tsx` | `updateVisitor`, `patchActivity` | bypass + invalidate |
| `app/(main)/clients/components/ClientInfoTab.tsx` | `createVisitor`, `deleteVisitor` | bypass, local state refetch |
| `app/hooks/useColumnReorder.ts` | `reorderMasters`, `reorderLocations` | fire-and-forget, no sync |

### Entities already using the correct pattern (useMutation + setQueryData)

- Masters (create/update/delete)
- Locations (create/update/delete)
- Services (create/update/delete)
- Tags (create/update/delete)
- Photos (create/update/delete)
- Materials (create/update/delete)
- Clients (create/update/delete/patch — via ClientsContext)
- Activities (create/delete/patch — via ScheduleContext)

### Entities bypassing useMutation

- **Records** (create/patch/delete)
- **Visitors** (create/update/delete)
- **Visits** (create/patch/delete + status update)
- **Payments** (create/patch/delete — partially uses setQueryData, but still outside useMutation)
- **Reorder** (masters/locations)

---

## 7. Proposed fix direction

### Option A: Fix only `updateVisitor` (minimal scope)

Create `useUpdateVisitor` hook with `useMutation` + `setQueryData`. Replace direct `updateVisitor()` calls in `ClientTab.tsx` and `ClientRecordTab.tsx`. Fix `routeState` race in InlineEditCell. Other bypass instances remain as separate technical debt.

### Option B: Fix the entire record/visit/visitor/payment cluster (large scope)

Migrate all 15 functions in `useRecordMutations.ts` to `useMutation` + `setQueryData`. Eliminate the class of bugs. But: large refactor, higher risk, more review needed.

### Option C: Fix `updateVisitor` + guard InlineEditCell useEffect (medium scope)

1. Create `useUpdateVisitor` with `useMutation` + `setQueryData` — eliminates the stale refetch race.
2. Also guard the `useEffect([value])` in InlineEditCell to not clobber state during an in-flight commit (e.g., `commitInFlightRef` flag set before `onCommit`, cleared after cache settles). Belt and suspenders.

### Open question for reviewer

**Is `useMutation` + `setQueryData` the right direction here, or is there a better approach?**

Specifically:
- Should we use `useMutation` + `onSuccess` with `setQueryData` (optimistic cache update from mutation response)?
- Or should we use `useMutation` + `onSuccess` with `invalidateQueries` (refetch after mutation)? This would still have the race if the refetch is fast.
- Or should we use optimistic updates (`onMutate` → `setQueryData` with rollback `onError`)?
- Or something else entirely?

Our current thinking: `setQueryData` from the mutation response is the correct approach because:
1. No refetch needed → no race window
2. The PUT response contains the full updated entity
3. It matches the pattern already used for masters, locations, services, etc.

But we want a second opinion before committing to a large refactor.