# InlineEditableTable — Unified Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `RecordVisitsTable` and `RecordPaymentsTable` so a "new" row is just a row with `id === null` (no `showForm` state, no duplicated form-row JSX), backed by a shared `useInlineEditRow` hook + `InlineEditRow` component, and wire the frontend to the single-entity backend endpoints so add/update mutations return the saved row (replace-in-place, no blink).

**Architecture:** Bottom-up. First wire the api-client + `useRecordMutations` to the single-entity `POST/PATCH/DELETE /visits` and `PATCH /payments` endpoints (which already exist backend-side from Phase 0-2) so mutations RETURN the saved row. Then extract `InlineEditCell`, build the `useInlineEditRow` hook + `InlineEditRow` component, then refactor the two consumer tables, then E2E + docs.

**Tech Stack:** Next.js 14 (App Router), TypeScript, React Query (`@tanstack/react-query`), Zod (`@memo/api-client`), vitest + @testing-library/react, Playwright.

**Spec:** `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` (Approved, G1b 2026-07-05; save-callback contract resolved = Variant A).

---

## File Structure

### New files
| Path | Responsibility |
|------|----------------|
| `frontend/admin/app/components/shared/record/InlineEditCell.tsx` | Extracted inline-edit text cell (from `RecordVisitsTable`). No behavior change. |
| `frontend/admin/app/components/shared/record/InlineEditCell.test.tsx` | Unit tests for the extracted cell. |
| `frontend/admin/app/components/shared/record/useInlineEditRow.ts` | Per-row hook: dirty state + save (POST vs PATCH by `isNew`) + delete orchestration. |
| `frontend/admin/app/components/shared/record/useInlineEditRow.test.tsx` | Unit tests for the hook. |
| `frontend/admin/app/components/shared/record/InlineEditRow.tsx` | Renders one row uniformly (`id === null` OR `id !== null`) via a `renderCell` map. |
| `frontend/admin/app/components/shared/record/InlineEditRow.test.tsx` | Unit tests for the row component. |
| `docs/domain-rules/visits.md` | New domain-rules doc for the Visit entity + single-visit endpoints. |

### Modified files
| Path | Change |
|------|--------|
| `packages/api-client/src/schemas.ts` | Add `VisitCreateSchema`/`VisitCreate`, `VisitPatchSchema`/`VisitPatch`. (`export *` auto-exports.) |
| `packages/api-client/src/endpoints.ts` | Add `createVisit`, `patchVisit`, `deleteVisit`, `patchPayment`. |
| `frontend/admin/hooks/useRecordMutations.ts` | Add `addVisit` (returns `VisitResponse`), `patchVisit` (returns `VisitResponse`), `deleteVisit`, `patchPayment` (returns `PaymentResponse`). Keep existing fns for other callers. |
| `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx` | Drop `showForm` + `new*` state + form-row JSX; own `rows: VisitRow[]` state; render `InlineEditRow` per row. |
| `frontend/admin/app/components/shared/record/blocks/RecordPaymentsTable.tsx` | Same refactor; `PaymentRow` type; `useInlineEditRow`. |
| `frontend/admin/app/components/shared/record/blocks/ClientRecordTab.tsx` (or wherever the tables are consumed) | Wire the new `addVisit`/`patchVisit`/`deleteVisit`/`patchPayment`/`addPayment` mutations into the tables' props. |
| `docs/domain-rules/payments.md` | Add PATCH `/api/v1/payments/{id}` endpoint row; fix parity note. |

---

## Domain Rules Note (read before coding)

- **Backend needs ZERO changes** — `POST/PUT/PATCH/DELETE /api/v1/visits/:id` (visits.py L87-181) and `PATCH /api/v1/payments/:id` (payments.py L88-105) already exist and return the saved row.
- **`POST /visits` requires `record_id` + `price` (Field ge=0)**; `visitor_id`, `tariff_id`, `custom_price`, `status` optional. (`backend/src/schemas/visit.py` VisitCreate L19-22.)
- **`PATCH /visits/:id`** = `VisitPatch` (all optional, no `record_id`): `visitor_id?`, `tariff_id?`, `price? (ge=0)`, `custom_price?`, `status?`.
- **`PATCH /payments/:id`** = `PaymentPatch`: `amount? (gt=0)`, `method?`. `amount:null` is a no-op backend-side.
- **Add-visitor stays a two-step flow:** create `Visitor` (POST /visitors) → create `Visit` (POST /visits referencing `visitor_id`). The refactor changes the second step from bulk `patchRecord(visits[])` to single `POST /visits`, and returns the created `VisitResponse`.

---

## Phase 0 — api-client: schemas + endpoints

### Task 0.1: Add Visit request schemas to api-client
### Classification: small
### Required Docs
- `docs/domain-rules/visitors.md` — visitor vs visit relationship
- `backend/src/schemas/visit.py` — mirror VisitCreate (L19-22) / VisitPatch (L31-41) field lists

### Task Description
Add zod schemas mirroring the backend visit contracts to `packages/api-client/src/schemas.ts`.

### Steps
- [ ] In `packages/api-client/src/schemas.ts`, directly AFTER `VisitResponseSchema` (currently ends ~L211), add:
  ```typescript
  export const VisitCreateSchema = z.object({
    record_id: z.string(),
    visitor_id: z.string().nullable().optional(),
    tariff_id: z.string().nullable().optional(),
    price: z.number().int().min(0),
    custom_price: z.number().int().nullable().optional(),
    status: z.string().optional(),
  });
  export type VisitCreate = z.infer<typeof VisitCreateSchema>;

  export const VisitPatchSchema = z.object({
    visitor_id: z.string().nullable().optional(),
    tariff_id: z.string().nullable().optional(),
    price: z.number().int().min(0).optional(),
    custom_price: z.number().int().nullable().optional(),
    status: z.string().optional(),
  });
  export type VisitPatch = z.infer<typeof VisitPatchSchema>;
  ```
- [ ] Verify no duplicate identifier: `grep -n "VisitCreateSchema\|VisitPatchSchema" packages/api-client/src/schemas.ts` — expect only the new lines.
- [ ] Build the package types: `cd packages/api-client && npx tsc --noEmit` — expect no errors.
- [ ] Commit: `git add packages/api-client/src/schemas.ts && git commit -m "feat(api-client): add VisitCreate/VisitPatch schemas"`

### DoD
- `VisitCreate` / `VisitPatch` types exported (via `export *` in index.ts).
- `tsc --noEmit` clean for the package.

---

### Task 0.2: Add single-visit + patchPayment endpoint functions
### Classification: small
### Required Docs
- `packages/api-client/src/endpoints.ts` — mirror `patchActivity` (L184-192) and `updatePayment` (L313-318) verbatim
- `backend/src/api/v1/visits.py` — confirm paths (POST `/visits`, PATCH/DELETE `/visits/:id`)

### Task Description
Add `createVisit`, `patchVisit`, `deleteVisit`, and `patchPayment` to `packages/api-client/src/endpoints.ts`. All mutation fns return the saved-row schema. No `index.ts` edit needed (`export *`).

### Steps
- [ ] Ensure `VisitCreate`, `VisitPatch` are imported/available in `endpoints.ts` (they come from `./schemas`; check the existing import block imports schema types the same way other fns do — mirror how `PaymentCreate`/`PaymentUpdate` are referenced).
- [ ] Add near the other visit fns (after `updateVisitStatus`, ~L366):
  ```typescript
  export async function createVisit(data: VisitCreate): Promise<VisitResponse> {
    return api('/api/v1/visits', VisitResponseSchema, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  export async function patchVisit(id: string, data: VisitPatch): Promise<VisitResponse> {
    return api(`/api/v1/visits/${id}`, VisitResponseSchema, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  export async function deleteVisit(id: string): Promise<void> {
    await api(`/api/v1/visits/${id}`, z.any(), { method: 'DELETE' });
  }
  ```
- [ ] Add near the payment fns (after `updatePayment`, ~L318):
  ```typescript
  export async function patchPayment(
    id: string,
    data: { amount?: number; method?: string },
  ): Promise<PaymentResponse> {
    return api(`/api/v1/payments/${id}`, PaymentResponseSchema, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }
  ```
- [ ] Verify the DELETE `z.any()` pattern matches how existing void endpoints (e.g. `deletePayment` L320-322, `deleteVisitor` L346-348) are written — mirror them exactly (they may use a different void helper).
- [ ] `cd packages/api-client && npx tsc --noEmit` — expect no errors.
- [ ] Commit: `git add packages/api-client/src/endpoints.ts && git commit -m "feat(api-client): add createVisit/patchVisit/deleteVisit/patchPayment"`

### DoD
- 4 new fns exported, each returns the correct saved-row type (or void for delete).
- `tsc --noEmit` clean.

---

## Phase 1 — useRecordMutations: wire single-entity endpoints

### Task 1.1: Add addVisit/patchVisit/deleteVisit/patchPayment to useRecordMutations
### Classification: standard
### Required Docs
- `frontend/admin/hooks/useRecordMutations.ts` — existing patterns (invalidateAll, useCallback)
- `frontend/admin/hooks/__tests__/useRecordMutations.test.ts` — existing test structure
- `docs/domain-rules/visits.md` (created in Task 6.2 — if not yet present, reference the backend visit.py schema)

### Task Description
Add four new mutation functions to `useRecordMutations` that call the new single-entity api-client fns and RETURN the saved row. Do NOT remove existing fns (`addVisitorToRecord`, `deleteVisitor`, `addPayment`, etc.) — other callers may depend on them; they will be retired in the consumer refactor tasks once confirmed unused.

**RED-GREEN-REFACTOR.** Write failing unit tests first.

### Steps
- [ ] **RED:** In `frontend/admin/hooks/__tests__/useRecordMutations.test.ts`, add tests (mock `@memo/api-client`):
  - `addVisit` calls `createVisitor` then `createVisit` with `{ record_id, visitor_id, tariff_id, price }` and RETURNS the `VisitResponse` from `createVisit`.
  - `patchVisit(visitId, { tariff_id, price })` calls api `patchVisit(visitId, ...)` and returns the `VisitResponse`.
  - `deleteVisit(visitId)` calls api `deleteVisit(visitId)` and invalidates `['record', recordId]`.
  - `patchPayment(paymentId, { amount })` calls api `patchPayment` and returns the `PaymentResponse`.
  - Run: `cd frontend/admin && npm run test -- useRecordMutations` → expect FAIL (fns don't exist).
- [ ] **GREEN:** In `useRecordMutations.ts`:
  - Import the new api-client fns: `createVisit`, `patchVisit as apiPatchVisit`, `deleteVisit as apiDeleteVisit2`, `patchPayment` (alias to avoid clashing with the hook's own returned keys).
  - Add:
    ```typescript
    const addVisit = useCallback(
      async (data: { client_id: string; name: string; age?: number; tariff_id?: string | null; price: number }) => {
        const visitor = await createVisitor({ client_id: data.client_id, name: data.name, age: data.age });
        const visit = await createVisit({
          record_id: recordId,
          visitor_id: visitor.id,
          tariff_id: data.tariff_id ?? null,
          price: data.price,
        });
        queryClient.invalidateQueries({ queryKey: ['record', recordId] });
        return visit;
      },
      [recordId, queryClient],
    );

    const patchVisit = useCallback(
      async (visitId: string, data: { tariff_id?: string | null; price?: number; status?: string }) => {
        const visit = await apiPatchVisit(visitId, data);
        queryClient.invalidateQueries({ queryKey: ['record', recordId] });
        return visit;
      },
      [recordId, queryClient],
    );

    const deleteVisit = useCallback(
      async (visitId: string) => {
        await apiDeleteVisit2(visitId);
        queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      },
      [recordId, queryClient],
    );

    const patchPaymentFn = useCallback(
      async (paymentId: string, data: { amount?: number; method?: string }) => {
        const payment = await patchPayment(paymentId, data);
        queryClient.invalidateQueries({ queryKey: ['record', recordId] });
        queryClient.invalidateQueries({ queryKey: ['payments'] });
        return payment;
      },
      [recordId, queryClient],
    );
    ```
  - **Also add a returning variant of `addPayment`** (the spec requires `onAdd → POST /payments` to return `PaymentResponse` for replace-in-place). Either change the existing `addPayment` to `return await createPayment(...)` (verify no other caller depends on its void signature — grep `addPayment(`), or add a new `addPaymentRow` fn that returns the created `PaymentResponse`. RED test: `addPayment`/`addPaymentRow` returns the created payment.
  - Add `addVisit`, `patchVisit`, `deleteVisit`, `patchPayment: patchPaymentFn` (and the returning `addPayment` variant) to the returned object.
  - Run: `npm run test -- useRecordMutations` → expect PASS.
- [ ] **REFACTOR:** DRY the `invalidateQueries(['record', recordId])` into a small local helper if it reads cleanly.
- [ ] Run full vitest for the hook file: `npm run test -- useRecordMutations`.
- [ ] Commit: `git commit -m "feat(hooks): wire single-entity visit/payment endpoints in useRecordMutations (return saved rows)"`

### DoD
- 4 new hook fns, each returns the saved row (except `deleteVisit`).
- New unit tests pass; existing hook tests still pass.

---

## Phase 2 — Extract InlineEditCell

### Task 2.1: Extract InlineEditCell to its own file
### Classification: small
### Required Docs
- `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx` — lines 24-71 (source), 182 + 243 (usages)

### Task Description
Move `InlineEditCell` (+ its props interface) out of `RecordVisitsTable.tsx` into `frontend/admin/app/components/shared/record/InlineEditCell.tsx`. No behavior change. Add a `data-testid` passthrough (optional prop) so future tests can target it, but keep it un-set by default to avoid changing existing DOM.

### Steps
- [ ] Pre-check: `grep -rn "InlineEditCell" frontend/admin` — confirm only `RecordVisitsTable.tsx` defines/uses it (no external importers).
- [ ] Create `frontend/admin/app/components/shared/record/InlineEditCell.tsx`: move `InlineEditCellProps` (L24-31) + `InlineEditCell` (L33-71) verbatim. Add `'use client';` at top if the file uses hooks (it uses `useState`/`useRef`/`useEffect` → yes). Export the component.
- [ ] Add an optional `'data-testid'?: string` to `InlineEditCellProps` and spread it onto the `<input>` (default undefined → no attribute, no DOM change).
- [ ] In `RecordVisitsTable.tsx`: remove the local definition, add `import { InlineEditCell } from '../InlineEditCell';` (verify relative path — `blocks/` → parent `record/`).
- [ ] Run: `cd frontend/admin && npm run test -- RecordVisitsTable ClientRecordTab` → expect PASS (no behavior change).
- [ ] Commit: `git commit -m "refactor(record): extract InlineEditCell to shared file"`

### DoD
- `InlineEditCell` in its own file, imported by `RecordVisitsTable`.
- All existing tests green. No DOM/testid changes.

---

### Task 2.2: Add InlineEditCell unit tests
### Classification: small
### Required Docs
- `vitest-playwright-patterns` skill — component unit test patterns

### Task Description
Add `frontend/admin/app/components/shared/record/InlineEditCell.test.tsx` with 4 cases.

### Steps
- [ ] **RED/GREEN (component already exists, so these lock behavior):** write tests:
  - renders the `value`
  - shows `placeholder` when value is empty
  - Enter commits (`onCommit` called with new value)
  - Escape reverts (no `onCommit`, input shows original)
- [ ] Run: `npm run test -- InlineEditCell` → expect PASS.
- [ ] Commit: `git commit -m "test(record): add InlineEditCell unit tests"`

### DoD
- 4 passing unit tests.

---

## Phase 3 — useInlineEditRow + InlineEditRow

### Task 3.1: Implement useInlineEditRow hook
### Classification: standard
### Required Docs
- Spec `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` — "Hook signature" (L106-128), "Save flow" (L156-180)
- `test-driven-development` skill

### Task Description
Implement the generic per-row hook. **RED-GREEN-REFACTOR.**

Signature (from spec):
```ts
interface UseInlineEditRowOptions<T extends { id: string | null }, F> {
  row: T;
  emptyData: () => F;
  pickFormData: (row: T) => F;
  onAdd: (data: F) => Promise<T>;
  onUpdate: (id: string, data: F) => Promise<T>;
  onDelete: (id: string) => Promise<void>;
  onRemove: (row: T) => void;
}
```
Returns `{ formState, isNew, handleChange, handleSave, handleDelete, reset }`.

### Steps
- [ ] **RED:** `frontend/admin/app/components/shared/record/useInlineEditRow.test.tsx` with 6 cases (from spec T4):
  - `isNew=true` when `row.id === null`
  - `handleSave` calls `onAdd` (not `onUpdate`) when `isNew`
  - `handleSave` calls `onUpdate(id, ...)` when `!isNew`
  - `handleDelete` calls `onRemove` (no API) when `isNew`
  - `handleDelete` calls `onDelete(id)` when `!isNew`
  - `reset()` restores `formState` to `pickFormData(row)`
  - Run → expect FAIL.
- [ ] **GREEN:** implement `useInlineEditRow.ts`:
  - `formState` init from `pickFormData(row)`.
  - `isNew = row.id === null`.
  - `handleChange(field, value)` → `setFormState(s => ({ ...s, [field]: value }))`.
  - `handleSave` → `isNew ? onAdd(formState) : onUpdate(row.id!, formState)`.
  - `handleDelete` → `isNew ? onRemove(row) : onDelete(row.id!)`.
  - `reset` → `setFormState(pickFormData(row))`.
  - Run → expect PASS.
- [ ] **REFACTOR:** ensure generic constraints compile; no `any` leaks.
- [ ] Commit: `git commit -m "feat(record): add useInlineEditRow hook"`

### DoD
- 6 passing tests. Generic hook compiles with `tsc --noEmit`.

---

### Task 3.2: Implement InlineEditRow component
### Classification: standard
### Required Docs
- Spec — "Component contract — InlineEditRow" (L130-153)
- `vercel-composition-patterns` skill — component API design

### Task Description
Implement `InlineEditRow.tsx` that internally calls `useInlineEditRow` and renders one row uniformly given a `renderCell` map. Auto-focuses the Name input when `isNew`. **RED-GREEN-REFACTOR.**

### Steps
- [ ] **RED:** `InlineEditRow.test.tsx` (from spec T6):
  - renders both `isNew` and saved rows with the same `renderCell` output (no different JSX branch)
  - × button calls `handleDelete`
  - autofocus behavior only when `isNew` (assert an `autoFocus` prop / focus on the first focusable cell)
  - Run → expect FAIL.
- [ ] **GREEN:** implement `InlineEditRow.tsx`:
  - Props per spec (`row`, `testIdPrefix`, `renderCell`, `columns`, `onAdd`, `onUpdate`, `onDelete`, `onRemove`, `emptyData`, `pickFormData`, `isReadOnly?`).
  - Wrap `RecordTable.Row` (do NOT modify `RecordTable.Row` itself).
  - `testId = ${testIdPrefix}-${row.id ?? 'new'}`.
  - `__actions` cell shows `×` unless `isReadOnly`; calls `handleDelete`.
  - Run → expect PASS.
- [ ] Commit: `git commit -m "feat(record): add InlineEditRow component"`

### DoD
- 3 passing tests. Same render path for new/saved rows.

---

## Phase 4 — Refactor RecordVisitsTable

### Task 4.1: Refactor RecordVisitsTable to unified rows
### Classification: large
### Required Docs
- Spec — "Consumer pattern (RecordVisitsTable, simplified)" (L182-250), "Risks" (key stability, testid shim)
- Recon: current props interface (onChangeVisit, onDeleteVisit, onAddVisitor, onChangeVisitPrice, onChangeVisitor, onAnonymVisitsChange)
- `docs/domain-rules/visits.md`

### Task Description
Rewrite `RecordVisitsTable.tsx` to own `rows: VisitRow[]` state, render `InlineEditRow` per row, drop `showForm` + `new*` state + the form-row JSX (current L276-368). Use the new `addVisit`/`patchVisit`/`deleteVisit` mutations (returning saved rows) for replace-in-place. **RED-GREEN-REFACTOR at the E2E level (Phase 6) — here, keep existing unit tests green (with testid shim).**

### Steps
- [ ] Add transient `clientId: string` (UUID via `crypto.randomUUID()`) to new rows for React `key` stability; strip before send (spec Risks decision).
- [ ] `rows` state seeded from `visits.map(toVisitRow)`; `useEffect(() => setRows(visits.map(toVisitRow)), [visits])` to re-sync after invalidation.
- [ ] `+ Добавить` (`btn-add-visitor`) appends `makeEmptyVisitRow(tariffs)` (`id: null`, default `tariff_id = tariffs[0]?.id ?? null`, `price = tariffs[0]?.price ?? 0`).
- [ ] Per-row `renderCell` builds Name (`InlineEditCell`, autoFocus when `isNew`), Age, Tariff (select; on change also `handleChange('price', tariff.price)` — spec scenario 6), Price (`InlineEditCell`), Status (`StatusPicker`), `__actions` (×).
- [ ] **Testid shim (spec Risks):** when `isNew`, the Name input ALSO carries `data-testid="add-visitor-name"`; the `+ Добавить` button keeps `btn-add-visitor`; keep `visit-row-{id}` for saved rows and `visit-row-new` for new rows. This keeps existing unit + E2E tests working.
- [ ] `onAdd` → `addVisit({ client_id, name, age, tariff_id, price })` returns saved `VisitResponse`; replace the `clientId`-matched new row with `toVisitRow(saved)`.
- [ ] `onUpdate` → `patchVisit(id, { tariff_id, price, ... })`; replace row by `id`.
- [ ] `onDelete` → `deleteVisit(id)`; remove row.
- [ ] `onRemove` → splice new row from `rows` (no API).
- [ ] Wire these to the parent (`ClientRecordTab`) — the parent passes `addVisit`/`patchVisit`/`deleteVisit` from `useRecordMutations`. Update the parent's prop wiring accordingly. (Preserve `onAnonymVisitsChange`, `onChangeVisitor` if still needed for age/name of existing visitors — decide during impl: age/name edits on existing visits go through `updateVisitor`, not `patchVisit`.)
- [ ] Run: `npm run test -- RecordVisitsTable ClientRecordTab ClientTab` → fix until PASS (shim testids as needed).
- [ ] Run visual tests: `npm run test:all` (UI change).
- [ ] Commit: `git commit -m "refactor(record): RecordVisitsTable unified rows (id===null), replace-in-place"`

### DoD
- `showForm` + `new*` state gone; single render path.
- Existing unit tests green (via shim). Vitest + playwright green.

---

## Phase 5 — Refactor RecordPaymentsTable

### Task 5.1: Refactor RecordPaymentsTable to unified rows
### Classification: large
### Required Docs
- Spec — scenario 9 (payments parity), current props (`defaultAmount`, `onAdd`, `onDelete`)
- `docs/domain-rules/payments.md`

### Task Description
Same refactor applied to `RecordPaymentsTable.tsx`. New `PaymentRow` type, empty-row factory, `useInlineEditRow`. Existing payment rows become inline-editable via `patchPayment` (new capability — amount/method). Preserve `defaultAmount` behavior for the first new row. Keep `btn-add-payment`, `add-payment-*`, `payment-{id}` testids via shim.

### Steps
- [ ] `PaymentRow = { id: string | null; clientId: string; amount: number; method: string; created_at: string }`.
- [ ] `rows` from `payments.map(toPaymentRow)` + `useEffect` re-sync.
- [ ] `+ Добавить` appends empty payment row (`amount = defaultAmount ?? 0`, `method='card'`).
- [ ] `renderCell`: Amount (`InlineEditCell`, number), Method (select cash/card/transfer), Date (read-only `created_at` for saved rows; for new rows optional datetime-local), `__actions` (×).
- [ ] Testid shim: new-row amount input also `add-payment-amount`; keep `btn-add-payment`, `add-payment-submit` semantics (Enter-to-save on a new row), `payment-{id}-delete`.
- [ ] `onAdd` → `addPayment` returns `PaymentResponse` (add a returning variant if `addPayment` is still void — verify; if void, extend it to return the created payment like `addVisit`).
- [ ] `onUpdate` → `patchPayment(id, { amount, method })`; replace row by id.
- [ ] `onDelete` → `deletePayment(id)`; remove row. `onRemove` → splice new row.
- [ ] Run: `npm run test -- RecordPaymentsTable ClientRecordTab ClientTab ClientsIntegration` → PASS.
- [ ] `npm run test:all` (UI change).
- [ ] Commit: `git commit -m "refactor(record): RecordPaymentsTable unified rows (id===null), inline-edit + patchPayment"`

### DoD
- `showForm` gone; existing payment rows now inline-editable.
- All existing tests green (shim). Vitest + playwright green.

---

## Phase 6 — E2E + docs

### Task 6.1: Add/adjust E2E for the 9 user scenarios
### Classification: standard
### Required Docs
- Spec — "User Scenarios" (9 scenarios, L254-274)
- `vitest-playwright-patterns` skill — Full Cycle E2E pattern
- Existing `e2e/admin-adds-visitor.spec.ts`, `e2e/admin-manages-payments.spec.ts`

### Task Description
Extend/adjust Playwright E2E to cover the 9 spec scenarios (add-row-with-placeholders, Enter→POST→no-blink, multiple empty rows, ×-on-unsaved-no-API, edit-existing→PATCH, tariff→price auto-fill, ×-on-existing→DELETE, count-0 add-still-works, payments parity). Verify no-API-call scenarios via Playwright request interception. **RED-GREEN per scenario.**

### Steps
- [ ] For each scenario, add or adjust a test in the relevant spec file. Use existing testids (kept via shim). For "no API call" scenarios, assert via `page.on('request', ...)` filter that no `POST /visits` / `DELETE /visits` fired.
- [ ] Run the affected specs: `npm run test:e2e -- admin-adds-visitor admin-manages-payments` (or the project's E2E command from `dev-workflow`).
- [ ] Regenerate any legitimately-changed visual snapshots (row DOM changed) — review each diff.
- [ ] Commit: `git commit -m "test(e2e): cover 9 unified-rows scenarios"`

### DoD
- 9 scenarios green in E2E. Visual regression reviewed (no unexpected diffs).

---

### Task 6.2: Update domain-rules docs
### Classification: trivial
### Required Docs
- `docs/domain-rules/payments.md`, `docs/domain-rules/visitors.md`
- `domain-rules` skill template

### Task Description
Create `docs/domain-rules/visits.md` for the Visit entity + single-visit endpoints. Add the PATCH `/api/v1/payments/{id}` row to `payments.md`. Fix the frontend amount-parity note if closed.

### Steps
- [ ] Create `docs/domain-rules/visits.md` documenting: fields (record_id, visitor_id, tariff_id, price ge 0, custom_price, status), endpoints (GET/POST/PUT/PATCH/DELETE `/api/v1/visits`, PUT `/visits/:id/status`), cascade-to-record note (seats + status recompute, Phase 1).
- [ ] In `docs/domain-rules/payments.md`, add PATCH `/api/v1/payments/{id}` (amount? gt 0, method?) to the API Endpoints table.
- [ ] Commit: `git commit -m "docs(domain-rules): add visits.md, add PATCH payment endpoint"`

### DoD
- `visits.md` exists; `payments.md` documents PATCH.

---

## Acceptance Gates

| Gate | Condition |
|------|-----------|
| Phase 0 → 1 | api-client compiles; new schemas + endpoint fns exported. |
| Phase 1 → 2 | `useRecordMutations` new fns return saved rows; hook tests green. |
| Phase 2 → 3 | `InlineEditCell` extracted, tests green, no DOM change. |
| Phase 3 → 4 | `useInlineEditRow` + `InlineEditRow` pass own unit tests. |
| Phase 4 → 5 | `RecordVisitsTable` refactored; existing tests green (shim); vitest+playwright green. |
| Phase 5 → 6 | `RecordPaymentsTable` refactored; existing tests green (shim). |
| Phase 6 → done | 9 E2E scenarios green; visual regression reviewed; domain-rules updated. |
| Visual Compliance (Step 4.5) | All checks in spec "Visual Compliance Checks" pass. |

---

## Behavioral Delta (for G2 user gate)

**What changes for the admin (user-visible behavior):**

1. **"Новая строка = обычная строка."** Кнопка "+ Добавить" в таблице посетителей/оплат больше не открывает отдельную форму снизу — она добавляет пустую строку прямо в таблицу (плейсхолдеры "Аноним" / "Взрослый" / "— тариф —"), курсор сразу в поле Имя.
2. **Ввод → Enter → строка сохраняется на месте, без мигания.** Раньше форма закрывалась и строка «переприходила» после рефетча. Теперь строка остаётся на месте, просто получает id и данные с сервера.
3. **× на несохранённой строке = убрать без запроса к серверу.** × на сохранённой = удалить (DELETE).
4. **Существующие платежи теперь можно редактировать inline** (сумма/метод) — раньше только удалять. Это новая возможность (через `PATCH /payments/{id}`).
5. **Выбор тарифа авто-подставляет цену** (как и раньше, но теперь единообразно для новых и существующих строк).
6. Всё остальное — без визуальных изменений: те же колонки, те же итоги, тот же дизайн. Это в первую очередь рефакторинг: убираем дублирование и технический долг (bulk `patchRecord` → одиночные `POST/PATCH/DELETE /visits`).

**Что НЕ меняется:** дизайн, колонки, статусы, права (`isReadOnly`), бэкенд (0 изменений — используем уже готовые ручки Phase 0-2).

**Риск:** самый крупный кусок — рефактор двух таблиц (Phase 4-5, классификация large). Есть страховка: shim старых `data-testid` сохраняет существующие тесты зелёными.
