# Payments Batch Aggregate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unfiltered `getPayments({ per_page: 100 })` call in RecordsContext with a backend SQL batch aggregate (`GET /api/v1/payments/totals?record_ids=...`), so payment statuses, sorting, and ClientCardModal record statuses stay correct when the payments table exceeds 100 rows (GH #186).

**Architecture:** New dedicated FastAPI route `GET /payments/totals` (declared BEFORE `/payments/{payment_id}`) backed by a module-level service function `get_payment_totals` using SQLAlchemy `IN` + `GROUP BY` + `SUM` — the `list_clients_with_stats` pattern. Frontend: RecordsContext swaps the global payments query for a totals query keyed by visible record IDs, and changes the context field `payments` from `Map<string, PaymentResponse[]>` to `Map<string, number>` (record_id → paid sum), updating the three consumers. Out of scope: GH #191 (records date filter), GH #192 (ClientCardModal "Потрачено" semantics — it automatically inherits the corrected map).

**Tech Stack:** FastAPI + SQLAlchemy (async) + Pydantic, pytest + TestClient; Next.js 14 + TypeScript + @tanstack/react-query v5 + zod (api-client), vitest + @testing-library/react.

**Spec:** `docs/specs/2026-07-29-payments-batch-aggregate-design.md` (G1b approved 2026-07-29)

---

## Behavioral Delta

How this feature behaves for the user, mapped to spec acceptance criteria:

- **`GET /api/v1/payments/totals?record_ids=...` returns `{ totals: { record_id: sum } }` computed in SQL** → New backend endpoint; no direct user-visible change, but it's what makes the rest correct at any data volume.
- **Records with no payments absent from the map; empty `record_ids` → 200 `{}`; over-cap → 422** → API behaves predictably; admins never see an error from this (frontend never sends empty/over-cap requests).
- **RecordsContext no longer calls unfiltered `getPayments`; totals query keyed by sorted record IDs** → No user-visible change in normal use; the bug fix shows only when data grows.
- **Payment status column + sorting correct with >100 payments in DB** → On "Записи", the "Оплата" column (✓ Оплачено / Частично / Не оплачено) and sorting by it always reflect the real sums, even with hundreds of payments in the system. Previously they silently lied once payments exceeded 100 rows.
- **ClientCardModal per-record payment statuses from the totals map; "Потрачено" unchanged semantically (deferred to #192)** → In the client card, each record's paid amount is now correct; "Потрачено" keeps today's definition but now sums correct per-record amounts.
- **Detail panel unchanged** → Clicking a record still lists its payments (amount + method) as before.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/schemas/payment.py` | modify | Add `PaymentTotalsResponse` schema |
| `backend/src/services/payment.py` | modify | Add module-level `get_payment_totals(session, record_ids)` |
| `backend/src/api/v1/payments.py` | modify | Add `GET /totals` route BEFORE `/{payment_id}` |
| `backend/tests/test_api_payments.py` | modify | API tests for the totals endpoint |
| `packages/api-client/src/schemas.ts` | modify | Add `PaymentTotalsResponseSchema` (zod) |
| `packages/api-client/src/endpoints.ts` | modify | Add `getPaymentTotals(recordIds)` |
| `packages/api-client/src/index.ts` (or wherever schemas are re-exported) | verify/modify | Export new function/schema |
| `frontend/admin/contexts/RecordsContext.tsx` | modify | Replace payments query + lookup map with totals query + `Map<string, number>` |
| `frontend/admin/app/(main)/records/components/RecordsTable.tsx` | modify | Use `payments.get(id) ?? 0` (number) in sort + `paidForRecord` |
| `frontend/admin/app/(main)/records/components/ClientCardModal.tsx` | modify | `paidAmount` from totals map |
| `frontend/admin/__tests__/RecordsContext.test.tsx` | modify | Mock `getPaymentTotals`, assert wiring |
| `frontend/admin/__tests__/RecordsTable.test.tsx` | modify | Update context mock to `Map<string, number>` |
| `frontend/admin/__tests__/ClientCardModal.test.tsx` | modify | Update context mock likewise |
| `docs/domain-rules/payments.md` | modify (docser, IMPL Step 5) | Document new endpoint |

---

## Task 1: Backend — `GET /api/v1/payments/totals` endpoint

### Classification: standard

### Required Docs
- `docs/specs/2026-07-29-payments-batch-aggregate-design.md` — backend section (route ordering, hard-delete, cardinality cap, empty-list behavior)
- `docs/domain-rules/payments.md` — payment fields/invariants
- Skill: `pytest-patterns` — fixtures/factories, TestClient conventions
- Skill: `test-driven-development` — RED-GREEN-REFACTOR

### Task Description

Add a batch aggregate endpoint that returns per-record payment sums for a list of record IDs.

**Exact changes:**

1. **`backend/src/schemas/payment.py`** — add at the end:
```python
class PaymentTotalsResponse(BaseModel):
    totals: dict[str, int]
```

2. **`backend/src/services/payment.py`** — add a module-level function (NOT a `PaymentService` method), after the `PaymentService` class:
```python
async def get_payment_totals(
    db_session: AsyncSession,
    record_ids: list[str],
) -> dict[str, int]:
    """Return {record_id: sum(amount)} for the given record IDs. Payments are hard-deleted — no is_active filter."""
    if not record_ids:
        return {}
    stmt = (
        select(Payment.record_id, func.sum(Payment.amount))
        .where(Payment.record_id.in_(record_ids))
        .group_by(Payment.record_id)
    )
    result = await db_session.execute(stmt)
    return {row[0]: row[1] for row in result.all()}
```
(`func`, `select`, `AsyncSession`, `Payment` are already imported in this file.)

3. **`backend/src/api/v1/payments.py`** — add the route **immediately BEFORE** the existing `@router.get("/{payment_id}", ...)` (line 42). Route ordering is critical: FastAPI matches in declaration order, so `/totals` must be declared before `/{payment_id}` or "totals" is captured as a payment_id.
```python
@router.get("/totals", response_model=PaymentTotalsResponse)
async def get_payment_totals_route(
    session: SessionDep,
    record_ids: Annotated[list[str], Query(max_length=200)] = [],
) -> PaymentTotalsResponse:
    totals = await get_payment_totals(db_session=session, record_ids=record_ids)
    return PaymentTotalsResponse(totals=totals)
```
Import updates in that file: add `get_payment_totals` to the `from src.services.payment import ...` line (currently imports only `get_payment_service`), and add `PaymentTotalsResponse` to the `from src.schemas.payment import ...` line. `Annotated` and `Query` are already imported.

4. **Tests — `backend/tests/test_api_payments.py`** — new test class, reusing the existing `_create_record` helper (lines 49–84) and payload conventions:
```python
class TestPaymentTotals:
    def _create_payment(self, api_client, record_id: str, amount: int) -> None:
        response = api_client.post("/api/v1/payments", json={**PAYMENT_PAYLOAD, "record_id": record_id, "amount": amount})
        assert response.status_code == 201

    def test_totals_multiple_records(self, api_client) -> None:
        r1, r2 = _create_record(api_client), _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        self._create_payment(api_client, r1, 1500)
        self._create_payment(api_client, r2, 2000)
        response = api_client.get("/api/v1/payments/totals", params=[("record_ids", r1), ("record_ids", r2)])
        assert response.status_code == 200
        assert response.json() == {"totals": {r1: 4500, r2: 2000}}

    def test_totals_record_without_payments_absent(self, api_client) -> None:
        r1, r2 = _create_record(api_client), _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        response = api_client.get("/api/v1/payments/totals", params=[("record_ids", r1), ("record_ids", r2)])
        assert response.status_code == 200
        assert response.json() == {"totals": {r1: 3000}}

    def test_totals_empty_record_ids_returns_empty(self, api_client) -> None:
        response = api_client.get("/api/v1/payments/totals")
        assert response.status_code == 200
        assert response.json() == {"totals": {}}

    def test_totals_over_cap_returns_422(self, api_client) -> None:
        params = [("record_ids", f"rec-{i}") for i in range(201)]
        response = api_client.get("/api/v1/payments/totals", params=params)
        assert response.status_code == 422

    def test_totals_excludes_deleted_payments(self, api_client) -> None:
        r1 = _create_record(api_client)
        self._create_payment(api_client, r1, 3000)
        list_resp = api_client.get("/api/v1/payments", params={"record_id": r1})
        payment_id = list_resp.json()["items"][0]["id"]
        del_resp = api_client.delete(f"/api/v1/payments/{payment_id}")
        assert del_resp.status_code == 204
        response = api_client.get("/api/v1/payments/totals", params=[("record_ids", r1)])
        assert response.status_code == 200
        assert response.json() == {"totals": {}}
```

### Steps
- [ ] Write the failing test class `TestPaymentTotals` (RED) — endpoint doesn't exist yet
- [ ] Run `cd backend && pytest tests/test_api_payments.py::TestPaymentTotals -x` — confirm all 5 fail (404)
- [ ] Add `PaymentTotalsResponse` schema
- [ ] Add `get_payment_totals` service function
- [ ] Add the `/totals` route BEFORE `/{payment_id}`
- [ ] Run `cd backend && pytest tests/test_api_payments.py::TestPaymentTotals -x` — all 5 pass (GREEN)
- [ ] Regression: verify route ordering didn't break the detail route — run `cd backend && pytest tests/test_api_payments.py -x` (whole file passes)
- [ ] Run full backend suite: `cd backend && pytest` — all pass (baseline: 787 passed, 3 skipped)
- [ ] Commit: `feat(backend): add GET /payments/totals batch aggregate endpoint (#186)`

### DoD
- All 5 new tests pass; full backend suite green; route declared before `/{payment_id}`.

---

## Task 2: API client — `getPaymentTotals`

### Classification: small

### Required Docs
- `docs/specs/2026-07-29-payments-batch-aggregate-design.md` — API client section
- Skill: `test-driven-development`

### Task Description

1. **`packages/api-client/src/schemas.ts`** — add near the payment schemas:
```typescript
export const PaymentTotalsResponseSchema = z.object({
  totals: z.record(z.string(), z.number()),
});
export type PaymentTotalsResponse = z.infer<typeof PaymentTotalsResponseSchema>;
```
Note: use the two-argument form `z.record(z.string(), z.number())` — check how other `z.record` usages (if any) are written in this file and match; zod v3's single-arg `z.record(z.number())` also works, match existing style.

2. **`packages/api-client/src/endpoints.ts`** — add next to `getPayments`:
```typescript
export async function getPaymentTotals(recordIds: string[]): Promise<Record<string, number>> {
  const search = new URLSearchParams();
  recordIds.forEach((id) => search.append('record_ids', id));
  const qs = search.toString();
  const res = await api(`/api/v1/payments/totals${qs ? `?${qs}` : ''}`, PaymentTotalsResponseSchema);
  return res.totals;
}
```
Add `PaymentTotalsResponseSchema` to the schemas import in this file.

3. **Exports** — check `packages/api-client/src/index.ts` (or the package's entry point): if `getPayments`/`PaymentResponseSchema` are re-exported there, add `getPaymentTotals` and `PaymentTotalsResponseSchema`/`PaymentTotalsResponse` the same way.

4. **Tests** — the api-client package has tests (`schemas.test.ts` — note: it has 4 known failures from #188, unrelated). If there is an endpoints test file covering `getPayments` (search `packages/api-client` for `getPayments` in tests), add a mirrored test for `getPaymentTotals`: mock fetch returning `{ totals: { r1: 4500 } }`, assert URL contains repeated `record_ids` params and the return value is the plain map. If no endpoint-level test file exists for payments, add schema parse coverage for `PaymentTotalsResponseSchema` where other payment schemas are tested instead.

### Steps
- [ ] Find existing test coverage for `getPayments`/payment schemas: `grep -rn "getPayments\|PaymentResponseSchema" packages/api-client/src packages/api-client/*.test.ts packages/api-client/tests 2>/dev/null`
- [ ] Write the failing test (RED)
- [ ] Add zod schema + type
- [ ] Add `getPaymentTotals`
- [ ] Wire exports
- [ ] Run the package's test suite (check `packages/api-client/package.json` for the test script; expected: same pass/fail as baseline — 136 passed / 4 failed where the 4 are the known #188 `schemas.test.ts` datetime failures; no NEW failures)
- [ ] Build/typecheck the package if it has a build script (`npm run build` or `tsc`) — must pass
- [ ] Commit: `feat(api-client): add getPaymentTotals batch aggregate client (#186)`

### DoD
- New function + schema exported; package tests show no new failures vs baseline (136p/4f known #188); typecheck passes.

---

## Task 3: Frontend — RecordsContext totals wiring

### Classification: standard

### Required Docs
- `docs/specs/2026-07-29-payments-batch-aggregate-design.md` — RecordsContext section (query key, enabled flag, error fallback)
- Skill: `vitest-playwright-patterns` — context mocking, shared factories
- Skill: `test-driven-development`

### Task Description

In `frontend/admin/contexts/RecordsContext.tsx`:

1. **Interface change** (lines 26–37): change the field type
```typescript
payments: Map<string, number>;  // record_id → total paid amount (was Map<string, PaymentResponse[]>)
```

2. **Replace the query** (lines 94–98): remove the global `getPayments` query. Add:
```typescript
// Payment totals for the currently loaded records (batch aggregate — replaces unfiltered getPayments, #186)
const recordIds = useMemo(() => records.map((r) => r.id).sort(), [records]);
const { data: paymentTotals } = useQuery({
  queryKey: ['payments', 'totals', recordIds],
  queryFn: () => getPaymentTotals(recordIds),
  enabled: recordIds.length > 0,
});
```
Place this AFTER the `records` query in the file (it depends on `records`). Check the actual variable name of the records array in the file (it may be built via `useMemo` from a `recordsRaw`) and use that.

3. **Replace the lookup map** (lines 131–139):
```typescript
const payments = useMemo(() => {
  const map = new Map<string, number>();
  if (paymentTotals) {
    Object.entries(paymentTotals).forEach(([recordId, total]) => map.set(recordId, total));
  }
  return map;
}, [paymentTotals]);
```

4. **Imports**: replace `getPayments` with `getPaymentTotals` in the `@memo/api-client` import; remove the now-unused `PaymentResponse` import if nothing else in the file uses it (check first).

5. **Drive-by type fix** (from spec panel): line 88 types `clientsRaw` as `ClientResponse[]` but `getClients()` returns `ClientWithStats[]` — correct the annotation to `ClientWithStats[]` (import the type from `@memo/api-client`).

6. **Behavior notes** (per spec):
   - While totals are loading or the query failed, `payments` is an empty map → consumers show "Не оплачено" (missing key → 0). This matches the spec's error-fallback decision; no new UI.
   - Query key contains sorted IDs → self-invalidating when the record set changes (period switch).

7. **Tests — `frontend/admin/__tests__/RecordsContext.test.tsx`**:
   - Update the `vi.mock('@memo/api-client', ...)` block: remove `getPayments`, add `getPaymentTotals: vi.fn()`.
   - In `beforeEach` (or wherever mocks are set): `vi.mocked(getPaymentTotals).mockResolvedValue({ 'rec-1': 3000 })` (shape: plain object record_id → number).
   - Update/add tests:
     - "fetches payment totals for loaded record IDs" — assert `getPaymentTotals` called with the sorted IDs of the mocked records, and `result.current.payments.get('rec-1') === 3000`.
     - "does not fetch totals when no records loaded" — mock records empty, assert `getPaymentTotals` NOT called (`enabled` flag).
     - "record without payments has no entry" — assert `payments.get('rec-without')` is `undefined`.
     - Remove obsolete tests asserting the old `PaymentResponse[]` map shape.

### Steps
- [ ] Update the failing tests first (RED): mock changes + new assertions — run `cd frontend/admin && npx vitest run __tests__/RecordsContext.test.tsx` → fail (getPaymentTotals not a function / old shape)
- [ ] Implement context changes (1–5)
- [ ] Run `cd frontend/admin && npx vitest run __tests__/RecordsContext.test.tsx` → green (GREEN)
- [ ] Typecheck will fail in consumers (RecordsTable/ClientCardModal still use old shape) — EXPECTED at this point; fixed in Task 4. Confirm context's own file typechecks: `cd frontend/admin && npx tsc --noEmit 2>&1 | grep RecordsContext` → no RecordsContext errors
- [ ] Commit: `feat(admin): RecordsContext uses payments totals aggregate (#186)`

### DoD
- RecordsContext tests green; `payments` exposed as `Map<string, number>`; no unfiltered `getPayments` call remains in the context.

---

## Task 4: Frontend — consumers (RecordsTable + ClientCardModal)

### Classification: standard

### Required Docs
- `docs/specs/2026-07-29-payments-batch-aggregate-design.md` — consumer sections + ClientCardModal scope note (#192)
- Skill: `vitest-playwright-patterns`
- Skill: `test-driven-development`

### Task Description

**RecordsTable.tsx** (`frontend/admin/app/(main)/records/components/RecordsTable.tsx`):

1. Sort case `'payment'` (lines ~170–185): replace the two reduce lines with direct map reads:
```typescript
const aPaid = payments.get(a.id) ?? 0;
const bPaid = payments.get(b.id) ?? 0;
```
(rest of the case — `aTot2`/`bTot2` totals and level computation — unchanged)

2. `paidForRecord` (lines ~216–217):
```typescript
const paidForRecord = (recordId: string): number => payments.get(recordId) ?? 0;
```

3. Payment column (lines ~400–414): unchanged — it already consumes `paid`/`total` numbers. Verify no other place in the file iterates `payments.get(...)` as an array (search the file for `payments.get` after the edits — all usages must treat the value as `number | undefined`).

**ClientCardModal.tsx** (`frontend/admin/app/(main)/records/components/ClientCardModal.tsx`):

1. In `recordDetails` (lines ~40–54): replace
```typescript
const recordPayments = payments.get(record.id) ?? [];
const paidAmount = recordPayments.reduce((s, p) => s + p.amount, 0);
```
with
```typescript
const paidAmount = payments.get(record.id) ?? 0;
```
2. **Do NOT change `totalSpent`** (the `.filter(d => d.record.status !== 'cancelled').reduce(...)` lines) — its semantics are GH #192, out of scope. It automatically inherits the corrected per-record amounts.
3. Search the file for other `payments` usages — update any remaining array-shaped access.

**Tests:**

- `frontend/admin/__tests__/RecordsTable.test.tsx` — the mock context value (lines ~127–142) currently has `payments: new Map([['rec-1', [mockPayment]]])`. Change to `payments: new Map([['rec-1', mockPayment.amount]])` (number). Remove `mockPayment` if unused afterward, or keep it if other tests use it. Verify existing payment-column/sort tests still pass; add/adjust:
  - "record with no entry in totals map renders Не оплачено" (record id absent from map).
  - Sort test: two records where map values produce paid/partial/unpaid levels — assert order.
- `frontend/admin/__tests__/ClientCardModal.test.tsx` — update its context mock the same way (`Map<string, number>`); update assertions that built on payment arrays (e.g. per-record paid amounts). `totalSpent` assertions keep the same expected numbers if the mocked sums match the old array sums.

### Steps
- [ ] Update both test files' mocks/assertions (RED) — run `cd frontend/admin && npx vitest run __tests__/RecordsTable.test.tsx __tests__/ClientCardModal.test.tsx` → fail
- [ ] Implement RecordsTable changes
- [ ] Implement ClientCardModal changes
- [ ] Re-run the two test files → green (GREEN)
- [ ] Full typecheck: `cd frontend/admin && npx tsc --noEmit` → clean
- [ ] Full unit suite: `cd frontend/admin && npm run test` → all green
- [ ] UI touched → full suite incl. E2E: `cd frontend/admin && npm run test:all` → green (per dispatch rules)
- [ ] Commit: `feat(admin): payment status consumers use totals map (#186)`

### DoD
- All unit tests green; typecheck clean; `npm run test:all` green; no `payments.get(...)` treated as array anywhere.

---

## Task 5: Regression guard — >100 payments correctness

### Classification: small

### Required Docs
- `docs/specs/2026-07-29-payments-batch-aggregate-design.md` — AC: "correct values with >100 payments in DB"
- Skill: `vitest-playwright-patterns`

### Task Description

The architectural fix makes the >100 regression structurally impossible (totals computed in SQL, no per_page cap involved). Guard it at the level where the old bug lived:

**Backend** (in `backend/tests/test_api_payments.py`, extend `TestPaymentTotals`):
```python
def test_totals_not_limited_by_list_pagination(self, api_client) -> None:
    """Regression #186: aggregate must include payments beyond the per_page<=100 list cap."""
    r1 = _create_record(api_client)
    for _ in range(105):
        self._create_payment(api_client, r1, 100)
    response = api_client.get("/api/v1/payments/totals", params=[("record_ids", r1)])
    assert response.status_code == 200
    assert response.json() == {"totals": {r1: 10500}}
```

**Frontend** (in `frontend/admin/__tests__/RecordsContext.test.tsx`): a test asserting the context NEVER calls the unfiltered list endpoint for payment status purposes:
- In the api-client mock, keep `getPayments: vi.fn()` mocked (even though the context no longer imports it, the mock proves non-use) — assert `expect(getPayments).not.toHaveBeenCalled()` after context mount with records loaded, while `getPaymentTotals` WAS called. If the mock module no longer needs `getPayments` for other tests, this test still adds it explicitly.

### Steps
- [ ] Write both tests (they should PASS immediately against Tasks 1–3 — this is a characterization/regression guard, not RED-GREEN; if either fails, the earlier tasks are wrong — STOP and report BLOCKED)
- [ ] Run `cd backend && pytest tests/test_api_payments.py::TestPaymentTotals -x` → 6 tests pass
- [ ] Run `cd frontend/admin && npx vitest run __tests__/RecordsContext.test.tsx` → green
- [ ] Commit: `test: regression guard for >100 payments aggregate correctness (#186)`

### DoD
- 6 backend totals tests + frontend guard green.

---

## Self-Review

- **Spec coverage:** totals endpoint (T1) ✅; api-client (T2) ✅; RecordsContext wiring incl. enabled flag, sorted key, error fallback, type drive-by (T3) ✅; RecordsTable + ClientCardModal consumers incl. #192 scope boundary (T4) ✅; >100 regression AC (T5) ✅; domain-rules update → docser at IMPL Step 5 (noted, not a task) ✅. Visual Compliance Checks → IMPL Step 4.5.
- **Placeholders:** none — all code blocks exact.
- **Type consistency:** `PaymentTotalsResponse.totals: dict[str, int]` (backend) ↔ `z.record(z.string(), z.number())` (api-client) ↔ `Record<string, number>` returned by `getPaymentTotals` ↔ `Map<string, number>` in context — consistent.
- **Required Docs:** every task has the section, incl. entity domain rules where touched.
- **E2E anchors:** User scenarios 1–4 are covered by component-level vitest (existing suites + updated mocks); no new E2E spec is mandated by the spec's AC ("regression test OR E2E" — regression test chosen in T5). Visual compliance gate (IMPL Step 4.5) will verify scenarios live.
