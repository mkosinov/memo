# InlineEditableTable — Unified Rows — Design

**Date:** 2026-06-25
**Status:** Approved (G1b passed 2026-07-05 — user confirmed written spec)
**Scope:** New shared `InlineEditableTable` + `useInlineEditRow` hook; refactor of `RecordVisitsTable` and `RecordPaymentsTable`
**Replaces:** Per-table `showForm` state + dedicated inline form-row (replicated 2×)

---

## Problem

Both `RecordVisitsTable` and `RecordPaymentsTable` re-implement the same "add row" pattern with `showForm` state and a parallel inline form-row:

- **`RecordVisitsTable.tsx`** (409 LOC): `useState(showForm)` at line 108; `+ Добавить` button in `TotalsRow` toggles it; the form-row (lines 276–368) is a hand-rolled duplicate of the data-row (lines 168–274) with its own `newName` / `newAge` / `newTariffId` / `newPrice` state.
- **`RecordPaymentsTable.tsx`** (215 LOC): same pattern, `useState(showForm)` at line 42, duplicate form-row at lines 113–184.

This causes:

1. **Duplication.** The form-row repeats the data-row's JSX (name/age/tariff/price cells, status picker, delete button) with minor variation. ~140 LOC of near-identical code per table.
2. **State desync risk.** Form-row state (`newName`, `newAge`, …) is independent from data-row state (rendered from `visits`/`payments`). After save, `setShowForm(false)` + `reset()` clears local state, but if the consumer forgets to invalidate, the data-row never appears.
3. **Inconsistency drift.** Form-row has its own `onKeyDown` for Enter (lines 286–298) and `onBlur` for save (lines 294–298), while data-row uses `InlineEditCell`'s `onCommit`. Two different save patterns for "add new" vs "edit existing".
4. **No reuse.** Future inline-editable tables (e.g., a new feature on the schedule page) would have to copy this pattern yet again.

The user-stated invariant: a "new" row should look and behave like an existing row, just with `id === null`. There is no separate "form mode".

---

## Goals

1. **One render path for all rows.** `RecordVisitRow` and `RecordPaymentRow` render data the same way regardless of whether `id === null` or `id !== null`. `InlineEditCell` shows a placeholder when the value is empty; no separate "add form" JSX.
2. **No `showForm` state.** The "+ Добавить" button appends `{ id: null, ...defaults }` to the consumer's `rows` array. Saving replaces the row in place (`{ id: null, ... }` → `{ id: 'v42', ... }` from API response). No close-then-reopen.
3. **Per-row state via `useInlineEditRow` hook.** Each row component owns its own form state (local `useState` for dirty values), save handler (POST vs PATCH by `isNew`), and delete handler (× for new rows = array splice, × for saved rows = API delete).
4. **Two consumers refactored.** `RecordVisitsTable` and `RecordPaymentsTable` consume the new shared components; both lose ~80 LOC of duplicated form JSX.
5. **No behavior regression.** All existing E2E and unit tests for the two tables must still pass (after their `data-testid` attributes are preserved — see Risks).

---

## Non-Goals

- Generic column-editing DSL (no JSON-schema-style cell definitions). Each table still owns its own column/cell render — the new hook only handles the save/delete orchestration and per-row dirty state.
- Optimistic updates. The current `invalidate-on-success` pattern in `useRecordMutations` stays; the refactor only changes the UI side.
- Inline-editing of `status` (the `StatusPicker` is a separate concern, already a shared component).
- Backend changes — this is a pure frontend refactor.
- New features for `/records` or `/services` pages — out of scope.

---

## Architecture

### New files

```
frontend/admin/app/components/shared/record/
├── InlineEditCell.tsx           # EXTRACT from RecordVisitsTable.tsx (lines 24–71); no behavior change
├── useInlineEditRow.ts          # NEW — per-row hook
└── InlineEditableTable.tsx      # NEW — generic table that renders rows + "+ Добавить" button
                                  # (optional; can be skipped if each consumer keeps its own RecordTable wrapper
                                  #  and just iterates rows uniformly. See Decision below.)
```

**Decision: skip `InlineEditableTable.tsx` for now.** The two existing consumers (`RecordVisitsTable`, `RecordPaymentsTable`) already use `RecordTable` from the same folder (which handles `Header`/`Row`/`TotalsRow`/`EmptyState`). The actual unification is in:
- `useInlineEditRow` (save/delete orchestration)
- A new `InlineEditRow` component (renders one row uniformly given a `renderCell` map)
- Consumers iterate `rows` and render `<InlineEditRow>` for each

The `InlineEditRow` component IS the "table" the user described — the abstraction is per-row, not at the table level. This matches their preference for option A (per-row hook) from the brainstorming discussion.

```
frontend/admin/app/components/shared/record/
├── InlineEditCell.tsx                # extracted, no change
├── InlineEditRow.tsx                 # NEW — renders one row (id === null OR id !== null)
├── useInlineEditRow.ts               # NEW — per-row hook
```

### Modified files

- `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx` — uses `InlineEditRow` + `useInlineEditRow`; drops `showForm` state and form-row JSX (lines 108–140, 276–368).
- `frontend/admin/app/components/shared/record/blocks/RecordPaymentsTable.tsx` — same refactor; drops `showForm` state and form-row JSX (lines 42–65, 113–184).

### Data model

```ts
// Visitor row (visits table)
type VisitRow = {
  id: string | null;          // null = new, not yet in backend
  name: string;               // '' renders "Аноним" placeholder
  age: number | null;         // null renders "Взрослый" placeholder
  tariff_id: string | null;   // null renders "— тариф —" placeholder
  price: number;              // 0 = unpriced
  status: VisitStatus;        // always present (default 'waiting' for new rows)
};

// Payment row (payments table)
type PaymentRow = {
  id: string | null;
  amount: number;
  method: string;
  created_at: string;
};
```

The `id === null` discriminator is the only thing that distinguishes "new" from "existing" — there's no `_source`, no `showForm`, no `isDraft`.

### Hook signature

```ts
// useInlineEditRow.ts
interface UseInlineEditRowOptions<T extends { id: string | null }, F> {
  row: T;
  emptyData: () => F;                           // factory for new row defaults
  pickFormData: (row: T) => F;                  // T → F (form fields only)
  onAdd: (data: F) => Promise<T>;               // POST; returns saved row with id
  onUpdate: (id: string, data: F) => Promise<T>;// PATCH; returns updated row
  onDelete: (id: string) => Promise<void>;      // DELETE (saved rows only)
  onRemove: (row: T) => void;                   // remove from consumer's array (new rows only)
}

function useInlineEditRow<T extends { id: string | null }, F>(
  opts: UseInlineEditRowOptions<T, F>
): {
  formState: F;                       // current local values
  isNew: boolean;                     // row.id === null
  handleChange: <K extends keyof F>(field: K, value: F[K]) => void;
  handleSave: () => Promise<void>;    // POST if isNew, PATCH otherwise
  handleDelete: () => Promise<void>;  // onRemove if isNew, onDelete otherwise
  reset: () => void;                  // reset formState to row's current values
}
```

### Component contract — `InlineEditRow`

```ts
interface InlineEditRowProps<T extends { id: string | null }, F> {
  row: T;
  testIdPrefix: string;            // e.g., 'visit-row' → testId='visit-row-{id|"new"}'
  renderCell: (params: {
    row: T;
    formState: F;
    isNew: boolean;
    handleChange: (field: keyof F, value: any) => void;
  }) => Record<string, React.ReactNode>;  // keyed by column key + '__actions'
  columns: Column[];
  onAdd: (data: F) => Promise<T>;
  onUpdate: (id: string, data: F) => Promise<T>;
  onDelete: (id: string) => Promise<void>;
  onRemove: (row: T) => void;
  emptyData: () => F;
  pickFormData: (row: T) => F;
  isReadOnly?: boolean;
}
```

`InlineEditRow` internally calls `useInlineEditRow` and renders the cells. The `__actions` cell always shows `×` (unless `isReadOnly`); × for new rows calls `handleDelete` (which is just `onRemove`), × for saved rows calls `handleDelete` (which is `onDelete`).

### Save flow

```
+ Добавить click
    → consumer appends { id: null, ...defaults } to rows
    → new InlineEditRow renders (autoFocus on Name input)

User types in Name, presses Enter
    → InlineEditRow's onKeyDown in name cell → handleSave()
    → useInlineEditRow checks isNew
        → isNew: await onAdd(formData)        # POST /visits
        → !isNew: await onUpdate(id, formData) # PATCH /visits/:id
    → consumer replaces row in array with API response (id set, real values)
    → row continues to render (now with id), no close/reopen

User types in Age, presses Enter
    → same handleSave path; for new row, hits POST with current formState

User clicks × on a new (unsaved) row
    → handleDelete() → onRemove(row)  # no API call
    → row removed from consumer's array

User clicks × on a saved row
    → handleDelete() → onDelete(row.id)  # DELETE /visits/:id
    → on success, consumer removes row from array
```

### Consumer pattern (RecordVisitsTable, simplified)

```tsx
export function RecordVisitsTable({ visits, tariffs, onAddVisitor, ... }: Props) {
  const [rows, setRows] = useState<VisitRow[]>(() =>
    visits.map(toVisitRow)
  );
  // Re-sync rows when visits prop changes (e.g., after refetch):
  useEffect(() => setRows(visits.map(toVisitRow)), [visits]);

  const handleAdd = useCallback(async (data: VisitFormData) => {
    const saved = await onAddVisitor(data);   // POST returns full row
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === null && isSameFormData(r, data));
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = toVisitRow(saved);
        return next;
      }
      return prev;
    });
  }, [onAddVisitor]);

  const handleUpdate = useCallback(async (id: string, data: VisitFormData) => {
    const updated = await onChangeVisit(id, data);  // PATCH returns full row
    setRows((prev) => prev.map((r) => (r.id === id ? toVisitRow(updated) : r)));
  }, [onChangeVisit]);

  const handleDelete = useCallback(async (id: string) => {
    await onDeleteVisit(id);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, [onDeleteVisit]);

  const handleRemove = useCallback((row: VisitRow) => {
    setRows((prev) => prev.filter((r) => r !== row));
  }, []);

  const handleAddClick = useCallback(() => {
    setRows((prev) => [...prev, makeEmptyVisitRow(tariffs)]);
  }, [tariffs]);

  return (
    <RecordTable testId="record-visits-table">
      {(rows.length > 0) && <RecordTable.Header columns={VISIT_COLUMNS} isReadOnly={isReadOnly} />}
      {rows.map((row) => (
        <InlineEditRow
          key={row.id ?? '__new_' + rows.indexOf(row)}   // see Risks: key stability
          row={row}
          testIdPrefix="visit-row"
          columns={VISIT_COLUMNS}
          renderCell={visitCellRenderer /* inline-defined, knows tariffs/visitorsMap */ }
          onAdd={handleAdd}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onRemove={handleRemove}
          emptyData={() => makeEmptyVisitFormData(tariffs)}
          pickFormData={pickVisitFormData}
          isReadOnly={isReadOnly}
        />
      ))}
      {!isReadOnly && (
        <RecordTable.TotalsRow ... >
          <button onClick={handleAddClick} data-testid="btn-add-visitor">+ Добавить</button>
        </RecordTable.TotalsRow>
      )}
    </RecordTable>
  );
}
```

---

## User Scenarios

> Each scenario maps to a Playwright E2E test (per testing-strategy-v2 / User Scenario workflow).

1. **+ Добавить → empty row with placeholders.** Admin opens `ActivityDetailsModal` → "записи клиента" tab → clicks "+ Добавить" → a new row appears at the bottom with `Name=""` (placeholder "Аноним"), `Age=null` (placeholder "Взрослый"), `Tariff` = "— тариф —", `Price=0`. Cursor auto-focused in Name input. Covers: `handleAddClick` → appends empty row → `InlineEditRow` renders with `isNew=true`.

2. **Enter in Name on new row → POST + row gets id (no blink).** Continuing from scenario 1 → admin types "Анна" and presses Enter → API call `POST /visits` succeeds → the row in the table now shows `id='v42'` (testid becomes `visit-row-v42`), `name='Анна'` (the empty input now shows "Анна"), no form close/reopen, no blink. The cursor is gone (the row is no longer in "new" state). Covers: `handleSave` → `onAdd` → consumer replaces row in array.

3. **Multiple empty rows allowed.** Admin clicks "+ Добавить" twice in a row without filling either → two new empty rows appear, both with placeholders. Filling the first one (Enter) only saves the first; the second remains empty. Covers: `handleAddClick` does not check for existing empty rows.

4. **× on unsaved row → removed, no API call.** Admin clicks "+ Добавить" → empty row appears → admin clicks × on that row → row disappears, no network request to `POST` or `DELETE` was made (verifiable via network log). Covers: `handleDelete` for `isNew=true` → `onRemove`.

5. **Edit existing visitor name → PATCH.** Admin edits the Name input on an existing visit (with `id='v12'`) → presses Enter or blurs → `PATCH /visits/v12` is called → on success, the row's name updates from server response. Covers: `handleSave` for `isNew=false` → `onUpdate`.

6. **Select tariff → price auto-fills.** Admin on a new row selects a tariff from the dropdown → the `Price` cell auto-fills with `tariff.price` (e.g., 3500). Covers: the cell renderer's `onChange` for tariff calls `handleChange('price', tariff.price)` synchronously, in addition to `handleChange('tariff_id', id)`.

7. **× on existing row → DELETE.** Admin clicks × on a saved visit → `DELETE /visits/:id` is called → on success, the row is removed from the table. The "Итого" total decreases. Covers: `handleDelete` for `isNew=false` → `onDelete`.

8. **Visitor count "0" and `+ Добавить` still works.** Admin opens a record with 0 visits → no rows, but `+ Добавить` button is still visible in `TotalsRow` → clicking it works. (This guards against a regression where the empty state hides the TotalsRow.) Covers: `TotalsRow` rendered regardless of `rows.length`.

9. **`payments` table uses the same pattern.** All 7 scenarios above have a parallel payment-table implementation, verified by the same Playwright suite running on the payments block. Covers: the shared abstraction is actually reused, not duplicated.

---

## Implementation phases (for writing-plans)

This is one focused refactor; the plan must split it into independent, testable sub-tasks.

### Phase 0 — Extract `InlineEditCell`

- T0. Move `InlineEditCell` from `RecordVisitsTable.tsx` (lines 24–71) to `frontend/admin/app/components/shared/record/InlineEditCell.tsx`. No behavior change.
- T1. Add `frontend/admin/app/components/shared/record/__tests__/InlineEditCell.test.tsx` with 4 vitest cases:
  - renders value
  - placeholder shown when value is empty
  - Enter triggers onCommit
  - Escape reverts to original
- T2. Update `RecordVisitsTable.tsx` import to the new path. Run vitest — must stay green.

### Phase 1 — Build `useInlineEditRow` + `InlineEditRow`

- T3. `frontend/admin/app/components/shared/record/useInlineEditRow.ts` — implement the hook as specified above. Generic over `<T extends { id: string | null }, F>`.
- T4. `frontend/admin/app/components/shared/record/__tests__/useInlineEditRow.test.tsx` with 6 cases:
  - `isNew=true` when `row.id === null`
  - `handleSave` calls `onAdd` (not `onUpdate`) when `isNew`
  - `handleSave` calls `onUpdate(id, ...)` when `!isNew`
  - `handleDelete` calls `onRemove` (no API) when `isNew`
  - `handleDelete` calls `onDelete(id)` when `!isNew`
  - `reset()` restores `formState` to `pickFormData(row)`
- T5. `frontend/admin/app/components/shared/record/InlineEditRow.tsx` — renders one row uniformly. Internally calls `useInlineEditRow`. The `renderCell` prop receives `{ row, formState, isNew, handleChange }` and returns a `Record<string, ReactNode>`. Auto-focuses Name input when `isNew`.
- T6. `frontend/admin/app/components/shared/record/__tests__/InlineEditRow.test.tsx` with 3 cases:
  - renders both `isNew` and saved rows with the same `renderCell` output (no different JSX)
  - × button calls `handleDelete`
  - Name input has `autoFocus` only when `isNew`

### Phase 2 — Refactor `RecordVisitsTable`

- T7. Rewrite `RecordVisitsTable.tsx` to:
  - Own `rows: VisitRow[]` state (replaces `showForm`, `newName`, `newAge`, `newTariffId`, `newPrice` state).
  - Use `useEffect` to re-sync `rows` when `visits` prop changes.
  - Map over `rows` and render `<InlineEditRow>` for each.
  - `+ Добавить` button appends an empty `VisitRow` (with `id: null`, default `tariff_id` = `tariffs[0]?.id ?? null`, default `price` = `tariffs[0]?.price ?? 0`).
  - `handleSave` is the per-row `onAdd` (POST) or `onUpdate` (PATCH) callback — the consumer updates `rows` in place on success.
  - `handleDelete` for new rows = splice from `rows`; for saved rows = call `onDeleteVisit` then splice.
- T8. Update existing `ClientRecordTab.interactions.test.tsx` if any `data-testid` selectors need adjustment (e.g., `add-visitor-name` is gone — replaced by per-row `visit-row-new-name`). Add a small "shim" if necessary to preserve the most important testids.
- T9. Run vitest for `RecordVisitsTable` and `ClientRecordTab` — must stay green.

### Phase 3 — Refactor `RecordPaymentsTable`

- T10. Same refactor as Phase 2, applied to `RecordPaymentsTable.tsx`. New `PaymentRow` type, new empty-row factory, `useInlineEditRow` for save/delete.
- T11. Update tests. Run vitest.

### Phase 4 — End-to-end verification

- T12. Add Playwright E2E tests for all 9 user scenarios above.
- T13. Visual regression: visit-row snapshots match before/after refactor.
- T14. `pytest-patterns` review: not applicable (frontend-only).
- T15. `vitest-playwright-patterns` review: scenario tests use Full Cycle pattern.

### Acceptance gates

- Phase 0 → 1: `InlineEditCell` extracted, vitest green, no behavior change.
- Phase 1 → 2: `useInlineEditRow` and `InlineEditRow` pass their own unit tests; ready for consumer refactor.
- Phase 2 → 3: `RecordVisitsTable` passes its existing tests after refactor (with shimmed testids if needed).
- Phase 3 → 4: `RecordPaymentsTable` passes its existing tests after refactor.
- Phase 4 → done: all 9 user scenarios green in E2E, visual regression clean.

---

## Visual Compliance Checks

> These checks feed the automated Visual Compliance Gate (Step 4.5 of the workflow).

- [ ] "Посетители" header is visible above the visits table.
- [ ] Column header row (Имя / Возраст / Тариф / Стоимость) is visible when there is at least one visit OR a new empty row.
- [ ] "+ Добавить" button is visible in the TotalsRow when `!isReadOnly`.
- [ ] Clicking "+ Добавить" appends a new row with empty Name (showing "Аноним" placeholder) and "Взрослый" placeholder for Age.
- [ ] The new empty row's Name input has visible `autoFocus` (cursor in the field).
- [ ] The new empty row's Tariff dropdown shows "— тариф —" as the default selected option.
- [ ] Pressing Enter in a new row's Name input triggers the save (POST) and the row stays in place with the API response data populated.
- [ ] After save, the row's `data-testid` changes from `visit-row-new` to `visit-row-{id}` (e.g., `visit-row-v42`).
- [ ] × button on a new (unsaved) row removes it from the table without an API call.
- [ ] × button on a saved row calls DELETE and removes the row on success.
- [ ] Multiple new empty rows can coexist (clicking "+ Добавить" twice while neither is filled).
- [ ] For payments table, parallel "Оплаты" / "Метод" / "Сумма" / "+ Добавить" / × / auto-fill behavior is verified by the same checks.

---

## Risks

### Key stability for new rows

React requires stable `key` props for arrays. New rows have `id === null`, so we cannot use `id` as the key. Options:

- Use the array index: `key={rows.indexOf(row)}` — works but causes re-mount when a row is removed/inserted before this one, losing focus state in the still-empty row. **Bad.**
- Generate a UUID at row creation: `key={row.clientId}` — stable, but adds a non-API field to the row type. Acceptable if we strip it before send.
- Use a WeakMap / `useId` per row — non-trivial.

**Decision: add a transient `clientId: string` (UUID) to the row at creation, use it as the React key, strip it before POST.** This is a common pattern and matches what the `onAdd`/`onUpdate` consumer will use to identify the row being replaced.

### Existing tests with `data-testid="add-visitor-name"` etc.

The current tests select the add-form inputs by `data-testid="add-visitor-name"`. After the refactor, the input is inside a row keyed by `clientId`, with `data-testid="visit-row-{clientId}-name"`. Two options:

- **Shim approach (recommended for this refactor):** in the renderCell for Name, when `isNew`, also set `data-testid="add-visitor-name"` so existing tests keep working. This is a one-line shim.
- **Rewrite tests:** update all selectors. More thorough but more work.

**Decision: shim approach for this refactor. New tests use the `visit-row-{id}` pattern; old tests keep working via the shim. Track test cleanup as a follow-up.**

### `InlineEditRow` is not literally a `<RecordTable.Row>`

The existing `RecordTable.Row` API takes `cells: Record<string, ReactNode>`. The new `InlineEditRow` is a higher-level component that wraps `RecordTable.Row` internally and passes the per-cell render output. This adds one layer but keeps `RecordTable.Row` itself untouched (which is a deliberately generic primitive). Documented in T5.

### Backward compat: existing `InlineEditCell` import paths

After extraction, `RecordVisitsTable.tsx` no longer defines `InlineEditCell` locally. Any other consumer of the local version (grep for `InlineEditCell` in the repo) must be updated. A grep pre-check (T0 prep) catches this.

### Save-callback contract — RESOLVED (Variant A, 2026-07-05)

**Investigation result (2026-07-05):** The current `useRecordMutations` hook is **invalidate-on-success** and returns `void`. Visits are mutated via bulk `patchRecord(visits[])`, NOT via single-visit endpoints. Payment PATCH is not wired in at all.

**However**, the backend now exposes the correct single-entity endpoints (added by Phase 0-2, all merged into main at `f6a765a`):
- `POST /api/v1/visits` → returns `VisitResponse`
- `PATCH /api/v1/visits/{id}` → returns `VisitResponse` (single-visit partial update)
- `DELETE /api/v1/visits/{id}` → 204
- `PATCH /api/v1/payments/{id}` → returns `PaymentResponse`

The api-client wrappers for these either exist (`updateVisitStatus`, `createPayment`, `deletePayment`, `updatePayment`) or must be added (single-visit `createVisit`/`patchVisit`/`deleteVisit`).

**Decision (user, 2026-07-05): Variant A — wire the new single-entity endpoints into `useRecordMutations` so that add/update mutations RETURN the saved/updated row.** This enables true replace-in-place (no blink), eliminates the bulk `patchRecord(visits[])` technical debt, and uses exactly the endpoints the Phase 0-2 backend work was built for.

**Contract after refactor:**
- `onAdd(data): Promise<VisitResponse>` → calls `createVisitor` (if new visitor) + `POST /visits`, returns the saved `VisitResponse`.
- `onUpdate(id, data): Promise<VisitResponse>` → calls `PATCH /visits/{id}`, returns the updated `VisitResponse`.
- `onDelete(id): Promise<void>` → calls `DELETE /visits/{id}`.
- Payments: `onAdd → POST /payments` returns `PaymentResponse`; `onUpdate → PATCH /payments/{id}` returns `PaymentResponse`; `onDelete → DELETE /payments/{id}`.
- Consumer replaces the `{ id: null, ... }` row in the `rows` array with the returned saved row (id populated). No full-list invalidation needed for the row itself, though a lightweight `['record', recordId]` invalidation may still run to keep totals/seats in sync (cascade recompute happens backend-side per Phase 1).

**Note on the visit/visitor two-step:** "Add visitor" remains a two-step flow (create `Visitor` → create `Visit` referencing `visitor_id`), because a Visit references a Visitor. The refactor changes the second step from bulk `patchRecord` to single `POST /visits`, and makes it return the created `VisitResponse`.

---

## Addendum — New-row save trigger + editable payment date (2026-07-06)

Discovered during live testing after the initial refactor shipped. Two corrections to the new-row UX.

### A. New-row save must fire on blur/Enter regardless of whether a field changed

**Problem (regression vs the original "Save flow" section above):** the initial implementation hard-wired the POST inside a single cell's `InlineEditCell.onCommit` (payments → Amount, visits → Name). `InlineEditCell` only fires `onCommit` when the draft value **changed** (`draft !== original`). This is correct for editing an existing cell (PATCH), but WRONG for creating a new row:

- **Payments (frequent):** a new payment row is pre-filled with `defaultAmount` = "К оплате" (outstanding balance). Accepting that amount verbatim and pressing Enter / blurring does NOT save it, because the value never changed. The user cannot save the exact owed amount without editing it.
- **Visits (narrow):** a new visit row's Name starts empty; typing a name registers as a change and saves. But an **anonymous visit** (blank name = "Аноним" placeholder, only a tariff picked) never fires the Name `onCommit` → cannot be saved.

**Required behavior:** for a NEW row (`id === null`), committing the row (blur leaving the row, or Enter on any editable field) MUST trigger `onAdd` **regardless of whether any individual field changed**, as long as the row is valid (see B). This matches the ORIGINAL "Save flow" section (`handleSave()` on Enter), which the implementation drifted away from.

**Design:** wire the already-existing but currently-dead `useInlineEditRow.handleSave` into the save path:
- `InlineEditRow` consumes `handleSave` from the hook and provides a row-level save trigger: on **Enter** in any cell, and on **blur leaving the whole row** (focus moves outside the row), call `handleSave()` when `isNew`.
- `handleSave` calls `onAdd(formState)` for new rows (unconditional — not gated on field change).
- Both tables DROP the duplicated `handleAdd(...).then(replaceRowByClientId)` from their per-cell `onCommit`; new-row saving converges on the single `handleSave` path. (For SAVED rows, per-cell PATCH-on-change via `InlineEditCell.onCommit` stays as-is — change-gating is correct there.)
- This retires the dead `handleSave`/`onUpdate` code flagged in the Task 4.1/5.1 reviews.

### A.1. Replace-in-place must preserve the just-submitted values (name blanks after save bug)

**Problem (live-testing bug):** after saving a new visitor (type name → Enter), the name input goes BLANK (shows "Аноним" placeholder), yet after F5 the name displays correctly. Root cause (traced):
- `addVisit` returns a `VisitResponse` that has NO `name` (only `visitor_id`); the created visitor's name is discarded.
- `visitResponseToRow(saved, visitorsMap)` re-derives the row's `name`/`age` by looking up `visitorsMap[visitor_id]`, but the invalidation refetch hasn't completed, so `visitorsMap` is a **stale closure** without the new visitor → `name` resolves to `''`.
- The row's `id` goes `null → real`, changing the React `key` (`row.id ?? clientId`) → the row **remounts** → `formState` re-inits from the blank-name row → input shows blank.

**Required fix:** when replacing the `{id:null}` row with the saved row, **preserve the values the user just submitted** rather than re-deriving them from a not-yet-refreshed `visitorsMap`. E.g. `replaceRowByClientId(clientId, { ...visitResponseToRow(saved, visitorsMap), name: submittedName, age: submittedAge })`. Equivalent hardening options: have `addVisit` return the created visitor's name/age, or make `visitResponseToRow` fall back to the submitted values on a `visitorsMap` miss.

**Apply the same principle to payments:** after saving a new payment, the replaced row must show the submitted amount/method (and the date — see B), not blank/placeholder, without waiting for refetch.

**Acceptance:** after Enter on a new visitor row, the name stays visible immediately (no blank, no need to F5). Same for a new payment row's amount/method/date.

**Guard (amount > 0 for payments):** restore the explicit validation lost in the refactor.

- The check `amount > 0` applies to BOTH save paths: creating a new payment (POST) AND editing an existing payment's amount (PATCH). If the admin clears an existing payment's amount to 0, the guard must also fire (backend enforces `gt=0` → would 422 otherwise).
- **On `amount <= 0`:** show an **error toast** ("Сумма должна быть больше 0") and DO NOT send the request (no POST, no PATCH). Use the project's standard toast mechanism (error contract / `waitForToast`-compatible `role="status"` toast).
- The Amount `<input type="number">` also keeps `min={1}` as a browser-level input hint, but the authoritative guard is the explicit `amount > 0` check in code (min alone does not prevent clearing the field to empty/0).
- For visits, a blank-name anonymous row IS valid and must save (name is optional; visitor is created "Аноним"). No amount guard applies to visits.

### B. Editable payment date on new rows (auto-filled, user-adjustable)

**Problem:** the old form had a `datetime-local` input auto-filled with the current time; the refactor dropped it, so a new payment row shows a blank Date cell until saved, and the user cannot set/backdate the payment time.

**Required behavior:**
- A new payment row's Date cell renders an **editable `datetime-local` input**, auto-filled with the current time (`new Date()`) at row creation.
- The user may adjust it before saving.
- The chosen date is sent to the backend and persisted as the payment's `created_at`.

**Backend change (new — supersedes the "no backend changes" note):** `POST /api/v1/payments` must accept an optional client-supplied timestamp so the UI-entered date is persisted:
- Add an optional field to `PaymentCreate` (e.g. `created_at: datetime | None = None`, or a dedicated `paid_at`). When provided, the service sets the payment's timestamp to it; when omitted, the DB default (now) applies.
- Thread it through: frontend `addPayment(amount, method, date?)` → `createPayment` payload → `PaymentCreate`.
- Keep it backward-compatible (optional; existing callers that omit it are unaffected).

### New user scenarios (extend the list above)

10. **Save prefilled payment without editing.** New payment row prefilled with "К оплате" = 6000 → user presses Enter (or blurs) WITHOUT changing the amount → payment is saved with amount 6000. (Currently broken.)
11. **Save anonymous visit.** New visit row → user picks only a tariff, leaves Name blank → blur/Enter → an anonymous ("Аноним") visit is saved. (Currently broken.)
12. **amount ≤ 0 not sent (new + existing).** (a) New payment row → user clears amount to 0 → blur/Enter → NO POST fires; an error toast "Сумма должна быть больше 0" is shown; no 422. (b) Existing payment row → admin edits amount to 0 → blur → NO PATCH fires; same error toast; the row keeps its previous amount.
13. **Editable payment date persists.** New payment row shows current time in an editable datetime input → user adjusts it → saves → the payment's `created_at` reflects the user-entered time (verified via GET).

14. **Name stays visible immediately after save (no blank, no F5).** New visitor row → type "Анна" → Enter → the row is saved AND the name "Анна" remains displayed in the row immediately (input does NOT blank to the "Аноним" placeholder). No page reload needed. (Currently: name blanks after Enter and only reappears after F5.) Same for a new payment's amount/method/date after save.

---

## Addendum 2 — Cache sync, tariffs in modal, hard-delete + Undo (2026-07-06, live-test round 2)

Three more bugs found in live testing, plus an architectural decision on delete semantics.

### C. Mutation cache sync — no F5 needed after add/delete (regression + design gap)

**Problem:** after adding or deleting a visitor/payment, switching tabs inside the modal (or closing+reopening it) causes the table to remount and re-initialize from a STALE `['record', recordId]` cache — the just-added row vanishes / the just-deleted row reappears, until F5.

**Root cause (traced):**
- The new single-entity mutations (`addVisit`/`deleteVisit`/`patchVisit`/payment equivalents) only call `invalidateRecord()` (marks `['record', recordId]` stale → BACKGROUND refetch). They do NOT optimistically update the cache. If the table remounts before the refetch completes, it reads stale data.
- **Regression:** `addVisit` no longer invalidates `['visitors', clientId]` (the old `handleAddVisitor` did — `ClientRecordTab.tsx`). So even after the record refetch, `visitorsMap` is stale and the new visitor's name can't be joined.

**Required fix (hybrid — optimistic cache write now; full useMutation refactor deferred):**
- In `addVisit`/`deleteVisit`/`patchVisit` (and `addPayment`/`deletePayment`/`patchPayment`), OPTIMISTICALLY update the React Query cache BEFORE/AROUND the API call: `queryClient.setQueryData(['record', recordId], (old) => ...)` to add/remove/update the visit in `old.visits` (and `['payments', recordId]` for payments), so any remount reads fresh data immediately.
- Restore `queryClient.invalidateQueries({ queryKey: ['visitors', clientId] })` in `addVisit` (regression fix).
- Keep `invalidateRecord()` (and existing invalidations) as the server-confirmation pass.
- **Deferred (separate tech-debt PR):** migrating these mutations to `useMutation` with `onMutate` optimistic + rollback. This addendum does the minimal `setQueryData` fix.

### D. Tariff dropdown empty in the modal (pre-existing)

**Problem:** in the ActivityDetailsModal → client tab → visitors table, the Tariff `<select>` for a new row is empty (only "— тариф —"), even though the service has tariffs. (The /clients-page `ClientRecordTab` is NOT affected — it fetches raw services with tariffs.)

**Root cause:** `useServices()` applies `select: transformService`, and `transformService` (`transformers.ts`) DROPS the `tariffs` field (keeps only `defaultAdultPrice`). The domain `Service` type has no `tariffs`. `ActivityDetailsModal.getServiceTariffs(svc)` reads `svc.tariffs` → `undefined` → `[]`.

**Required fix:** make the modal receive the service's tariffs. Preferred: in `ActivityDetailsModal`, obtain the raw service (with tariffs) — either use the raw services already fetched in `useSchedule()`/`ScheduleContext` (expose `servicesRaw`), or add a dedicated raw `useQuery(['services'])` (no `select`) for tariff lookup. Do NOT break the domain `Service` transform used elsewhere. Document the chosen approach. **Acceptance:** the Tariff dropdown in the modal shows the service's tariffs; selecting one auto-fills price (scenario 6 already covered).

### E. Delete semantics: HARD delete Payment + Visit + Undo toast

**Decision (user, 2026-07-06):** Payment and Visit switch from soft-delete to **HARD delete** (physical row removal). Rationale: they are leaf tables (no FK references), operational (not primary financial records), and soft-delete caused deleted payments to still count in client stats (bug 3) + imposes a permanent "remember to filter is_active" tax. Audit trail, if ever needed, belongs in a separate append-only `audit_log` — NOT soft-delete on the entity. All OTHER entities (Client, Service, Master, Location, Activity, Record, Visitor, ...) KEEP soft-delete (they have FK dependents).

**Safety (verified):** nothing references Payment.id/Visit.id as FK; Visit "cancelled" is a STATUS (is_active=true), not a delete, so cancelled history is safe; `recompute_record_seats/status` filter `is_active=True` so a gone row behaves identically to a soft-deleted one — the parent Record's seats/status recompute correctly.

**Required implementation:**
- **Backend (per-service override — do NOT touch the generic soft-delete):**
  - `PaymentService.delete`: physical `DELETE FROM payments WHERE id=? AND is_active=True`; return False (→ 404) if no row matched (preserve the API contract).
  - `VisitService.delete`: change the `is_active=False` set to a physical row delete; KEEP the two recompute calls afterward (they already work with the row gone).
  - Fix bug 3 as a natural consequence + also add `Payment.is_active`/`Visit.is_active` filters to the client-stats subqueries (`client.py`) as defense (though hard-delete makes deleted rows vanish anyway — add the filter so any FUTURE soft-deleted-by-mistake row isn't counted).
  - Update tests: `test_delete_payment_soft_deletes` → expect 404 after delete; `test_delete_visit_soft_flag_in_db` / `test_visit_service_delete_*` → expect row absent.
- **Frontend Undo toast (deferred delete pattern — no soft-delete needed):**
  - Clicking × on a SAVED visit/payment row: remove the row from the UI immediately, show a toast "Удалено. Отменить" for ~5 seconds. Do NOT send the DELETE immediately.
  - If the user clicks "Отменить" within 5s → restore the row in the UI; NO server call was made.
  - If 5s elapse with no undo → send the hard `DELETE`.
  - Use the project's toast mechanism (`useUI`) with an action button. (If `useUI` toasts don't support an action button, extend minimally or use the smallest viable approach; document it.)
  - Deleting a NEW (unsaved, id===null) row stays instant (no toast, no server call — it was never saved).

### New user scenarios (extend the list)

15. **No F5 after add.** Add a visitor → switch to "Настройки" tab and back → the visitor is still there (no reload). Same for payments.
16. **No F5 after delete.** Delete a visitor → switch tab and back → the visitor is still gone (does not reappear). Same for payments.
17. **Tariff dropdown populated in modal.** Open a record in the ActivityDetailsModal → visitors → "+ Добавить" → the Tariff dropdown lists the service's tariffs; selecting one fills the price.
18. **Hard delete removes from stats.** Delete a payment → the client's `total_paid` no longer includes it (backend, no F5-dependent). The payment is physically gone (GET by id → 404).
19. **Undo delete.** Click × on a saved payment → row disappears + toast "Удалено. Отменить" → click "Отменить" within 5s → the payment reappears, and NO delete was sent to the server (verify via network). If not undone within 5s → the payment is hard-deleted.

---

## Out of scope (deferred)

- Inline-editing of the `status` field for a new row (it always defaults to `'waiting'`; admin changes it after save).
- Optimistic updates (the wave 6 record-status spec deferred this too; same line).
- A true generic `InlineEditableTable<T>` that takes column DSL — explicitly non-goal.
- Backend changes: the core refactor required none (endpoints existed from Phase 0-2). **Exception:** the Addendum (B) adds ONE small backend change — an optional client-supplied timestamp on `POST /api/v1/payments` so a user-entered payment date persists.

---

## Open questions for user (none blocking)

None — all design decisions are made. The `tariff_id` placeholder value (`tariffs[0]?.id ?? null`) and the `defaultAmount` flow for payments (carry-over from `RecordPaymentsTable`'s `defaultAmount` prop) are spelled out above. The `clientId` shim and testid shim are documented in Risks.
