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

- New **dedicated route** `GET /api/v1/payments/totals?record_ids=a&record_ids=b&...` (repeated query params) returning `{ totals: { "<record_id>": <total_amount>, ... } }` — SQL `WHERE record_id IN (...) GROUP BY record_id` with `SUM(amount)`. A dedicated route avoids overloading the paginated list response with a different schema.
  - **Route ordering (critical):** FastAPI resolves static routes before path params only if declared first — the `/totals` route MUST be inserted before the existing `GET /payments/{payment_id}` route (currently `backend/src/api/v1/payments.py` line 42).
- Records with **no payments** are absent from the map (frontend treats missing key as 0).
- Payments are **hard-deleted** in this codebase (no `is_active` on the Payment model — migration `a1b2c3d4e5f6` dropped it). The aggregate therefore needs **no soft-delete filter**; it sums all payment rows for the given record IDs.
- The aggregate deliberately does **not** join through `Record.is_active` — per-record totals are keyed by record_id, and the caller (RecordsContext) only ever passes IDs of active records it has loaded. This differs from `total_paid` in `list_clients_with_stats` (which joins through active Records because it aggregates across a client's whole history); both are correct for their use case.
- Pattern to follow: `list_clients_with_stats` in `backend/src/services/client.py` (lines 36–223) — a **module-level async function** in the service module with direct SQLAlchemy, called from the router. Implement `get_payment_totals(session, record_ids)` the same way in `backend/src/services/payment.py` — NOT as a `PaymentService` class method, and NOT by extending the generic repository `filters` mechanism (exact-equality only, `backend/src/repositories/generic.py` lines 28–39; YAGNI — this aggregate is the only `IN` consumer).
- **Cardinality guard:** `record_ids` is capped (e.g. `max_length=200` on the query param list — page-sized sets are ≤100 after #182; exact cap in plan). Over the cap → 422. GET with repeated query params is fine at this size (~36 chars/UUID × 200 ≈ 7.5 KB worst case, within typical 8 KB limits); a POST-body variant is rejected as needless complexity for one page-sized consumer.
- **Empty `record_ids`** (`?record_ids=` with no values, i.e. empty list): return **200 with `{ "totals": {} }`**. Frontend skips the request entirely when there are no visible records (`enabled: recordIds.length > 0`), so this path is only defensive.
- No batch raw-payment list endpoint — only the aggregate.
- `record_id` on Payment is a required FK — orphan payments are out of scope.

### API client

- `packages/api-client/src/endpoints.ts`: add `getPaymentTotals(recordIds: string[])` → calls the new endpoint, returns `Record<string, number>`. Update generated/handwritten types accordingly.

### Frontend — RecordsContext

- `frontend/admin/contexts/RecordsContext.tsx` (~line 97): remove the global `getPayments({ per_page: 100 })` query and the lookup map built from it (lines 131–139).
- Instead: collect `record_ids` of the records currently loaded in context, fetch totals in **one** call, query key `['payments', 'totals', recordIds]` (IDs sorted, then joined for key stability) — self-invalidating when the record set changes. The query is disabled (`enabled: recordIds.length > 0`) while the records list is empty (initial load, period switch), so no empty/400 request fires; while totals are loading, the payment column renders the same loading placeholder it uses today (no new UI).
- Expose the totals map to consumers with the same shape the lookup map had (per-record paid sum), so `RecordsTable` consumers need minimal changes:
  - `RecordsTable.tsx` lines 179–188 (sort), 216–217 (`paidForRecord`), 404–414 (payment column) keep working off the new map. Missing key → 0 → "Не оплачено".
- **Error state:** if the totals query fails, the payment column shows the same "Не оплачено" fallback (missing data → 0) and react-query's default retry applies; no new error UI (matches current behavior for the payments query failing).

### Frontend — ClientCardModal

- `app/(main)/records/components/ClientCardModal.tsx` lines 45–54:
  - "Потрачено" — take from the **server-side `total_paid`** already computed by the clients with-stats endpoint (`backend/src/api/v1/clients.py` line 66 → `src/services/client.py`). Remove the frontend recomputation from the lookup map.
  - **Semantic note (accepted):** current frontend `totalSpent` excludes cancelled records (lines 52–54); server `total_paid` sums payments over all active records regardless of status. The server's broader definition is the intended one going forward (a cancelled record's payments are still real money paid) — this is a deliberate behavior change, aligned with the Clients page, which already displays server `total_paid`.
  - **Divergence note (pre-existing, documented):** "Потрачено" is an all-time figure, while the modal's record history shows only the current period's records (from context). Sum of visible rows' statuses need not equal "Потрачено" — accepted, no UI change.
  - Per-record payment status in the modal's record history — from the RecordsContext batch totals map (same source as the table column). The modal filters `records` from the same context (ClientCardModal.tsx line 33), so its records are always a subset of the loaded set — no separate fetch needed.
- Detail panel: **no changes** (per-record `useRecordData`).

## Adjacent Bug Assessment: `GET /records` ignores `date_from`/`date_to`

Backend `GET /api/v1/records` declares only `client_id` and silently ignores `date_from`/`date_to` sent by the frontend; date filtering happens client-side in RecordsTable.

**Assessment: OUT OF SCOPE for #186 — recommend a separate issue.**

Reasons:
- #186 is about payment aggregates; the fix is orthogonal and self-contained.
- Moving date filtering server-side changes pagination semantics (page/per_page over a filtered set) and interacts with the #182 pagination migration — deserves its own design (where does filtering live: service vs. repository, interaction with existing client-side filters, seed/test data implications).
- Bundling it would double review surface and delay the silent-data-corruption fix.

The user approves/rejects this recommendation at G1b.

## Design Alternatives Considered

- **Rejected: extend `GET /payments` with optional `record_ids`** — overloads the paginated list response with a different schema; a dedicated `/totals` sub-resource keeps both contracts clean. (Panel-agreed fix of the spec's original contradictory framing.)
- **Rejected: add `total_paid` to `RecordResponse` via correlated subquery in the records list** (simplicity panelist's proposal) — genuinely fewer moving parts (no new endpoint/client function/query cache), but rejected because: (1) it changes the `GET /records` contract for every consumer while only RecordsContext needs the sum; (2) a correlated subquery per row in the records list couples payment aggregation to records pagination/filtering, including any future server-side date filtering; (3) `ClientCardModal` and future consumers may need totals for record sets that did not come through the records list endpoint. The standalone aggregate keyed by explicit IDs is the more decoupled contract.
- **Rejected: POST with body for the ID list** — no benefit at page-sized cardinality (≤200 IDs ≈ ≤8 KB URL); GET keeps react-query/caching semantics simple.
- **Rejected: extend generic repository `filters` with `IN` support** — YAGNI, one consumer.

## Non-Goals

- No batch raw-payments endpoint.
- No changes to detail panel payment list.
- No server-side date filtering for records (see above).
- No changes to payment CRUD semantics.

## Acceptance Criteria

- [ ] `GET /api/v1/payments/totals?record_ids=...` returns `{ totals: { record_id: sum } }` computed in SQL (IN + GROUP BY + SUM); route declared before `/payments/{payment_id}`.
- [ ] Records with no payments are absent from the map (frontend treats missing key as 0). Empty `record_ids` → 200 `{ "totals": {} }`; over the cardinality cap → 422. Both tested.
- [ ] RecordsContext no longer calls unfiltered `getPayments`; totals query key includes sorted record IDs; query disabled when no records loaded.
- [ ] Payment status column + sorting show correct values with >100 payments in DB (regression test or E2E).
- [ ] ClientCardModal "Потрачено" uses server `total_paid` (deliberate semantic change: now includes cancelled records' payments, matching the Clients page).
- [ ] Domain rules `payments.md` updated with the new endpoint (via docser at IMPL).
- [ ] Backend tests: totals endpoint (multiple records, record without payments, empty record_ids → 200 `{}`, over-cap → 422).
- [ ] Frontend tests: RecordsContext totals wiring; RecordsTable status/sort against totals map; ClientCardModal total_paid.

## Visual Compliance Checks

- [ ] "Оплата" column on Records page shows ✓ Оплачено / Частично / Не оплачено for visible records.
- [ ] Sorting by "Оплата" reorders rows by payment status/sum.
- [ ] ClientCardModal shows "Потрачено" figure and per-record payment statuses in history.
- [ ] Record detail panel still lists payments with amount + method.
