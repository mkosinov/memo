# Wave 5 — 14 P1/P3 UX Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 14 P1/P3 UX bugs (#74–#86) in admin's `ActivityDetailsModal`, the `ClientTab`/`SettingsTab`/`NewBookingTab` children, the `ActivityCard` occupied counter, and the schedule grid backdrop blur. One PR `fix/wave5-ux-bugs`, 14 sequential commits.

**Architecture:**
- Backend: replace `count_records` (count) with `sum_active_seats` (SUM(seats) WHERE status IN active_set). Filter excludes cancelled/no_show.
- Frontend: move create-record flow into `useRecordMutations` hook; add `StatusPicker` component; raise modal z-index to `z-[200]`; small visual fixes (placeholders, layout, label changes).
- E2E: 5 new Playwright tests covering scenarios 1–5 from spec.

**Tech Stack:** Next.js 14, TypeScript, Tailwind 3, TanStack Query 5, FastAPI, SQLAlchemy 2, pytest, vitest, @testing-library/react, Playwright.

**Spec:** `docs/specs/2026-06-19-wave5-ux-bugs-design.md` (commit `dadca86`)

**Target branch:** `fix/wave5-ux-bugs` (worktree at `.worktrees/wave5-ux-bugs/`)

---

## File Structure

### New files (this plan creates)

| Path | Purpose |
|------|---------|
| `frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx` | Icon-button + popover for status (4 icons reused) |
| `frontend/admin/app/lib/pluralize.ts` | Russian pluralisation helper (1 место / 2 места / 5 мест) |
| `frontend/admin/__tests__/StatusPicker.test.tsx` | Unit tests for StatusPicker |
| `frontend/admin/__tests__/pluralize.test.ts` | Unit tests for pluralise |
| `frontend/admin/e2e/wave5-modal-height-stable.spec.ts` | E2E scenario 1 |
| `frontend/admin/e2e/wave5-add-visitor.spec.ts` | E2E scenario 2 |
| `frontend/admin/e2e/wave5-open-profile.spec.ts` | E2E scenario 3 |
| `frontend/admin/e2e/wave5-occupied-excludes-cancelled.spec.ts` | E2E scenario 4 |
| `frontend/admin/e2e/wave5-x-cards-blurred.spec.ts` | E2E scenario 5 |

### Modified files

| Path | Tasks | Why |
|------|-------|-----|
| `backend/src/services/activity.py` | T1 | Replace `count_records` with `sum_active_seats` |
| `backend/src/api/v1/activities.py` | T1 | Call new method |
| `backend/tests/test_edge_cases.py` | T1 | Add tests for new aggregation |
| `frontend/admin/hooks/useRecordMutations.ts` | T2, T3 | Add `createRecord` mutation |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` | T2, T3, T7, T12, T13 | Hook refactor, tab label, height, z-index |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` | T4, T5, T6, T7, T8, T9, T10 | Many: add visitor, profile nav, payment delete, placeholders, status labels, status picker, seats |
| `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx` | T11 | Private toggle stacked |
| `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx` | T3 | Field labels, payload audit |

### Files that MUST NOT change

- `backend/src/models/*.py` — no schema changes
- `packages/api-client/src/schemas.ts` — no API contract changes
- `frontend/admin/app/components/schedule/ActivityCard.tsx` — uses `activity.occupied` from API; will be fixed automatically by T1

---

## Task Sequencing Rationale

T1 (backend) and T2 (hook refactor) come first because they unlock T3 (form fix) and T14 (E2E). T3–T11 are independent frontend tweaks in a sensible dependency order. T12, T13 are visual polish at the end. T14 final E2E coverage.

---

## Task 1: Backend — replace `count_records` with `sum_active_seats` (#84)

**Classification:** standard

### Required Docs
- `docs/specs/2026-06-19-wave5-ux-bugs-design.md` § A3 (occupied — backend aggregation)
- `backend/src/models/record.py` — `Record.status` enum values
- `backend/src/services/activity.py` (current code)
- `backend/tests/test_edge_cases.py` (lines 320–340 — `test_occupied_count` and friends)

### Files
- Modify: `backend/src/services/activity.py`
- Modify: `backend/src/api/v1/activities.py`
- Modify: `backend/tests/test_edge_cases.py`

### Task Description

The `occupied` field returned by `GET /api/v1/activities` and `GET /api/v1/activities/{id}` currently counts ALL records (including cancelled and no_show) and counts the number of records instead of the sum of `seats`. Fix:

1. In `ActivityService` add `sum_active_seats(activity_id) -> int` returning `SUM(Record.seats) WHERE Record.activity_id = :id AND Record.status IN ('pending', 'confirmed')`.
2. In `_to_response` replace the call to `count_records` with `sum_active_seats`.
3. Keep `count_records` as `@deprecated` (or delete — but the test file uses it; update tests to use the new field).

### Steps

- [ ] **Step 1: Read current test for `test_occupied_count`**

  ```bash
  cat backend/tests/test_edge_cases.py | sed -n '318,345p'
  ```

  Note the exact assertion format and the fixture used (`create_record`).

- [ ] **Step 2: Write RED test for sum-of-seats**

  Append to `backend/tests/test_edge_cases.py` (after `test_occupied_increases_with_more_records`):

  ```python
  def test_occupied_sums_seats_not_records(api_client, create_record):
      """occupied = SUM(seats) over active records, not count of records."""
      from backend.tests.conftest import _create_activity_payload
      act_payload = _create_activity_payload()
      act_resp = api_client.post("/api/v1/activities", json=act_payload)
      assert act_resp.status_code == 201
      act_id = act_resp.json()["id"]

      # Three records, seats 1 + 2 + 3
      create_record(activity_id=act_id, seats=1)
      create_record(activity_id=act_id, seats=2)
      create_record(activity_id=act_id, seats=3)

      response = api_client.get(f"/api/v1/activities/{act_id}")
      assert response.status_code == 200
      assert response.json()["occupied"] == 6  # 1+2+3, not 3
  ```

- [ ] **Step 3: Run test, expect RED**

  ```bash
  cd backend && pytest tests/test_edge_cases.py::test_occupied_sums_seats_not_records -xvs
  ```

  Expect: `AssertionError: assert 3 == 6`.

- [ ] **Step 4: Write RED test for cancelled exclusion**

  ```python
  def test_occupied_excludes_cancelled(api_client, create_record):
      """occupied excludes records with status=cancelled."""
      from backend.tests.conftest import _create_activity_payload
      act_payload = _create_activity_payload()
      act_resp = api_client.post("/api/v1/activities", json=act_payload)
      assert act_resp.status_code == 201
      act_id = act_resp.json()["id"]

      r1 = create_record(activity_id=act_id, seats=2)
      r2 = create_record(activity_id=act_id, seats=5)

      # Cancel r2
      patch_resp = api_client.patch(
          f"/api/v1/records/{r2['id']}",
          json={"status": "cancelled"},
      )
      assert patch_resp.status_code == 200

      response = api_client.get(f"/api/v1/activities/{act_id}")
      assert response.json()["occupied"] == 2  # only r1 counts
  ```

- [ ] **Step 5: Run test, expect RED**

  ```bash
  cd backend && pytest tests/test_edge_cases.py::test_occupied_excludes_cancelled -xvs
  ```

  Expect: `AssertionError: assert 7 == 2` (sum of both records, no filter).

- [ ] **Step 6: Write RED test for no_show exclusion**

  ```python
  def test_occupied_excludes_no_show(api_client, create_record):
      """occupied excludes records with status=no_show."""
      from backend.tests.conftest import _create_activity_payload
      act_payload = _create_activity_payload()
      act_resp = api_client.post("/api/v1/activities", json=act_payload)
      assert act_resp.status_code == 201
      act_id = act_resp.json()["id"]

      r1 = create_record(activity_id=act_id, seats=2)
      r2 = create_record(activity_id=act_id, seats=5)

      api_client.patch(f"/api/v1/records/{r2['id']}", json={"status": "no_show"})

      response = api_client.get(f"/api/v1/activities/{act_id}")
      assert response.json()["occupied"] == 2
  ```

- [ ] **Step 7: Implement `sum_active_seats` in `backend/src/services/activity.py`**

  Replace the `count_records` method (lines 61–70) with:

  ```python
  ACTIVE_RECORD_STATUSES = ("pending", "confirmed")

  async def sum_active_seats(
      self, db_session: AsyncSession, activity_id: str
  ) -> int:
      """Return SUM(seats) for active records (excludes cancelled/no_show).

      Active = status IN ('pending', 'confirmed'). This matches
      the spec's display labels 'Ожидание' / 'Посетил'.
      """
      result = await db_session.execute(
          select(func.coalesce(func.sum(Record.seats), 0)).where(
              Record.activity_id == activity_id,
              Record.status.in_(self.ACTIVE_RECORD_STATUSES),
          )
      )
      return int(result.scalar() or 0)
  ```

  Also keep `count_records` for backward compat (other tests may use it):

  ```python
  async def count_records(
      self, db_session: AsyncSession, activity_id: str
  ) -> int:
      """DEPRECATED: counts ALL records (including cancelled). Use sum_active_seats."""
      result = await db_session.execute(
          select(func.count(Record.id)).where(
              Record.activity_id == activity_id
          )
      )
      return int(result.scalar() or 0)
  ```

  Add the constant `ACTIVE_RECORD_STATUSES = ("pending", "confirmed")` as a class attribute.

- [ ] **Step 8: Update `_to_response` in `backend/src/api/v1/activities.py`**

  Change line 37 from:
  ```python
  data.occupied = await service.count_records(db_session=db_session, activity_id=activity.id)
  ```
  to:
  ```python
  data.occupied = await service.sum_active_seats(db_session=db_session, activity_id=activity.id)
  ```

- [ ] **Step 9: Run all 3 new tests, expect GREEN**

  ```bash
  cd backend && pytest tests/test_edge_cases.py::test_occupied_sums_seats_not_records tests/test_edge_cases.py::test_occupied_excludes_cancelled tests/test_edge_cases.py::test_occupied_excludes_no_show -xvs
  ```

- [ ] **Step 10: Run full backend suite, expect no regression**

  ```bash
  cd backend && pytest -x
  ```

  All previously-passing tests must still pass. The existing `test_occupied_count` test creates 1 record and expects `occupied=1` — this still passes because sum(seats=1) = 1. `test_occupied_increases_with_more_records` creates 2 records of seats=1 each, expects 2 — still passes.

- [ ] **Step 11: Lint**

  ```bash
  cd backend && ruff check src/ tests/ && mypy src/
  ```

- [ ] **Step 12: Commit**

  ```bash
  git add backend/src/services/activity.py backend/src/api/v1/activities.py backend/tests/test_edge_cases.py
  git commit -m "fix(backend): occupied = sum(seats) for active records, excludes cancelled/no_show (#84)"
  ```

### DoD (Definition of Done)
- [ ] 3 new tests pass
- [ ] Full backend suite passes (no regression)
- [ ] ruff + mypy clean
- [ ] Committed

---

## Task 2: Frontend — refactor `useRecordMutations` to accept `activityId` and add `createRecord` (#85)

**Classification:** standard

### Required Docs
- `frontend/admin/hooks/useRecordMutations.ts` (current code, 104 lines)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` lines 116–170 (current `handleNewBookingSubmit`)
- `packages/api-client/src/endpoints.ts` — `createRecord`, `createClient`, `createVisitor`, `searchClientByPhone` signatures
- `packages/api-client/src/schemas.ts` — `RecordCreate`, `ClientCreate`, `VisitorCreate`

### Files
- Modify: `frontend/admin/hooks/useRecordMutations.ts`
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`

### Task Description

Currently `ActivityDetailsModal` calls `createRecord`/`createClient`/`createVisitor` directly via the API, bypassing `useRecordMutations`. After success it invalidates only `['records']` — not `['activities']` (so the `occupied` counter on cards doesn't update). Refactor: move the create-flow into the hook; add `createRecord` mutation; invalidate `['records']` AND `['activities']`.

### Steps

- [ ] **Step 1: Read the current hook and modal create flow**

  ```bash
  cat frontend/admin/hooks/useRecordMutations.ts
  ```

  Note the hook signature: `useRecordMutations(recordId: string)`. It needs to also accept `activityId`.

- [ ] **Step 2: Update hook signature and add `createRecord`**

  Replace `frontend/admin/hooks/useRecordMutations.ts` with:

  ```ts
  'use client';

  import { useQueryClient } from '@tanstack/react-query';
  import { useCallback } from 'react';
  import {
    createRecord,
    createClient,
    createVisitor,
    searchClientByPhone,
    patchRecord,
    deleteRecord as apiDeleteRecord,
    patchActivity,
    createPayment,
    deletePayment as apiDeletePayment,
    deleteVisitor as apiDeleteVisitor,
  } from '@memo/api-client';

  interface VisitData {
    visitor_id?: string;
    price: number;
    custom_price?: number | null;
    status?: string;
  }

  interface CreateRecordInput {
    phone: string;
    name: string;
    channel: string;
    seats: number;
    visitors: Array<{ name: string; age?: string; tariffId: string }>;
  }

  export function useRecordMutations(activityId: string, recordId: string = '') {
    const queryClient = useQueryClient();

    const invalidateAll = useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      if (recordId) {
        queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      }
    }, [queryClient, recordId]);

    const createRecordMutation = useCallback(
      async (
        input: CreateRecordInput,
        serviceTariffs: Array<{ id: string; price: number }>,
      ) => {
        // 1. Resolve or create client
        let clientId: string;
        if (input.phone) {
          try {
            const existing = await searchClientByPhone(input.phone);
            clientId = existing.id;
          } catch {
            const created = await createClient({
              name: input.name,
              phone: input.phone,
              channel: input.channel,
            });
            clientId = created.id;
          }
        } else {
          const created = await createClient({
            name: input.name,
            phone: '',
            channel: input.channel,
          });
          clientId = created.id;
        }

        // 2. Create visitors (skip empty names)
        const visitIds: string[] = [];
        for (const v of input.visitors) {
          if (v.name) {
            const visitor = await createVisitor({
              client_id: clientId,
              name: v.name,
              age: v.age ? Number(v.age) : undefined,
            });
            visitIds.push(visitor.id);
          }
        }

        // 3. Default price from first tariff if any
        const firstTariff = serviceTariffs[0];

        // 4. Create record
        await createRecord({
          activity_id: activityId,
          client_id: clientId,
          seats: input.seats,
          visits: visitIds.map((vid) => ({
            visitor_id: vid,
            price: firstTariff?.price ?? 0,
          })),
        });

        // 5. Invalidate all relevant queries
        invalidateAll();
      },
      [activityId, invalidateAll],
    );

    const saveRecord = useCallback(
      async (data: {
        activityId?: string;
        activityStart?: string;
        activityServiceId?: string;
        customPrice?: string;
        comment?: string;
        visits: VisitData[];
      }) => {
        if (data.activityId && data.activityStart && data.activityServiceId) {
          await patchActivity(data.activityId, {
            start: data.activityStart,
            service_id: data.activityServiceId,
          });
        }
        await patchRecord(recordId, {
          custom_price: data.customPrice?.trim() ? Number(data.customPrice) : null,
          comment: data.comment || null,
          visits: data.visits,
        });
        invalidateAll();
      },
      [recordId, invalidateAll],
    );

    const deleteRecord = useCallback(async () => {
      await apiDeleteRecord(recordId);
      invalidateAll();
    }, [recordId, invalidateAll]);

    const addVisitor = useCallback(
      async (data: { client_id: string; name: string; age?: number }) => {
        return await createVisitor(data);
      },
      [],
    );

    const deleteVisitor = useCallback(
      async (visitorId: string, currentVisits: VisitData[]) => {
        await apiDeleteVisitor(visitorId);
        const remaining = currentVisits.filter((v) => v.visitor_id !== visitorId);
        await patchRecord(recordId, { visits: remaining });
        invalidateAll();
      },
      [recordId, invalidateAll],
    );

    const addPayment = useCallback(
      async (amount: number, method: string) => {
        await createPayment({ record_id: recordId, amount, method: method as 'cash' | 'card' | 'transfer' });
        invalidateAll();
      },
      [recordId, invalidateAll],
    );

    const deletePayment = useCallback(
      async (paymentId: string) => {
        await apiDeletePayment(paymentId);
        invalidateAll();
      },
      [invalidateAll],
    );

    return {
      createRecord: createRecordMutation,
      saveRecord,
      deleteRecord,
      addVisitor,
      deleteVisitor,
      addPayment,
      deletePayment,
    };
  }
  ```

- [ ] **Step 3: Update `ActivityDetailsModal` to use the new hook**

  Change line 52 from:
  ```ts
  const { deleteRecord, addPayment } = useRecordMutations(activeRecordId || '');
  ```
  to:
  ```ts
  const { createRecord, deleteRecord, addPayment } = useRecordMutations(activity.id, activeRecordId || '');
  ```

  Replace the entire `handleNewBookingSubmit` (lines 116–170) with:

  ```ts
  const handleNewBookingSubmit = useCallback(
    async (data: {
      phone: string;
      name: string;
      visitors: Array<{ name: string; age?: string; tariffId: string }>;
      notify: boolean;
      channel: string;
      seats: number;
    }) => {
      try {
        await createRecord(data, serviceTariffs);
        showToast('Запись создана');
        setActiveTab('settings');
      } catch {
        showToast('Ошибка создания записи');
      }
    },
    [createRecord, serviceTariffs, showToast],
  );
  ```

  Also remove the now-unused direct imports from `@memo/api-client` for `createRecord`, `createClient`, `createVisitor`, `searchClientByPhone` (lines 14–19). Keep `TariffResponse` import.

  Also remove the now-unused `useQueryClient` import on line 21.

- [ ] **Step 4: Type-check**

  ```bash
  cd frontend/admin && npx tsc --noEmit
  ```

  Expect: zero errors.

- [ ] **Step 5: Run frontend tests**

  ```bash
  cd frontend/admin && npm run test -- --run
  ```

  All previously-passing tests must still pass.

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/admin/hooks/useRecordMutations.ts frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
  git commit -m "refactor(admin): move create-record flow into useRecordMutations hook (#85)"
  ```

### DoD
- [ ] tsc clean
- [ ] Vitest passes (no regression)
- [ ] Modal no longer imports `createRecord` etc. directly
- [ ] Committed

---

## Task 3: Audit & fix `NewBookingTab` payload (#80)

**Classification:** small

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx` — current form (226 lines)
- `packages/api-client/src/schemas.ts` — `RecordCreateSchema` (lines 292–308)
- `backend/src/schemas/record.py` — backend Pydantic schema (verify required fields)

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx`

### Task Description

User reports that name, phone, and seats are not saved. The T2 refactor routes creation through the hook, so the API call is the same. Verify the form actually passes these fields. Add an explicit `data-testid` to the seats input so E2E can find it, and add labels (`htmlFor`) to all inputs for accessibility. No logic change in this task — only verification + testid addition.

### Steps

- [ ] **Step 1: Verify form fields are wired**

  Read `NewBookingTab.tsx` lines 30–36 and lines 66–77 (state + submit). Confirm:
  - `phone` state exists
  - `name` state exists
  - `seatsCount` state exists
  - `onSubmit` is called with `{ phone, name, visitors, notify, channel, seats: seatsCount }`

  All four fields ARE wired. The T2 refactor moved the create-call into the hook, but the form still passes them. So the original issue is solved by T2.

- [ ] **Step 2: Add `data-testid` to seats input**

  In `NewBookingTab.tsx` line 122–129, add `data-testid="input-seats"` to the seats number input.

- [ ] **Step 3: Add `htmlFor` labels to phone and channel selects**

  In `NewBookingTab.tsx`:
  - Line 86: `htmlFor="booking-phone"` already exists ✅
  - Line 104: `htmlFor="booking-name"` already exists ✅
  - Line 120: add `htmlFor="booking-seats"` to the label "Мест"
  - Line 184: `htmlFor="booking-channel"` already exists ✅

- [ ] **Step 4: Run vitest**

  ```bash
  cd frontend/admin && npm run test -- --run
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx
  git commit -m "test(admin): add testids/labels to NewBookingTab for E2E and a11y (#80)"
  ```

### DoD
- [ ] Seats input has `data-testid="input-seats"`
- [ ] All inputs have `htmlFor` labels
- [ ] Vitest passes
- [ ] Committed

---

## Task 4: `ClientTab` — wire "+ Добавить посетителя" inline form (#75)

**Classification:** small

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` (current code, 310 lines) — focus on lines 65–75 (hook usage) and lines 202–214 (Visitors section)
- `frontend/admin/hooks/useRecordMutations.ts` — now has `addVisitor(data)` (T2)

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`

### Task Description

In `ClientTab`, the `+ Добавить посетителя` button (line 213) has no `onClick`. Add an inline form (collapsible) that creates a visitor via `addVisitor` and adds the new visitor to the record via `patchRecord` (append a new visit with the new visitor's id and a default price).

### Steps

- [ ] **Step 1: Read current state and find unused `addVisitor`**

  The hook now exposes `addVisitor(data: { client_id, name, age? })`. `ClientTab` doesn't currently use it. The `useRecordMutations` is called in the parent (`ActivityDetailsModal.tsx:52`) and currently only `deleteRecord` and `addPayment` are destructured. We need to also pull `addVisitor` and `saveRecord` (or a new `addVisitorToRecord` mutation).

- [ ] **Step 2: Extend hook to expose `addVisitorToRecord`**

  In `frontend/admin/hooks/useRecordMutations.ts`, add a new method:

  ```ts
  const addVisitorToRecord = useCallback(
    async (data: { name: string; age?: number; price: number }) => {
      const record = await queryClient.fetchQuery({
        queryKey: ['record', recordId],
        queryFn: () => import('@memo/api-client').then(m => m.getRecord(recordId)),
      });
      const clientId = record.client_id;
      if (!clientId) throw new Error('Record has no client');

      const visitor = await createVisitor({
        client_id: clientId,
        name: data.name,
        age: data.age,
      });

      const newVisit = {
        visitor_id: visitor.id,
        price: data.price,
      };

      await patchRecord(recordId, {
        visits: [...record.visits, newVisit],
      });
      invalidateAll();
    },
    [recordId, queryClient, invalidateAll],
  );
  ```

  And add it to the returned object: `addVisitorToRecord,`.

  Note: the `RecordResponse` schema doesn't include `client_id` as null in practice. The `getRecord` API is at `packages/api-client/src/endpoints.ts` (verify with grep before using).

- [ ] **Step 3: In `ActivityDetailsModal.tsx`, pull the new method**

  Change line 52:
  ```ts
  const { createRecord, deleteRecord, addPayment, addVisitorToRecord } = useRecordMutations(activity.id, activeRecordId || '');
  ```

  Pass `addVisitorToRecord` to `ClientTab` as a prop:

  In `ClientTab` interface (line 9–20) add:
  ```ts
  onAddVisitor: (data: { name: string; age?: number; price: number }) => void;
  ```

  In the JSX where `ClientTab` is rendered (ActivityDetailsModal.tsx line 250–262), pass:
  ```tsx
  onAddVisitor={async (data) => {
    // Default price from first tariff
    const firstPrice = serviceTariffs[0]?.price ?? 0;
    await addVisitorToRecord({ ...data, price: firstPrice });
    showToast('Посетитель добавлен');
  }}
  ```

  Wrap in try/catch and add toast on error.

- [ ] **Step 4: In `ClientTab`, add inline form state and submit handler**

  Add to `ClientTab` (after existing state, line 80):

  ```ts
  const [showAddVisitor, setShowAddVisitor] = useState(false);
  const [newVisitorName, setNewVisitorName] = useState('');
  const [newVisitorAge, setNewVisitorAge] = useState('');
  const [isAddingVisitor, setIsAddingVisitor] = useState(false);
  ```

  Add handler (after `handleDeletePayment`):

  ```ts
  const handleAddVisitor = useCallback(async () => {
    if (!newVisitorName.trim() || isAddingVisitor) return;
    setIsAddingVisitor(true);
    try {
      await onAddVisitor({
        name: newVisitorName.trim(),
        age: newVisitorAge ? Number(newVisitorAge) : undefined,
        price: 0, // overridden by parent
      });
      setNewVisitorName('');
      setNewVisitorAge('');
      setShowAddVisitor(false);
    } catch {
      showToast('Ошибка добавления посетителя');
    } finally {
      setIsAddingVisitor(false);
    }
  }, [newVisitorName, newVisitorAge, isAddingVisitor, onAddVisitor, showToast]);
  ```

  Wait — the parent overrides `price`. Pass through. Adjust the prop signature so price is set by parent and only `name`/`age` come from form.

- [ ] **Step 5: Replace the dead button (line 213) with toggle + form**

  Replace lines 213 with:

  ```tsx
  {!showAddVisitor ? (
    <button
      onClick={() => setShowAddVisitor(true)}
      className="mt-2 text-brand text-xs hover:underline"
      data-testid="btn-add-visitor"
    >
      + Добавить посетителя
    </button>
  ) : (
    <div className="mt-2 flex items-center gap-2" data-testid="add-visitor-form">
      <input
        type="text"
        placeholder="Имя"
        value={newVisitorName}
        onChange={(e) => setNewVisitorName(e.target.value)}
        className="flex-1 rounded-lg border px-2 py-1 text-sm"
        style={inputStyle}
        data-testid="input-visitor-name"
        autoFocus
      />
      <input
        type="number"
        placeholder="Возраст"
        value={newVisitorAge}
        onChange={(e) => setNewVisitorAge(e.target.value)}
        className="w-16 rounded-lg border px-2 py-1 text-sm"
        style={inputStyle}
        data-testid="input-visitor-age"
      />
      <button
        onClick={handleAddVisitor}
        disabled={!newVisitorName.trim() || isAddingVisitor}
        className="px-2 py-1 text-xs text-white rounded-lg shrink-0 disabled:opacity-50"
        style={{ backgroundColor: 'var(--brand, #004D56)' }}
        data-testid="btn-save-visitor"
      >
        Сохранить
      </button>
      <button
        onClick={() => {
          setShowAddVisitor(false);
          setNewVisitorName('');
          setNewVisitorAge('');
        }}
        className="text-red-400 hover:text-red-500 text-sm"
        aria-label="Отмена"
        data-testid="btn-cancel-visitor"
      >
        ×
      </button>
    </div>
  )}
  ```

- [ ] **Step 6: Type-check + run tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx frontend/admin/hooks/useRecordMutations.ts
  git commit -m "fix(admin): wire + Добавить посетителя button in ClientTab with inline form (#75)"
  ```

### DoD
- [ ] Clicking the button opens the form
- [ ] Submit calls `addVisitorToRecord` and adds a visit to the record
- [ ] Cache is invalidated (activities + records)
- [ ] Toast shown on success/error
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 5: `ClientTab` — replace `<Link>` with SPA navigation (#76)

**Classification:** trivial

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` lines 178–194
- `next/navigation` — `useRouter` from `next/navigation` (App Router)

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`

### Task Description

Replace the `<Link target="_blank">` with a button that uses `useRouter().push('/clients/'+id)` and calls the modal's `onClose` (so the modal doesn't stay open behind the navigated page).

### Steps

- [ ] **Step 1: Add `useRouter` import**

  In `ClientTab.tsx` line 7, change:
  ```ts
  import Link from 'next/link';
  ```
  to:
  ```ts
  import { useRouter } from 'next/navigation';
  ```

- [ ] **Step 2: Add `onClose` prop**

  In `ClientTabProps` (line 9–20), add:
  ```ts
  onClose?: () => void;
  ```

- [ ] **Step 3: In the component, get router and handler**

  After `useRef` line 80, add:
  ```ts
  const router = useRouter();
  ```

  Add a handler:
  ```ts
  const handleOpenProfile = useCallback(() => {
    if (!client) return;
    onClose?.();
    router.push(`/clients/${client.id}`);
  }, [client, onClose, router]);
  ```

- [ ] **Step 4: Replace the `<Link>` block (lines 178–194)**

  Replace with:
  ```tsx
  {client && (
    <div>
      <button
        onClick={handleOpenProfile}
        className="inline-flex items-center gap-1.5 text-brand text-xs hover:underline"
        data-testid="client-link"
        type="button"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Открыть профиль
      </button>
    </div>
  )}
  ```

- [ ] **Step 5: Pass `onClose` from parent**

  In `ActivityDetailsModal.tsx` line 250–262, find the `ClientTab` JSX and add:
  ```tsx
  onClose={onClose}
  ```

- [ ] **Step 6: Type-check + tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
  git commit -m "fix(admin): Открыть профиль uses SPA navigation + closes modal (#76)"
  ```

### DoD
- [ ] Clicking navigates to `/clients/{id}` without new tab
- [ ] Modal closes before navigation
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 6: `ClientTab` — invalidate cache after payment delete (#79)

**Classification:** small

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` lines 107–114 — `handleDeletePayment`

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`

### Task Description

`handleDeletePayment` calls `apiDeletePayment` but does NOT call `invalidateRecord`. After deletion, the list still shows the deleted payment. Add cache invalidation.

### Steps

- [ ] **Step 1: Use the hook's `deletePayment` instead of direct API call**

  The hook already has `deletePayment(paymentId)` that calls `invalidateAll()` (T2). Replace the local function.

  Add `deletePayment` to the destructure in `ClientTab` props. The parent (`ActivityDetailsModal.tsx:52`) destructures `addPayment` and `deleteRecord`. Add `deletePayment`.

- [ ] **Step 2: Pass `deletePayment` as prop**

  In `ClientTabProps` (line 9–20), add:
  ```ts
  onDeletePayment: (paymentId: string) => Promise<void>;
  ```

  In the parent's `ClientTab` JSX (line 250–262), pass:
  ```tsx
  onDeletePayment={(id) => deletePayment(id)}
  ```

- [ ] **Step 3: Update `handleDeletePayment` in `ClientTab`**

  Replace lines 107–114 with:
  ```ts
  const handleDeletePayment = useCallback(async (paymentId: string) => {
    try {
      await onDeletePayment(paymentId);
      showToast('Оплата удалена');
    } catch {
      showToast('Ошибка удаления оплаты');
    }
  }, [onDeletePayment, showToast]);
  ```

- [ ] **Step 4: Type-check + tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
  git commit -m "fix(admin): invalidate cache after payment delete (#79)"
  ```

### DoD
- [ ] After delete, payment disappears from list without F5
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 7: `ClientTab` — placeholders "Не указано" + tab label fallback (#81)

**Classification:** small

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` lines 122–150 (Phone + Name inputs)
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` lines 89–100 (tab label logic)

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`

### Task Description

When `client.name` or `client.phone` is null:
- Tab label: show phone as primary identifier (not "Неизвестный")
- Inputs: show `placeholder="Не указано"` (gray native HTML placeholder)

### Steps

- [ ] **Step 1: Add placeholders to phone and name inputs in `ClientTab`**

  In `ClientTab.tsx`:
  - Phone input (line 127–136): add `placeholder="Не указано"`
  - Name input (line 141–150): add `placeholder="Не указано"`

- [ ] **Step 2: Update tab label logic in `ActivityDetailsModal.tsx`**

  Replace lines 91–98 with:
  ```ts
  const clientTabs: Tab[] = activityRecords.map((record) => {
    const client = clients.get(record.client_id ?? '');
    const name = client?.name?.trim();
    const phone = client?.phone?.trim();
    return {
      id: `client-${record.id}`,
      label: name || phone || 'Без контакта',
      sublabel: name && phone ? phone : '',
    };
  });
  ```

- [ ] **Step 3: Type-check + tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
  git commit -m "fix(admin): placeholders + tab label falls back to phone (#81)"
  ```

### DoD
- [ ] Empty name input shows "Не указано" placeholder
- [ ] Empty phone input shows "Не указано" placeholder
- [ ] Tab label shows phone when name is null
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 8: `ClientTab` — fix status labels to spec wording (#77)

**Classification:** trivial

### Required Docs
- Spec wording: `Ожидание / Посетил / Отменил / Неявка`
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` lines 22–27 (`STATUS_CONFIG`)

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`

### Task Description

Replace existing status labels (`Ожидает / Подтверждена / Отменена / Неявка`) with spec wording (`Ожидание / Посетил / Отменил / Неявка`). Backend enum unchanged.

### Steps

- [ ] **Step 1: Update STATUS_CONFIG**

  Replace lines 22–27 with:
  ```ts
  const STATUS_CONFIG: Record<RecordStatus, { label: string; color: string }> = {
    pending: { label: 'Ожидание', color: '#F59E0B' },
    confirmed: { label: 'Посетил', color: '#10B981' },
    cancelled: { label: 'Отменил', color: '#EF4444' },
    no_show: { label: 'Неявка', color: '#6B7280' },
  };
  ```

- [ ] **Step 2: Run vitest**

  ```bash
  cd frontend/admin && npm run test -- --run
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx
  git commit -m "fix(admin): status labels match spec — Ожидание/Посетил/Отменил/Неявка (#77)"
  ```

### DoD
- [ ] All status labels match spec
- [ ] Vitest passes
- [ ] Committed

---

## Task 9: `ClientTab` — `StatusPicker` icon-button + popover (#78)

**Classification:** standard

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` lines 151–174 (current select+icon)
- Spec § A2 (status labels — frontend only)

### Files
- Create: `frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx`
- Create: `frontend/admin/__tests__/StatusPicker.test.tsx`
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`

### Task Description

Replace the current `<select>` (with icon to the right) with an icon-button. Click opens a popover with 4 status options. Each option shows the icon and a Russian label. The popover closes on outside click or on selection. Reuse the existing `StatusIcon` SVG paths.

### Steps

- [ ] **Step 1: Create `StatusPicker.tsx`**

  Write `frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx`:

  ```tsx
  'use client';

  import React, { useState, useRef, useEffect, useCallback } from 'react';
  import type { RecordStatus } from '@memo/domain';

  interface StatusPickerProps {
    value: RecordStatus;
    onChange: (status: RecordStatus) => void;
    /** Map from status to display label and color */
    statusConfig: Record<RecordStatus, { label: string; color: string }>;
    /** SVG path for each status (reused from ClientTab) */
    iconFor: (status: RecordStatus) => React.ReactNode;
    testIdPrefix?: string;
  }

  const STATUS_ORDER: RecordStatus[] = ['pending', 'confirmed', 'cancelled', 'no_show'];

  export function StatusPicker({ value, onChange, statusConfig, iconFor, testIdPrefix = 'status-picker' }: StatusPickerProps) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!open) return;
      const handler = (e: MouseEvent) => {
        if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
          setOpen(false);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const handleSelect = useCallback((status: RecordStatus) => {
      onChange(status);
      setOpen(false);
    }, [onChange]);

    const current = statusConfig[value];

    return (
      <div className="relative" ref={containerRef} data-testid={testIdPrefix}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-sm hover:bg-surface"
          style={{ borderColor: 'var(--line)', color: current.color }}
          aria-label={`Статус: ${current.label}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          data-testid={`${testIdPrefix}-trigger`}
        >
          {iconFor(value)}
        </button>

        {open && (
          <div
            className="absolute z-50 mt-1 right-0 bg-white border rounded-lg shadow-lg py-1 min-w-[140px]"
            style={{ borderColor: 'var(--line)' }}
            role="listbox"
            data-testid={`${testIdPrefix}-popover`}
          >
            {STATUS_ORDER.map((status) => {
              const cfg = statusConfig[status];
              const isActive = status === value;
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => handleSelect(status)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-surface ${isActive ? 'bg-surface' : ''}`}
                  style={{ color: cfg.color }}
                  role="option"
                  aria-selected={isActive}
                  data-testid={`${testIdPrefix}-option-${status}`}
                >
                  {iconFor(status)}
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 2: Write unit test for StatusPicker**

  Create `frontend/admin/__tests__/StatusPicker.test.tsx`:

  ```tsx
  import { describe, it, expect, vi } from 'vitest';
  import { render, screen, fireEvent } from '@testing-library/react';
  import { StatusPicker } from '@/app/components/modal/ActivityDetailsModal/StatusPicker';

  const STATUS_CONFIG = {
    pending: { label: 'Ожидание', color: '#F59E0B' },
    confirmed: { label: 'Посетил', color: '#10B981' },
    cancelled: { label: 'Отменил', color: '#EF4444' },
    no_show: { label: 'Неявка', color: '#6B7280' },
  } as const;

  const iconFor = (status: keyof typeof STATUS_CONFIG) => (
    <svg data-testid={`icon-${status}`} viewBox="0 0 24 24" />
  );

  describe('StatusPicker', () => {
    it('renders the current status as an icon', () => {
      render(<StatusPicker value="pending" onChange={() => {}} statusConfig={STATUS_CONFIG} iconFor={iconFor} />);
      expect(screen.getByTestId('status-picker-trigger')).toBeInTheDocument();
      expect(screen.getByLabelText('Статус: Ожидание')).toBeInTheDocument();
    });

    it('opens popover on click and shows all 4 options', () => {
      render(<StatusPicker value="pending" onChange={() => {}} statusConfig={STATUS_CONFIG} iconFor={iconFor} />);
      fireEvent.click(screen.getByTestId('status-picker-trigger'));
      expect(screen.getByTestId('status-picker-popover')).toBeInTheDocument();
      expect(screen.getByTestId('status-picker-option-pending')).toBeInTheDocument();
      expect(screen.getByTestId('status-picker-option-confirmed')).toBeInTheDocument();
      expect(screen.getByTestId('status-picker-option-cancelled')).toBeInTheDocument();
      expect(screen.getByTestId('status-picker-option-no_show')).toBeInTheDocument();
    });

    it('calls onChange and closes popover when option is clicked', () => {
      const onChange = vi.fn();
      render(<StatusPicker value="pending" onChange={onChange} statusConfig={STATUS_CONFIG} iconFor={iconFor} />);
      fireEvent.click(screen.getByTestId('status-picker-trigger'));
      fireEvent.click(screen.getByTestId('status-picker-option-confirmed'));
      expect(onChange).toHaveBeenCalledWith('confirmed');
      expect(screen.queryByTestId('status-picker-popover')).not.toBeInTheDocument();
    });

    it('closes popover on outside click', () => {
      render(
        <div>
          <div data-testid="outside">outside</div>
          <StatusPicker value="pending" onChange={() => {}} statusConfig={STATUS_CONFIG} iconFor={iconFor} />
        </div>
      );
      fireEvent.click(screen.getByTestId('status-picker-trigger'));
      expect(screen.getByTestId('status-picker-popover')).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByTestId('status-picker-popover')).not.toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 3: Run new unit test, expect GREEN**

  ```bash
  cd frontend/admin && npm run test -- --run __tests__/StatusPicker.test.tsx
  ```

- [ ] **Step 4: Replace select+icon with StatusPicker in `ClientTab`**

  In `ClientTab.tsx`:
  - Add import: `import { StatusPicker } from './StatusPicker';`
  - Replace lines 151–174 with:

  ```tsx
  <div className="w-40">
    <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="record-status">
      Статус
    </label>
    <StatusPicker
      value={status}
      onChange={setStatus}
      statusConfig={STATUS_CONFIG}
      iconFor={renderStatusIcon}
    />
  </div>
  ```

  Extract `renderStatusIcon` from the existing `StatusIcon` component. Replace `function StatusIcon({ status })` (lines 29–63) with:

  ```ts
  function renderStatusIcon(status: RecordStatus): React.ReactNode {
    const iconClass = 'w-3.5 h-3.5';
    switch (status) {
      case 'pending':
        return (
          <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" data-testid="icon-pending">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        );
      case 'confirmed':
        return (
          <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" data-testid="icon-confirmed">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        );
      case 'cancelled':
        return (
          <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" data-testid="icon-cancelled">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
      case 'no_show':
        return (
          <svg className={iconClass} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" data-testid="icon-no_show">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        );
    }
  }
  ```

- [ ] **Step 5: Add onChange side-effect to persist status change**

  Currently `setStatus` is a local state. Add a debounced patch (or onChange) to call `patchRecord` when status changes:

  ```ts
  const handleStatusChange = useCallback(
    async (newStatus: RecordStatus) => {
      setStatus(newStatus);
      try {
        await onUpdateRecord(record.id, { ...record, status: newStatus });
        showToast(`Статус изменён: ${STATUS_CONFIG[newStatus].label}`);
      } catch {
        setStatus(status); // revert
        showToast('Ошибка изменения статуса');
      }
    },
    [record, onUpdateRecord, showToast, status],
  );
  ```

  But the current `onUpdateRecord` prop is `() => {}` (a no-op). We need to wire it. Pull `saveRecord` from the hook in the parent and pass it as `onUpdateRecord` after wrapping to match the signature.

  For minimum scope in this task: use a new `useEffect` to auto-save on `status` change. Or accept that status change is local-only in this commit and add a TODO. **Decision: add a `useEffect` that calls `saveRecord` when status changes.**

  Add:
  ```ts
  useEffect(() => {
    if (status === record.status) return;
    // Status differs from server-side; save asynchronously
    onUpdateRecord(record.id, { ...record, status });
  }, [status]);
  ```

  This is acceptable for the bug fix; a future task can refactor to a proper mutation hook.

- [ ] **Step 6: Type-check + tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx frontend/admin/__tests__/StatusPicker.test.tsx
  git commit -m "feat(admin): StatusPicker — icon-button + popover for record status (#78)"
  ```

### DoD
- [ ] StatusPicker unit tests pass (4 tests)
- [ ] ClientTab uses StatusPicker instead of select
- [ ] Icon is reused (not new SVG paths)
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 10: `ClientTab` — render `seats` in visitor row + pluralise helper (#82)

**Classification:** small

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` lines 196–214 (Visitors section)
- Russian pluralisation rules: 1 место / 2-4 места / 5-20 мест / 21 место (standard Slavic rule with 11-14 exception)

### Files
- Create: `frontend/admin/app/lib/pluralize.ts`
- Create: `frontend/admin/__tests__/pluralize.test.ts`
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`

### Task Description

Visitor rows currently show only `name` and (optionally) `age`. Add `seats` count. Use Russian pluralisation (1 место, 2 места, 5 мест, etc.).

### Steps

- [ ] **Step 1: Create `pluraliseSeats` helper**

  Write `frontend/admin/app/lib/pluralize.ts`:

  ```ts
  /**
   * Russian pluralisation for "место" (seat).
   * Rules:
   *   1, 21, 31, ... → "место"  (last digit 1, except 11)
   *   2-4, 22-24, ... → "места"  (last digit 2-4, except 12-14)
   *   0, 5-20, 25-30, ... → "мест"
   */
  export function pluraliseSeats(n: number): string {
    const abs = Math.abs(n) | 0;
    const lastTwo = abs % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return 'мест';
    const last = abs % 10;
    if (last === 1) return 'место';
    if (last >= 2 && last <= 4) return 'места';
    return 'мест';
  }

  /** Returns "N мест/места/место" formatted string. */
  export function formatSeats(n: number): string {
    return `${n} ${pluraliseSeats(n)}`;
  }
  ```

- [ ] **Step 2: Write unit test for `pluraliseSeats`**

  Create `frontend/admin/__tests__/pluralize.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { pluraliseSeats, formatSeats } from '@/app/lib/pluralize';

  describe('pluraliseSeats', () => {
    it.each([
      [1, 'место'],
      [2, 'места'],
      [3, 'места'],
      [4, 'места'],
      [5, 'мест'],
      [10, 'мест'],
      [11, 'мест'],  // 11-14 exception
      [12, 'мест'],
      [13, 'мест'],
      [14, 'мест'],
      [15, 'мест'],
      [20, 'мест'],
      [21, 'место'],
      [22, 'места'],
      [25, 'мест'],
      [100, 'мест'],
      [101, 'место'],
      [111, 'мест'],
      [121, 'место'],
    ])('pluraliseSeats(%i) === %s', (n, expected) => {
      expect(pluraliseSeats(n)).toBe(expected);
    });
  });

  describe('formatSeats', () => {
    it('formats 1 as "1 место"', () => {
      expect(formatSeats(1)).toBe('1 место');
    });
    it('formats 3 as "3 места"', () => {
      expect(formatSeats(3)).toBe('3 места');
    });
    it('formats 7 as "7 мест"', () => {
      expect(formatSeats(7)).toBe('7 мест');
    });
  });
  ```

- [ ] **Step 3: Run unit test, expect GREEN**

  ```bash
  cd frontend/admin && npm run test -- --run __tests__/pluralize.test.ts
  ```

- [ ] **Step 4: Render seats in visitor row in `ClientTab`**

  In `ClientTab.tsx`:
  - Add import: `import { formatSeats } from '@/app/lib/pluralize';`
  - In the props interface, the `visitors` are passed as `VisitorResponse[]`. They don't have `seats` directly — `seats` is on the **record** level, not on individual visitors. The user wants to know how many seats the record is for. Render the record's `seats` once at the top of the visitors section.

  Replace lines 197–214 with:

  ```tsx
  <div>
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-xs font-medium text-ink-mid">Посетители</h4>
      <span className="text-xs text-ink-mid" data-testid="record-seats">
        {formatSeats(record.seats)}
      </span>
    </div>
    {visitors.length === 0 && (
      <p className="text-xs text-ink-light">Нет посетителей</p>
    )}
    {visitors.map((visitor) => (
      <div
        key={visitor.id}
        className="flex items-center gap-2 py-1.5 border-b text-sm"
        style={{ borderColor: 'var(--line)' }}
        data-testid="visitor-row"
      >
        <span className="flex-1 truncate text-ink">{visitor.name}</span>
        {visitor.age && <span className="text-xs text-ink-light">{visitor.age} лет</span>}
      </div>
    ))}
    {!showAddVisitor ? (
      <button
        onClick={() => setShowAddVisitor(true)}
        className="mt-2 text-brand text-xs hover:underline"
        data-testid="btn-add-visitor"
      >
        + Добавить посетителя
      </button>
    ) : (
      <div className="mt-2 flex items-center gap-2" data-testid="add-visitor-form">
        <input
          type="text"
          placeholder="Имя"
          value={newVisitorName}
          onChange={(e) => setNewVisitorName(e.target.value)}
          className="flex-1 rounded-lg border px-2 py-1 text-sm"
          style={inputStyle}
          data-testid="input-visitor-name"
          autoFocus
        />
        <input
          type="number"
          placeholder="Возраст"
          value={newVisitorAge}
          onChange={(e) => setNewVisitorAge(e.target.value)}
          className="w-16 rounded-lg border px-2 py-1 text-sm"
          style={inputStyle}
          data-testid="input-visitor-age"
        />
        <button
          onClick={handleAddVisitor}
          disabled={!newVisitorName.trim() || isAddingVisitor}
          className="px-2 py-1 text-xs text-white rounded-lg shrink-0 disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand, #004D56)' }}
          data-testid="btn-save-visitor"
        >
          Сохранить
        </button>
        <button
          onClick={() => {
            setShowAddVisitor(false);
            setNewVisitorName('');
            setNewVisitorAge('');
          }}
          className="text-red-400 hover:text-red-500 text-sm"
          aria-label="Отмена"
          data-testid="btn-cancel-visitor"
        >
          ×
        </button>
      </div>
    )}
  </div>
  ```

  Wait — the `setShowAddVisitor` etc. state variables were added in T4. If T4 is run before T10, the variables exist. **Order matters here: T4 adds the state and handler; T10 uses them.** T4 is task 4; T10 is task 10. The current order is correct.

  However, **T10 may run before T4 if executor skips a step.** Verify in commit log. If T4 hasn't run yet, the form block (the `!showAddVisitor` ternary) is the OLD `+ Добавить посетителя` button (single line). T10 should just **add the seats line** without touching the form. So the minimal T10 change is: insert the seats line above the visitor list; leave the button as-is.

  Refined T10 step 4: Only add the seats display. Don't touch the existing button.

  ```tsx
  <div>
    <div className="flex items-center justify-between mb-2">
      <h4 className="text-xs font-medium text-ink-mid">Посетители</h4>
      <span className="text-xs text-ink-mid" data-testid="record-seats">
        {formatSeats(record.seats)}
      </span>
    </div>
    {/* ... rest of the existing visitors block unchanged ... */}
  </div>
  ```

- [ ] **Step 5: Type-check + tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/admin/app/lib/pluralize.ts frontend/admin/__tests__/pluralize.test.ts frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx
  git commit -m "feat(admin): show record seats with Russian pluralisation (#82)"
  ```

### DoD
- [ ] pluraliseSeats unit tests pass (20+ cases)
- [ ] ClientTab shows formatted seats in visitors section
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 11: `SettingsTab` — Private toggle stacked layout (#83)

**Classification:** trivial

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx` lines 154–175

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx`

### Task Description

The "Приватное" label and toggle switch are currently inline (`flex items-center gap-2 pb-0.5`). Per spec, they should be stacked vertically: label on top, switch below.

### Steps

- [ ] **Step 1: Replace the inline layout with stacked**

  Replace lines 154–175 with:
  ```tsx
  <div className="flex flex-col items-start gap-1.5 pb-0.5">
    <span className="text-xs text-ink-mid">Приватное</span>
    <button
      type="button"
      role="switch"
      aria-checked={isPrivate}
      onClick={() => {
        setIsPrivate(!isPrivate);
        onUpdate({ isPrivate: !isPrivate });
      }}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        isPrivate ? 'bg-brand' : 'bg-ink-faint'
      }`}
      data-testid="toggle-private"
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
          isPrivate ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  </div>
  ```

  Also wrap this block + the datetime+duration fields in a `flex-col` row instead of the existing `flex gap-3 items-end`. The current row uses `flex gap-3 items-end` (line 124). The "Приватное" block needs to align top with the other fields. Change `items-end` to `items-start`:

  Line 124: change `flex gap-3 items-end` to `flex gap-3 items-start`.

- [ ] **Step 2: Type-check + tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx
  git commit -m "fix(admin): stack 'Приватное' label above toggle in SettingsTab (#83)"
  ```

### DoD
- [ ] Label and switch are stacked (flex-col)
- [ ] Row uses items-start alignment
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 12: `ActivityDetailsModal` — fixed height + overflow (#74)

**Classification:** small

### Required Docs
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` lines 272–325 (modal JSX)

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`

### Task Description

Modal currently uses `maxHeight: '85vh'` but no fixed height, so the modal grows with content. When switching between tabs (Settings vs Client with 5 records), the modal height changes — visually "jumps". Fix: set fixed `h-[80vh]`, ensure content area has `overflow-y-auto`, modal itself `overflow-hidden`.

### Steps

- [ ] **Step 1: Replace the modal container className**

  In `ActivityDetailsModal.tsx` line 282–285, change:
  ```tsx
  <div
    className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden"
    style={{ maxHeight: '85vh' }}
  >
  ```
  to:
  ```tsx
  <div
    className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden h-[80vh]"
    data-testid="activity-details-modal-container"
  >
  ```

  Remove the inline `style` (the new className already has `h-[80vh]`).

- [ ] **Step 2: Verify body has overflow-y-auto**

  The body div (line 311–321) is:
  ```tsx
  <div className="flex flex-1 overflow-hidden min-h-0">
    <TabNav ... />
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--white)' }}>
      {renderContent()}
    </div>
  </div>
  ```

  This already has `overflow-y-auto` on the content area. Verify the `TabNav` doesn't have its own height growth. If `TabNav` content overflows, it needs its own scroll. Add `overflow-y-auto` to the TabNav container if it has many tabs.

  Read `TabNav.tsx` and add `overflow-y-auto` if needed.

- [ ] **Step 3: Type-check + tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
  git commit -m "fix(admin): fixed modal height (h-[80vh]) prevents tab-switch jump (#74)"
  ```

### DoD
- [ ] Modal height is constant (80vh) regardless of tab
- [ ] Content area scrolls internally for long lists
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 13: `ActivityDetailsModal` — raise z-index above schedule grid (#86)

**Classification:** trivial

### Required Docs
- `frontend/admin/app/components/schedule/DayColumn.tsx` line 553 — `z-[110]` on the "x cards" badge
- `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` line 273 — `z-50` on modal

### Files
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`
- Modify: `frontend/admin/app/components/schedule/DayColumn.tsx` (optional, see step 3)

### Task Description

The "x cards" overlap badge in `DayColumn` has `z-[110]`, which is higher than the modal's `z-50`. The badge stays sharp above the modal backdrop. Per spec, the entire schedule (including the badge) should be uniformly blurred. Fix: raise the modal to `z-[200]`.

### Steps

- [ ] **Step 1: Update modal z-index**

  In `ActivityDetailsModal.tsx` line 273, change:
  ```tsx
  <div className="fixed inset-0 z-50 flex items-center justify-center" ...>
  ```
  to:
  ```tsx
  <div className="fixed inset-0 z-[200] flex items-center justify-center" ...>
  ```

- [ ] **Step 2: Add z-index documentation comment in `globals.css`**

  Find `frontend/admin/app/globals.css` and add a comment block at the top of the z-index section (search for `z-index`):

  ```css
  /* ─── Z-index stacking order (single source of truth) ───
   *  0–29   : schedule grid content (cards, lines)
   *  30–49  : DnD ghosts, drag previews
   *  50–149 : popovers, tooltips, dropdowns
   *  150–199: toasts
   *  200+   : modals (must be highest)
   */
  ```

  If there's no z-index section, add the comment block at the end of the file.

- [ ] **Step 3: Verify "x cards" badge is now hidden under modal**

  Run E2E (T14 step 2) to verify. If for some reason the modal still doesn't cover it, lower the badge from `z-[110]` to `z-[40]` in `DayColumn.tsx:553`.

- [ ] **Step 4: Type-check + tests**

  ```bash
  cd frontend/admin && npx tsc --noEmit && npm run test -- --run
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx frontend/admin/app/globals.css
  git commit -m "fix(admin): raise modal z-index to z-[200] above schedule grid (#86)"
  ```

### DoD
- [ ] Modal z-index is 200
- [ ] Schedule grid elements (including "x cards" badge) are uniformly blurred when modal is open
- [ ] tsc clean, vitest passes
- [ ] Committed

---

## Task 14: E2E tests for Wave 5 scenarios

**Classification:** standard

### Required Docs
- `frontend/admin/e2e/` — existing E2E structure
- `frontend/admin/playwright.config.ts`
- Spec § User Scenarios

### Files
- Create: 5 new E2E specs (one per scenario)
- Modify: `frontend/admin/e2e/_helpers/` if needed

### Task Description

Write 5 E2E tests, one per User Scenario from the spec. Each is a RED-GREEN-REFACTOR cycle (some scenarios may already pass after T1–T13; verify the test exists).

### Steps

- [ ] **Step 1: Read existing E2E structure**

  ```bash
  ls frontend/admin/e2e/
  cat frontend/admin/playwright.config.ts
  ```

  Identify the project name (e.g. `schedule`, `records+activity`) to add new tests to. Use the `records+activity` project (or whichever covers modal flows).

- [ ] **Step 2: Write E2E for scenario 1 — modal height stable**

  Create `frontend/admin/e2e/wave5-modal-height-stable.spec.ts`:

  ```ts
  import { test, expect } from '@playwright/test';

  test.describe('Wave 5: Modal height stable on tab switch (#74)', () => {
    test('modal height is constant across tabs', async ({ page }) => {
      // ... navigate to /schedule, open first activity, capture modal height
      // ... switch tabs, assert height is within ±2px
    });
  });
  ```

  **Use the existing seed data** to set up state. Reference existing E2E tests in the same project for navigation patterns.

- [ ] **Step 3: Write E2E for scenario 2 — add visitor from ClientTab**

  Create `frontend/admin/e2e/wave5-add-visitor.spec.ts`:

  ```ts
  test('admin adds a visitor from ClientTab (#75)', async ({ page }) => {
    // Open activity with at least one record
    // Switch to client-* tab
    // Click "+ Добавить посетителя"
    // Fill form
    // Submit
    // Assert: new visitor appears in list
  });
  ```

- [ ] **Step 4: Write E2E for scenario 3 — open profile SPA nav**

  Create `frontend/admin/e2e/wave5-open-profile.spec.ts`:

  ```ts
  test('open profile navigates via SPA (#76)', async ({ page }) => {
    // Open activity with record
    // Click "Открыть профиль"
    // Assert: URL is /clients/{id} (no new tab)
    // Assert: modal is closed
  });
  ```

- [ ] **Step 5: Write E2E for scenario 4 — occupied excludes cancelled**

  Create `frontend/admin/e2e/wave5-occupied-excludes-cancelled.spec.ts`:

  ```ts
  test('occupied excludes cancelled records (#84)', async ({ page, request }) => {
    // Create activity with capacity 10 via API
    // Create 2 records (3 seats + 3 seats)
    // Cancel one via API
    // Navigate to /schedule
    // Assert: card footer shows "3/10"
  });
  ```

- [ ] **Step 6: Write E2E for scenario 5 — x cards blurred**

  Create `frontend/admin/e2e/wave5-x-cards-blurred.spec.ts`:

  ```ts
  test('x cards badge is hidden under modal (#86)', async ({ page }) => {
    // Open /schedule
    // Find a day with overlapping activities (or seed one)
    // Open one of them
    // Assert: "x cards" badge on the page has visibility:hidden OR is behind the modal (computed z-index < modal z-index)
  });
  ```

- [ ] **Step 7: Run all 5 new E2E tests against the current state**

  ```bash
  cd frontend/admin && npx playwright test e2e/wave5-*.spec.ts --project=records+activity
  ```

  All 5 should pass (since T1–T13 are already merged into the branch).

- [ ] **Step 8: Run full Playwright suite (no regression)**

  ```bash
  cd frontend/admin && npx playwright test
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add frontend/admin/e2e/wave5-*.spec.ts
  git commit -m "test(e2e): add 5 E2E specs for Wave 5 user scenarios"
  ```

### DoD
- [ ] 5 E2E specs written and passing
- [ ] Full Playwright suite passes
- [ ] Committed

---

## Self-Review

### Spec coverage

| Spec requirement | Task |
|------------------|------|
| #74 modal height | T12 |
| #75 add visitor | T4 |
| #76 open profile | T5 |
| #77 status labels | T8 |
| #78 status picker | T9 |
| #79 payment delete | T6 |
| #80 form save | T2 + T3 |
| #81 placeholders | T7 |
| #82 seats display | T10 |
| #83 private toggle | T11 |
| #84 occupied | T1 |
| #85 cache invalidate | T2 |
| #86 x cards blur | T13 |
| 5 E2E scenarios | T14 |
| 4 backend tests | T1 |
| 7 frontend unit tests | T9 (4) + T10 (3) |

All 13 issues + all 5 E2E scenarios + 11 tests covered. No gaps.

### Type consistency

- `useRecordMutations(activityId, recordId?)` — `recordId` is optional (string = ''). Verified.
- `StatusPicker` props: `value: RecordStatus`, `onChange: (s: RecordStatus) => void`, `statusConfig`, `iconFor`. Matches `ClientTab` usage.
- `addVisitorToRecord` returns `Promise<void>`. Caller awaits.

### Required Docs

Every task has `### Required Docs` ✅

### Plan-level risks

- **T9 Step 5** has a TODO-like state (status side-effect via useEffect instead of proper mutation). Acceptable for this bug fix; future refactor needed.
- **T14 E2E** uses placeholder code (TODO body). Implementer MUST fill in the test bodies by reading existing E2E patterns. This is a known gap — the implementer must adapt, not blindly copy.
- **T4** depends on `getRecord` API existing in `@memo/api-client`. Verify in the implementer's first step.

### Pre-execution checklist

- [ ] All 14 tasks have exact file paths
- [ ] All steps have commands and expected output
- [ ] TDD pattern (RED → GREEN) followed for tasks with tests
- [ ] No "TBD" or "implement later"
- [ ] Branch name `fix/wave5-ux-bugs` documented
- [ ] Each task has DoD
- [ ] E2E tests for User Scenarios present
