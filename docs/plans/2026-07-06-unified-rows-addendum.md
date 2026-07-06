# Unified Rows Addendum — New-row Save + Editable Payment Date — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three new-row UX regressions found in live testing: (1) new rows don't save when a prefilled field is left unchanged (payment prefilled amount, anonymous visitor), (2) a saved new visitor's name blanks in the UI until F5, (3) restore an editable, persisted payment date. Plus restore the `amount > 0` guard with an error toast on both create and edit.

**Architecture:** Converge new-row saving onto the already-existing-but-dead `useInlineEditRow.handleSave` (row-level blur/Enter trigger) instead of the change-gated per-cell `InlineEditCell.onCommit`. Fix replace-in-place to preserve the just-submitted values (independent of the not-yet-refreshed `visitorsMap`). Add one optional timestamp field to the backend payment create path and thread it through an editable datetime input.

**Tech Stack:** Next.js 14 + TypeScript, React Query, Zod (`@memo/api-client`), vitest + Playwright; FastAPI + Pydantic + SQLite (payment create).

**Spec:** `docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md` — the `## Addendum` section (A, A.1, B) + User Scenarios 10-14.

---

## Behavioral Delta

How this behaves for the admin, mapped to the addendum's acceptance criteria:

- **Scenario 10** → In the payments table, clicking "+ Добавить" prefills the amount with the outstanding balance ("К оплате"). Pressing Enter or clicking away — **without editing the amount** — now saves the payment. (Currently: nothing happens unless you change the amount.)
- **Scenario 11** → In the visitors table, adding a row, picking only a tariff and leaving the name blank ("Аноним"), then blurring/Enter — now saves an anonymous visit. (Currently: it doesn't save.)
- **Scenario 12** → Entering a payment amount of 0 (new row) or clearing an existing payment's amount to 0 → shows an error toast "Сумма должна быть больше 0" and does NOT save (no failed request). The existing payment keeps its previous amount.
- **Scenario 13** → A new payment row shows the current date/time in an **editable** field; the admin can adjust it, and the saved payment keeps that chosen time.
- **Scenario 14** → After typing a visitor's name and pressing Enter, the name **stays visible** in the row immediately — no blanking to "Аноним", no need to reload. Same for a new payment's amount/method/date after save.

---

## File Structure

### Modified files
| Path | Change |
|------|--------|
| `backend/src/schemas/payment.py` | Add optional `created_at: datetime \| None = None` to `PaymentCreate` (accept client-supplied timestamp). |
| `backend/src/services/payment.py` (or the generic create path) | When `created_at` provided on create, persist it; else DB default. |
| `backend/src/api/v1/payments.py` | (only if needed) ensure the create handler passes `created_at` through. |
| `backend/tests/test_api_payments.py` | Tests: POST with `created_at` persists it; POST without it defaults to now. |
| `packages/api-client/src/schemas.ts` | Add optional `created_at?: string` to `PaymentCreateSchema`. |
| `packages/api-client/src/endpoints.ts` | (only if createPayment needs to forward the new field — it already sends the whole body, so likely no change; verify.) |
| `frontend/admin/hooks/useRecordMutations.ts` | `addPayment(amount, method, date?)` forwards `created_at`; `addVisit` returns the created visitor's name/age alongside the visit (or the tables merge submitted values — see Task 2). |
| `frontend/admin/app/components/shared/record/useInlineEditRow.ts` | Ensure `handleSave` is the canonical new-row save; add `useEffect([row])` re-init OR document that consumers pass fresh rows. |
| `frontend/admin/app/components/shared/record/InlineEditRow.tsx` | Add a row-level save trigger for new rows: Enter on any cell + blur leaving the row → `handleSave()` (unconditional for `isNew`). |
| `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx` | Use `handleSave` path; replace-in-place preserves submitted name/age; drop the change-gated per-cell save. |
| `frontend/admin/app/components/shared/record/blocks/RecordPaymentsTable.tsx` | Same save-path change; `amount > 0` guard + error toast on POST and PATCH; editable datetime cell for new rows; replace-in-place preserves submitted values. |
| `frontend/admin/e2e/unified-rows.spec.ts` | Add E2E for scenarios 10-14. |
| `docs/domain-rules/payments.md` | Document the optional `created_at` on create + `amount > 0` rule. |

---

## Task 1: Backend — accept optional `created_at` on payment create
### Classification: standard
### Required Docs
- `docs/domain-rules/payments.md` — payment fields + `amount > 0` rule
- `backend/src/schemas/payment.py` — PaymentBase/PaymentCreate
- `backend/src/services/payment.py` + the generic service create path
- `pytest-patterns` skill — API test patterns (sync TestClient, factory)

### Task Description
Allow `POST /api/v1/payments` to accept an optional client-supplied `created_at`. When provided, the created payment uses it; when omitted, the DB default (now) applies. Backward-compatible.

**Schema change:** no new column — `payments.created_at` already exists (it's on `PaymentResponse`). We only ALLOW setting it on create.

### Steps
- [ ] Read `backend/src/schemas/payment.py`. Add to `PaymentCreate` (NOT to `PaymentBase` unless clean) an optional `created_at: datetime | None = None`. Keep `amount: int = Field(gt=0)` unchanged.
- [ ] Read the create path (`backend/src/services/payment.py` — likely a `GenericService.create` or a `PaymentService`). Determine how a model instance is built from the schema. Ensure that when `created_at` is present in the payload, it is set on the ORM model; when None, the model's default timestamp applies. If the generic create blindly maps all fields, confirm `created_at=None` does NOT overwrite the DB default (guard: only set if not None).
- [ ] **RED:** in `backend/tests/test_api_payments.py` add:
  - `test_create_payment_with_created_at_persists_it`: POST `{record_id, amount, method, created_at: "2026-06-01T12:00:00"}` → 201 → response `created_at` == that value (or GET the payment and assert).
  - `test_create_payment_without_created_at_defaults_now`: POST without `created_at` → 201 → `created_at` is a recent timestamp (close to now).
  - Run `cd backend && uv run pytest tests/test_api_payments.py -q` → expect the first to FAIL (created_at ignored).
- [ ] **GREEN:** implement the create-path handling. Run tests → PASS.
- [ ] Run full payment tests: `cd backend && uv run pytest tests/test_api_payments.py tests/services/test_payment_service.py -q`. mypy: `uv run mypy src/schemas/payment.py src/services/payment.py` (or project mypy target) → clean for touched files.
- [ ] `alembic check` — confirm NO new migration needed (column already exists).
- [ ] Commit: `git add -A && git commit -m "feat(backend): accept optional created_at on payment create"`

### DoD
- POST with `created_at` persists it; without it defaults to now. Existing payment tests still pass. No migration. Scenario 13 backend half done.

---

## Task 2: Frontend — new-row save on blur/Enter + preserve submitted values (both tables)
### Classification: standard
### Required Docs
- Spec `## Addendum` A + A.1 (save flow, replace-in-place preserve-submitted, dead `handleSave`)
- `frontend/admin/app/components/shared/record/useInlineEditRow.ts`, `InlineEditRow.tsx`, `InlineEditCell.tsx`
- `frontend/admin/app/components/shared/record/blocks/RecordVisitsTable.tsx` + `RecordPaymentsTable.tsx`
- `frontend/admin/hooks/useRecordMutations.ts` (`addVisit`, `addPayment` return shapes)
- `docs/domain-rules/visitors.md` (name optional → anonymous), `vitest-playwright-patterns` skill

### Task Description
Make new-row saving fire on blur-leaving-the-row OR Enter (regardless of whether a field changed), via `useInlineEditRow.handleSave`. Fix replace-in-place so the saved row shows the just-submitted values immediately (no blank name, no F5). Applies to BOTH tables. **RED-GREEN-REFACTOR.**

### Steps
- [ ] **Wire `handleSave` into `InlineEditRow`:** consume `handleSave` from `useInlineEditRow`. Add a row-level trigger:
  - On **Enter** keydown within the row (any cell) → if `isNew`, call `handleSave()`.
  - On **blur leaving the row** (focus moves outside the row's DOM — use `onBlur` with `relatedTarget`/`currentTarget.contains` check) → if `isNew` and the row is "dirty enough to save" (see guard below), call `handleSave()`.
  - Guard against double-save: track a `saving` ref/state so concurrent Enter+blur don't double-POST; once saved (row gets id), subsequent commits go through the existing PATCH path.
- [ ] **`handleSave` must save unconditionally for new rows** (not gated on any single field changing). Verify `useInlineEditRow.handleSave` calls `onAdd(formState)` for `isNew`. Keep `formState` as the source of truth for what to send.
- [ ] **Preserve submitted values on replace (A.1):** change each table's `onAdd`/replace logic so the replaced row uses the submitted `formState` values (name/age for visits; amount/method/date for payments), NOT a `visitorsMap` re-lookup. Concretely, one of:
  - Make `addVisit` return `{ ...visit, name, age }` (thread the created visitor's name/age through), OR
  - In the table, `replaceRowByClientId(clientId, { ...visitResponseToRow(saved, visitorsMap), name: submitted.name, age: submitted.age })`.
  Pick the cleaner one; document the choice. Do the analogous thing for payments (amount/method/created_at).
- [ ] **Remove the change-gated per-cell save:** in both tables' `renderCell`, drop the `handleAdd(...).then(replaceRowByClientId)` embedded in the Name/Amount `InlineEditCell.onCommit`. New-row saving now lives in the `handleSave` row trigger. (SAVED-row per-cell PATCH-on-change stays.)
- [ ] **Anonymous visit:** ensure a new visit row with blank name saves (name optional). `addVisit`/`createVisitor` with empty name must be allowed (verify backend accepts empty/None name for visitor — if backend requires a name, send a default like "Аноним" or confirm the visitor schema allows empty). Document what you found.
- [ ] **RED tests (vitest):** add/adjust unit tests:
  - `useInlineEditRow`/`InlineEditRow`: Enter on a new row calls `onAdd` even when no field changed; blur leaving the row calls `onAdd`; double-trigger doesn't double-call.
  - `RecordVisitsTable`: after `onAdd` resolves, the row shows the submitted name (not blank). Simulate `addVisit` returning a VisitResponse without name + a stale visitorsMap → assert the row still shows the submitted name.
  - Run `cd frontend/admin && pnpm exec vitest run useInlineEditRow InlineEditRow RecordVisitsTable RecordPaymentsTable ClientRecordTab ClientTab` → RED where new behavior missing.
- [ ] **GREEN:** implement. Re-run vitest → PASS. Keep all existing tests green.
- [ ] `npx tsc --noEmit` → clean.
- [ ] `pnpm exec vitest run` (full) → only the pre-existing CalendarPopover flake (#123) may fail; 0 new failures.
- [ ] Commit: `git add -A && git commit -m "fix(record): new-row save on blur/Enter + preserve submitted values (both tables)"`

### DoD
- Scenarios 10, 11, 14 pass at unit level. Prefilled payment saves without editing; anonymous visit saves; visitor name stays visible after Enter. No change-gate dependence. Dead `handleSave` now live; dead `onUpdate` addressed or documented.

---

## Task 3: Frontend — amount > 0 guard with error toast (POST + PATCH)
### Classification: small
### Required Docs
- Spec `## Addendum` A (guard: toast, POST+PATCH, keep min)
- `docs/domain-rules/payments.md` (`amount > 0`)
- `RecordPaymentsTable.tsx`; the project's toast/error mechanism (grep `role="status"`, `waitForToast`, error-contract from PR #99) — find how other places show an error toast
- `vitest-playwright-patterns` skill

### Task Description
Restore the `amount > 0` validation on payment save (both new-row POST and existing-row PATCH). On `amount <= 0`: show an error toast "Сумма должна быть больше 0" and do NOT send the request. Keep `min={1}` on the amount input as a browser hint.

### Steps
- [ ] Find the project's toast mechanism (how success/error toasts are shown elsewhere — likely a `useToast`/context or the error-contract handler). Use the SAME mechanism.
- [ ] In `RecordPaymentsTable.tsx`, at BOTH save points (new-row `handleSave`/`onAdd` path and existing-row amount PATCH path), add: if the amount to be sent is `<= 0` → show error toast "Сумма должна быть больше 0", return early (no POST/PATCH). For existing rows, the row keeps its previous amount (don't mutate local state to 0).
- [ ] Keep/add `min={1}` on the amount `<input type="number">` (InlineEditCell — pass a `min` prop through if not present; small passthrough).
- [ ] **RED (vitest):** `RecordPaymentsTable`: new row amount=0 on save → toast shown, `addPayment` NOT called. Existing row amount edited to 0 → toast shown, `patchPayment` NOT called, row keeps old amount. Run vitest → RED.
- [ ] **GREEN:** implement → vitest PASS.
- [ ] `npx tsc --noEmit` clean. Commit: `git add -A && git commit -m "fix(record): amount>0 guard with error toast on payment create+edit"`

### DoD
- Scenario 12 passes at unit level. amount<=0 never sent (POST or PATCH); toast shown; existing amount preserved.

---

## Task 4: Frontend — editable payment date on new rows + persist
### Classification: standard
### Required Docs
- Spec `## Addendum` B + Scenario 13
- `RecordPaymentsTable.tsx` (Date cell renderCell), `useRecordMutations.ts` (`addPayment`), `packages/api-client/src/schemas.ts` + `endpoints.ts` (`PaymentCreateSchema`, `createPayment`)
- `vitest-playwright-patterns` skill

### Task Description
A new payment row shows an editable `datetime-local` input auto-filled with the current time; the chosen value is sent and persisted as `created_at` (backend from Task 1). Saved rows keep the read-only formatted date. **RED-GREEN-REFACTOR.**

### Steps
- [ ] `packages/api-client/src/schemas.ts`: add optional `created_at: z.string().optional()` to `PaymentCreateSchema`. `createPayment` already sends the whole body — verify no endpoint change needed.
- [ ] `useRecordMutations.ts`: change `addPayment(amount, method, date?)` to forward `created_at: date` into `createPayment({ record_id, amount, method, created_at })` (omit if undefined). Keep return = saved PaymentResponse.
- [ ] `RecordPaymentsTable.tsx`:
  - `makeEmptyPaymentRow`: set `created_at` to the current time (ISO, suitable for `datetime-local` value, e.g. `new Date().toISOString().slice(0,16)`).
  - Date cell renderCell: for NEW rows render an editable `<input type="datetime-local" value={formState.created_at} onChange={... handleChange('created_at', ...)}>` with testid (e.g. `add-payment-date`); for SAVED rows keep the read-only formatted `created_at` span.
  - On save (Task 2's `handleSave` path), pass the row's `created_at` into `addPayment(amount, method, created_at)`.
  - Replace-in-place: the saved row shows the server `created_at` (which equals the submitted one).
- [ ] **RED (vitest):** `RecordPaymentsTable`: new row renders a datetime input prefilled with ~now; editing it and saving calls `addPayment` with the chosen `created_at`. Run vitest → RED.
- [ ] **GREEN:** implement → vitest PASS. `npx tsc --noEmit` clean.
- [ ] Commit: `git add -A && git commit -m "feat(record): editable payment date on new rows, persisted via created_at"`

### DoD
- Scenario 13 passes end-to-end (frontend sends chosen date; Task 1 backend persists it). New-row date editable + auto-filled; saved rows read-only.

---

## Task 5: E2E for scenarios 10-14 + domain-rules doc
### Classification: standard
### Required Docs
- Spec Scenarios 10-14
- `frontend/admin/e2e/unified-rows.spec.ts` (existing), `e2e/fixtures/helpers.ts`
- `dev-workflow` skill `## Playwright E2E` (browser check-before-install, standalone run, PTY)
- `vitest-playwright-patterns` skill

### Task Description
Add Playwright E2E for the 5 new scenarios; update `docs/domain-rules/payments.md`. **Note:** scenarios needing `openModal` on a multi-record week may hit GH #124 — if so, mark `test.skip` with the #124 reference like the existing skips, but cover what's reachable.

### Steps
- [ ] Read the `## Playwright E2E` section in `.opencode/skills/dev-workflow/SKILL.md`. Verify the browser is present (check-before-install snippet) — do NOT blindly `playwright install`.
- [ ] Add E2E to `unified-rows.spec.ts`:
  - Scenario 10: new payment prefilled amount → Enter without editing → saved (assert row gets id / total updates).
  - Scenario 11: new visit, tariff only, blank name → blur/Enter → anonymous visit saved.
  - Scenario 12: payment amount 0 → error toast, no request (request interception).
  - Scenario 13: new payment date input present + editable; saved payment reflects chosen date.
  - Scenario 14: type visitor name → Enter → name stays visible (no blank), no reload.
  - For any scenario blocked by openModal (#124), `test.skip(true, '... GH #124')` matching the existing pattern.
- [ ] Start backend :8000 + run the spec via PTY per dev-workflow. Fix until green (or skip w/ #124).
- [ ] Update `docs/domain-rules/payments.md`: document optional `created_at` on create + the `amount > 0` rule (frontend guard + backend gt=0).
- [ ] Commit: `git add -A && git commit -m "test(e2e): scenarios 10-14 + docs(domain-rules): payment created_at & amount>0"`

### DoD
- E2E for scenarios 10-14 present (passing or #124-skipped with reason). payments.md updated.

---

## Acceptance Gates
| Gate | Condition |
|------|-----------|
| Task 1 → 2 | Backend persists optional created_at; payment tests green; no migration. |
| Task 2 → 3 | New-row save on blur/Enter works both tables; name/amount preserved after save (no blank/F5); anonymous visit saves; vitest green. |
| Task 3 → 4 | amount>0 guard + toast on POST+PATCH; vitest green. |
| Task 4 → 5 | Editable payment date auto-filled + persisted; vitest green. |
| Task 5 → done | E2E 10-14 (passing or #124-skipped); docs updated. |
| Visual re-check | Manual/live verification of the 5 scenarios in the running dev server. |

---

## Self-Review notes
- No new DB column (created_at exists) → no migration.
- Task 2 is the linchpin (save-path rework) — it retires the dead `handleSave`/`onUpdate` flagged in Task 4.1/5.1 reviews.
- Anonymous-visit save depends on the backend visitor schema allowing empty name — Task 2 must verify and document; if backend requires a name, send "Аноним" as the default.
- Toast mechanism must reuse the project's existing error-contract/toast, not a new one (Task 3).
