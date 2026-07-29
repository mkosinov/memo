# RecordsContext Payments Batch Aggregate — Design

- **GitHub issue:** #186
- **Date:** 2026-07-29
- **Phase:** DESIGN (G1a passed 2026-07-29, variant C approved)
- **Domain rules:** `docs/domain-rules/payments.md`, `docs/domain-rules/records.md`

## Problem

The Records page derives per-record payment status ("✓ Оплачено / Частично / Не оплачено") and the ClientCardModal "Потрачено" figure from a **client-side lookup map** built from a single unfiltered `getPayments({ per_page: 100 })` call in `RecordsContext`. After issue #182 introduced the `per_page ≤ 100` cap, this silently breaks as soon as the payments table exceeds 100 rows:

- The lookup map is incomplete → payment statuses lie (a fully-paid record may show "Не оплачено").
- ClientCardModal "Потрачено" is under-reported (only sums the first 100 payments globally, then filters by the client's records).
- Sorting by the "Оплата" column sorts on the same wrong sums.

The failure is **silent** — no error, just wrong numbers.

## User Scenarios

1. **Admin opens "Записи"** (period = current week) → the "Оплата" column shows ✓ Оплачено / Частично / Не оплачено per record, computed as `sum(payments for the record) >= record price`.
2. **Admin sorts by "Оплата"** → sorting uses the same per-record payment sums.
3. **Admin clicks a row** → detail panel lists that record's payments (amount + method) — per-record fetch via `useRecordData`, already works, **no changes**.
4. **Admin opens ClientCardModal** → "Потрачено" shows the client's total paid across ALL records (not just visible ones); each record row in the modal's history shows its payment status from the batch aggregate.
5. **Admin switches the period / records change** → aggregates refetch automatically for the new visible record set (query key invalidation).
6. **Regression guard:** with >100 payment rows in the DB, all of the above still show correct values.

## Solution Overview (variant C)

### Backend — batch aggregate endpoint

- Extend `GET /api/v1/payments` with a new optional query param **`record_ids`** (list of record IDs, `?record_ids=a&record_ids=b&...`).
- When `record_ids` is provided, the response is an aggregate map: `{ totals: { "<record_id>": <total_amount>, ... } }` — SQL `WHERE record_id IN (...) GROUP BY record_id` with `SUM(amount)`.
  - Concrete shape (decided for plan): a **dedicated route** `GET /api/v1/payments/totals?record_ids=...`, to avoid overloading the paginated list response with a different schema. FastAPI resolves static route `/payments/totals` before `/payments/{id}` if declared first — plan must declare it before the `{payment_id}` route.
- Records with **no payments** are simply absent from the map (frontend treats missing key as 0).
- Only active (non-soft-deleted) payments are summed.
- Pattern to follow: SQL aggregates on the backend as in `list_clients_with_stats` (`backend/src/services/client.py` lines 36–223). The generic repository's `filters` (exact equality only, `backend/src/repositories/generic.py` lines 28–39) does **not** support `IN` — implement a dedicated repository/service method with a custom SQLAlchemy query rather than extending the generic filters mechanism (YAGNI: payments totals is the only consumer).
- No batch raw-payment list endpoint — only the aggregate.
- `record_id` on Payment is a required FK — orphan payments are out of scope.

### API client

- `packages/api-client/src/endpoints.ts`: add `getPaymentTotals(recordIds: string[])` → calls the new endpoint, returns `Record<string, number>`. Update generated/handwritten types accordingly.

### Frontend — RecordsContext

- `frontend/admin/contexts/RecordsContext.tsx` (~line 97): remove the global `getPayments({ per_page: 100 })` query and the lookup map built from it (lines 131–139).
- Instead: collect `record_ids` of the records currently loaded in context, fetch totals in **one** call, query key `['payments', 'totals', recordIds]` (sorted/joined for stability) — self-invalidating when the record set changes.
- Expose the totals map to consumers with the same shape the lookup map had (per-record paid sum), so `RecordsTable` consumers need minimal changes:
  - `RecordsTable.tsx` lines 179–188 (sort), 216–217 (`paidForRecord`), 404–414 (payment column) keep working off the new map. Missing key → 0 → "Не оплачено".
- Loading/empty states: while totals are loading, payment column may render the same placeholder/skeleton it uses today for loading state (no new UI).

### Frontend — ClientCardModal

- `app/(main)/records/components/ClientCardModal.tsx` lines 45–54:
  - "Потрачено" — take from the **server-side `total_paid`** already computed by the clients with-stats endpoint (`backend/src/api/v1/clients.py` line 66 → `src/services/client.py`). Remove the frontend recomputation from the lookup map.
  - Per-record payment status in the modal's record history — from the RecordsContext batch totals map (same source as the table column). If the modal can show records outside the currently loaded context set, it must request totals for its own record list via the same `getPaymentTotals` (query key per its record IDs) — plan decides by inspecting actual modal data flow.
- Detail panel: **no changes** (per-record `useRecordData`).

## Adjacent Bug Assessment: `GET /records` ignores `date_from`/`date_to`

Backend `GET /api/v1/records` declares only `client_id` and silently ignores `date_from`/`date_to` sent by the frontend; date filtering happens client-side in RecordsTable.

**Assessment: OUT OF SCOPE for #186 — recommend a separate issue.**

Reasons:
- #186 is about payment aggregates; the fix is orthogonal and self-contained.
- Moving date filtering server-side changes pagination semantics (page/per_page over a filtered set) and interacts with the #182 pagination migration — deserves its own design (where does filtering live: service vs. repository, interaction with existing client-side filters, seed/test data implications).
- Bundling it would double review surface and delay the silent-data-corruption fix.

The user approves/rejects this recommendation at G1b.

## Non-Goals

- No batch raw-payments endpoint.
- No changes to detail panel payment list.
- No server-side date filtering for records (see above).
- No changes to payment CRUD semantics.

## Acceptance Criteria

- [ ] `GET /api/v1/payments/totals?record_ids=...` returns `{ totals: { record_id: sum } }` computed in SQL (IN + GROUP BY + SUM), active payments only.
- [ ] Records with no payments are absent from the map (frontend treats missing key as 0). Behavior for an empty `record_ids` param is explicit (200 with empty totals or 400) and tested — exact choice made in plan.
- [ ] RecordsContext no longer calls unfiltered `getPayments`; totals query key includes record IDs.
- [ ] Payment status column + sorting show correct values with >100 payments in DB (regression test or E2E).
- [ ] ClientCardModal "Потрачено" uses server `total_paid`; matches backend aggregate.
- [ ] Domain rules `payments.md` updated with the new endpoint (via docser at IMPL).
- [ ] Backend tests: totals endpoint (multiple records, record without payments, soft-deleted payment excluded).
- [ ] Frontend tests: RecordsContext totals wiring; RecordsTable status/sort against totals map; ClientCardModal total_paid.

## Visual Compliance Checks

- [ ] "Оплата" column on Records page shows ✓ Оплачено / Частично / Не оплачено for visible records.
- [ ] Sorting by "Оплата" reorders rows by payment status/sum.
- [ ] ClientCardModal shows "Потрачено" figure and per-record payment statuses in history.
- [ ] Record detail panel still lists payments with amount + method.
