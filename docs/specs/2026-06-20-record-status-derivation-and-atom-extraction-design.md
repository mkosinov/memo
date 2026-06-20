# Record Status Derivation & Atom Extraction — Design

**Date:** 2026-06-20
**Status:** Draft (awaiting written-spec approval — G1b)
**Issues addressed:** #78, #79, #98 (migration), #82 (anonym_visits editing), #93–#95 deferred
**Replaces:** `RecordStatus = pending/confirmed/cancelled/no_show` (Wave 5 implementation drift)

---

## Problem

Two parallel issues:

1. **Status enum drift (Wave 5).** `RecordStatus = pending/confirmed/cancelled/no_show` was introduced in PR #92 (commit `1e7d857`) and labelled with "Ожидание / Посетил / Отменил / Неявка". Domain rules (`docs/domain-rules/records.md`, commit `c0c4a8d`) require that record status is a **derived** field computed from `VisitItem.status` (waiting/visited/missed/cancelled). A Record has no independent status — it is a container for Visits. The two views diverge: 3 copies of `RECORD_STATUS_CONFIG` with mismatched Russian labels (`'Посетил'/'Отменил'` vs `'Подтверждена'/'Отменена'`).

2. **Record row duplication.** The `/clients` page (`ClientRecordTab.tsx`, 746 LOC) and the schedule's `ActivityDetailsModal` (`ClientTab.tsx`, 559 LOC) both render the same record-level UI: visit list, payment list, payment form, add-visitor form, status control, totals. ~1830 LOC with ~600 LOC of near-identical JSX. Only the data source and a few surface-specific props differ.

This spec delivers two things at once: (a) the status-derivation migration that brings the codebase in line with the documented contract, and (b) the shared-atoms extraction that prevents the duplication from re-emerging.

---

## Goals

1. **Single source of truth for status:** `VisitStatus` (waiting/visited/missed/cancelled) is the only enum. Record-level status is a derived field.
2. **No record-level status drift:** API rejects `status` in `Record` payloads (422). UI edits per-visit statuses; the record badge updates automatically.
3. **Shared record atoms:** `RecordVisitRow`, `PaymentList`, `PaymentForm`, `PaymentTotals`, `AddVisitorForm`, `StatusPicker`, `StatusBadge` live in `app/components/shared/{records,payments,visitors,config}/`. Both `ClientRecordTab` and `ClientTab` consume them.
4. **Net code reduction:** ~500–600 LOC removed from `ClientRecordTab` + `ClientTab`; each becomes a ~200 LOC thin wrapper.
5. **Edit `anonym_visits` in existing records:** the `RecordHeader` exposes an input that calls `updateAnonymVisits(recordId, value)` via `useRecordMutations`.

## Non-Goals

- Optimistic updates — deferred to a future wave (current `invalidate-on-success` pattern remains).
- Per-visitor tariff editing (pre-existing Wave 5 deviation; tracked separately).
- New issues #93 (specific error toasts), #94 (undo toast with ring), #95 (anonym visits display) — backlog.
- Refactor of other admin pages (`/records`, `/services`, etc.).
- Changing how `seats` is calculated (still `len(visits)` — see `FUTURE REQUIREMENT: Flexible Seats` in `records.md:33–45`).

---

## Architecture

### Folder layout (after this spec lands)

```
app/components/shared/                          # all cross-feature atoms
├── MasterPicker.tsx                            (existing)
├── CustomSelect.tsx                            (existing — base for StatusPicker)
├── StatusPicker.tsx                            (MOVED from modal/ + REBUILT on CustomSelect)
├── StatusBadge.tsx                             (NEW — read-only badge)
├── records/                                    (NEW)
│   ├── RecordHeader.tsx                        (name/phone/anonym_visits/seats/status badge)
│   ├── RecordVisitRow.tsx                      (extracted from both)
│   └── types.ts                                (shared TS types: RecordWithDerived)
├── payments/                                   (NEW)
│   ├── PaymentList.tsx
│   ├── PaymentForm.tsx
│   └── PaymentTotals.tsx
├── visitors/                                   (NEW)
│   ├── AddVisitorForm.tsx
│   └── VisitorRow.tsx                          (used inside AddVisitorForm preview)
└── config/
    └── VISIT_STATUS_CONFIG.ts                  (single enum → config)

app/(main)/clients/components/ClientRecordTab.tsx          # thin wrapper, ~200 LOC
app/components/modal/ActivityDetailsModal/ClientTab.tsx    # thin wrapper, ~200 LOC
```

### Data flow

```
useRecordData(recordId, clientId)                ← existing, unchanged
    │
    ├── record (without status field)
    ├── visits: VisitItem[]                      ← each with status
    ├── payments: Payment[]
    ├── client: Client
    ├── tariffs: Tariff[]
    └── stats
        │
        ▼
computeRecordStatus(visits)  ─── from @memo/domain   ← NEW
        │
        ▼
record.status (derived, in-memory only)
        │
        ▼
ClientRecordTab / ClientTab
    │
    ├── <RecordHeader record={r} onAnonymChange={...} />
    ├── <RecordVisitRow visit={v} onChange={...} />      per visit
    ├── <PaymentList payments={p} onAdd={...} onDelete={...} />
    ├── <PaymentForm onSubmit={...} />
    ├── <PaymentTotals total paid remaining />
    └── <AddVisitorForm onAdd={...} />
        │
        ▼
useRecordMutations()  ← existing, unchanged
    ├── addVisit / updateVisit / removeVisit
    ├── addPayment / deletePayment
    └── updateAnonymVisits  ← NEW
```

### Component contracts (key atoms)

```ts
// app/components/shared/records/RecordHeader.tsx
interface RecordHeaderProps {
  record: RecordWithDerived;                   // has computed .status
  client: Client | null;                       // null for anonymous
  onAnonymVisitsChange?: (value: number) => void;
  isReadOnly?: boolean;
}

// app/components/shared/records/RecordVisitRow.tsx
interface RecordVisitRowProps {
  visit: VisitItem;
  tariffs: Tariff[];
  isReadOnly?: boolean;
  onChange: (visit: VisitItem) => void;
  onDelete: () => void;
}

// app/components/shared/payments/PaymentList.tsx
interface PaymentListProps {
  payments: Payment[];
  isReadOnly?: boolean;
  onDelete: (paymentId: string) => void;
}

// app/components/shared/payments/PaymentForm.tsx
interface PaymentFormProps {
  total: number;
  paid: number;
  isReadOnly?: boolean;
  onSubmit: (payment: PaymentCreate) => void;
}

// app/components/shared/payments/PaymentTotals.tsx
interface PaymentTotalsProps {
  total: number;
  paid: number;
  className?: string;
}

// app/components/shared/visitors/AddVisitorForm.tsx
interface AddVisitorFormProps {
  tariffs: Tariff[];
  isReadOnly?: boolean;
  onAdd: (visitor: VisitCreate) => void;
  onCancel: () => void;
}

// app/components/shared/StatusPicker.tsx
interface StatusPickerProps {
  value: VisitStatus;                         // single enum
  onChange: (status: VisitStatus) => void;
  variant?: 'icon-only' | 'full';
  size?: 'sm' | 'md';
  disabled?: boolean;
  testIdPrefix?: string;
}

// app/components/shared/StatusBadge.tsx
interface StatusBadgeProps {
  status: VisitStatus;
  className?: string;
}
```

### Status derivation (Phase 0 of implementation)

```ts
// packages/domain/src/record.ts
export type VisitStatus = 'waiting' | 'visited' | 'missed' | 'cancelled';

export function computeRecordStatus(visits: VisitItem[]): VisitStatus {
  if (visits.length === 0) return 'waiting';
  if (visits.some((v) => v.status === 'visited')) return 'visited';
  if (visits.every((v) => v.status === 'missed')) return 'missed';
  if (visits.every((v) => v.status === 'cancelled')) return 'cancelled';
  return 'waiting';
}
```

Rules in priority order:
1. Any `visited` → record = `visited`
2. All `missed` (and none `visited`) → record = `missed`
3. All `cancelled` (and none `visited`/`missed`) → record = `cancelled`
4. Otherwise → `waiting` (default; covers 0 visits, mixed waiting, etc.)

### API contract change (Phase 0)

| Endpoint | Before | After |
|---|---|---|
| `POST /api/v1/records` payload | accepts `status: "pending" \| "confirmed" \| "cancelled" \| "no_show"` | rejects `status` field → **422** |
| `PUT /api/v1/records/{id}` payload | accepts `status` | rejects `status` field → **422** |
| `PATCH /api/v1/records/{id}` payload | accepts `status` | rejects `status` field → **422** |
| `GET /api/v1/records` response | includes `status` (stored value) | includes `status` (computed from visits) |
| `PATCH /api/v1/records/{id}` visits | unchanged | visits accept `status: VisitStatus` (`waiting/visited/missed/cancelled`) |
| `PATCH /api/v1/records/{id}` anonym_visits | exists (from `96a10fd`) | unchanged, but UI gets edit input |

### Database

- **No schema change.** The `records.status` column is kept for now; backend writes it from `computeRecordStatus(visits)` on every create/update. (Future: could become a generated column or be removed; tracked as a follow-up.)
- **Migration seeds:** existing `pending/confirmed/cancelled/no_show` values are mapped to the new enum on next visit-status update. For records with no visits, `status` is set to `waiting`.

---

## Data flow & state management

- **`useRecordData(recordId, clientId)`** — existing hook, returns `RecordWithDerived` (now has computed `status`).
- **`useRecordMutations()`** — existing hook, gains one new mutation: `updateAnonymVisits(recordId: string, anonymVisits: number)`.
- **`useUpdateVisitStatus(visitId)`** — new mutation, updates single `VisitItem.status`. Triggers `computeRecordStatus` on backend; React Query invalidation updates the record badge.
- **Atoms are pure:** receive data via props, dispatch events via callbacks. No `useQuery`/`useMutation` inside atoms.
- **Parents orchestrate:** `ClientRecordTab` and `ClientTab` own the React Query calls, threading data → atoms → mutation hooks.

---

## Error handling

| Edge case | Handling |
|---|---|
| `record.visits` empty (only `anonym_visits` slots) | `RecordHeader` shows "X мест (анонимные)" without `RecordVisitRow` rows |
| `record.anonym_visits > 0` editing | Inline `<input type="number" min="0">` in `RecordHeader`; debounced save via `updateAnonymVisits` |
| Visit delete with undo | 5-second `setTimeout` + undo toast (per `records.md:134`) — pattern lives in parent, atom is stateless |
| Payment delete with undo | Same pattern as visit delete |
| Optimistic updates | **Deferred** to Phase 2. Current pattern: `invalidateQueries(['records'])` on success. |
| Form validation | Zod in atom (e.g. `PaymentForm` validates `amount > 0`). Atom is self-contained. |
| Network error | React Query `isError` → inline error + retry button in atom |
| Status migration error | If a `VisitItem.status` value from old code reaches new code, `computeRecordStatus` returns `'waiting'` (safe default) — no crash |
| 0 visits, all `anonym_visits = 0` | Record can be deleted via existing `DELETE` endpoint — no change |
| `anonym_visits > 0` but `< len(visits)` | Allowed. `anonym_visits` is independent of visit count (e.g. "5 seats: 2 named visits + 3 anonym"). RecordHeader shows the breakdown. |
| `anonym_visits` edit: value goes negative | Input has `min={0}` (HTML validation + Zod). If client-side bypassed, backend `Field(ge=0)` returns 422. |
| `anonym_visits` edit causes `occupied + seats > capacity` | Backend re-validates capacity on PATCH. Returns 409 with message. UI shows the error inline. (Note: this is a tightening — current code only checks capacity on create, not on update. See `records.md:88-89` for the existing rule. **Decision needed from user** in implementation phase.) |

---

## Migration map (Wave 5 → Wave 6)

| Old (Wave 5) | New (Wave 6) | Where changed |
|---|---|---|
| `@memo/domain` `RecordStatus = pending\|confirmed\|cancelled\|no_show` | `VisitStatus = waiting\|visited\|missed\|cancelled` (only enum) | `packages/domain/src/record.ts` |
| `backend Record.status` write field | Derived from visits; rejected in POST/PUT/PATCH | `backend/src/models/record.py`, `backend/src/schemas/record.py`, `backend/src/api/v1/records.py`, `backend/src/services/record.py` |
| `frontend RecordStatus` config (3 copies) | Single `VISIT_STATUS_CONFIG` in `app/components/shared/config/VISIT_STATUS_CONFIG.ts` | All 3 files |
| `StatusPicker` (85 LOC, hand-rolled popover, 1 consumer) | Rebuilt on `CustomSelect` (~60 LOC, 4 consumers) | `app/components/shared/StatusPicker.tsx` |
| `StatusIcon` inline (35 LOC) ×2 | `StatusBadge` shared (1 place) | `app/components/shared/StatusBadge.tsx` |
| `CustomSelect` + `STATUS_LABELS` + `STATUS_COLORS` in `RecordsTable.tsx` (×2) + `ClientCardModal.tsx` | `<StatusBadge status={r.status} />` | All 3 files |
| `ClientRecordTab.tsx` (746 LOC) | ~200 LOC wrapper | 9 atoms consumed |
| `ClientTab.tsx` (559 LOC) | ~200 LOC wrapper | same 9 atoms consumed |
| Russian labels: `Ожидание/Посетил/Отменил/Неявка` | `Ожидание/Посетил/Неявка/Отменён` (per user 2026-06-20) | `VISIT_STATUS_CONFIG` |
| BookingFilters native `<select>` for status | `<StatusPicker variant="full">` with "Все статусы" option | `app/(main)/records/components/BookingFilters.tsx:128-141` |

---

## User Scenarios

> Each scenario maps to a Playwright E2E test (per testing-strategy-v2 / User Scenario workflow).

1. **Edit visit status from `/clients` updates record badge.** Admin opens a client's record tab → clicks `StatusPicker` on a visit → selects "Посетил" → record-level badge in `RecordHeader` flips from "Ожидание" to "Посетил" within 500 ms → no page reload. Covers the full data path: StatusPicker → callback → `useUpdateVisitStatus` → backend → React Query invalidation → derived `record.status` recompute → re-render.

2. **Add payment from activity modal updates totals.** Admin opens an activity's `ClientTab` in `ActivityDetailsModal` → clicks "+ Добавить платёж" → fills amount → submits → `PaymentTotals` updates immediately (cost unchanged, paid increases, remaining decreases) → payment persists across modal close + reopen.

3. **Edit `anonym_visits` in existing record.** Admin opens a record (from `/clients` or activity modal) → edits the `anonym_visits` input in `RecordHeader` from 0 to 2 → header text updates from "3 места" to "5 мест (3 + 2 анонимных)" within 500 ms → activity's `occupied` counter (in `ActivityCard` footer on schedule) increments by 2 after navigation. Covers: input → `updateAnonymVisits` mutation → invalidation → re-derive.

4. **Add visitor from `/clients` shows in list with new visit status.** Admin clicks "+ Добавить посетителя" in `ClientRecordTab` → fills name/age/tariff → submits → new `RecordVisitRow` appears in the list with default status "Ожидание" → record badge shows "Ожидание" (if no other visits) or unchanged (if other visits exist) → persists after reload.

5. **Same `StatusPicker` everywhere.** Open `/clients` modal, open activity's `ClientTab`, open `BookingFilters` status filter — all three use the same `StatusPicker` component with the same icons, the same labels (`Ожидание/Посетил/Неявка/Отменён`), and the same behaviour. Visual regression test (Playwright snapshot) verifies the components are pixel-identical.

6. **API rejects record `status` in payload.** Backend test: `POST /api/v1/records` with `{"status": "visited", ...}` returns **422** with detail `"Extra inputs are not permitted"`. Same for `PUT` and `PATCH`.

7. **`computeRecordStatus` derivation unit tests** (no UI):
   - 0 visits → `'waiting'`
   - 1 visit each status → that visit's status
   - mixed: 2 visited + 1 waiting → `'visited'`
   - all missed → `'missed'`
   - all cancelled → `'cancelled'`
   - mixed missed + waiting → `'waiting'`

---

## Implementation phases (for writing-plans)

This is one large wave; the plan must split it into independent, testable sub-tasks.

### Phase 0 — Backend status migration (MUST land before any frontend work)

- T0. **Alembic data migration** `4d5e6f_add_status_derivation.py`: re-map existing record statuses (see Risks: `pending → waiting`, `confirmed → visited`, etc.) on visits and recompute record `status`. Idempotent (safe to re-run).
- T1. `packages/domain`: replace `RecordStatus` with `VisitStatus` alias; export `computeRecordStatus`
- T2. `backend/src/models/record.py`: keep `status` column; document that it's derived
- T3. `backend/src/schemas/record.py`: `extra='forbid'` on `RecordCreate`, `RecordUpdate`, `RecordPatch`
- T4. `backend/src/services/record.py`: on every create/update, write `status = computeRecordStatus(visits)`
- T5. `backend/src/api/v1/records.py`: apply schemas; ensure GET includes derived `status`
- T6. Backend tests: `test_compute_record_status.py` (all 7 scenarios above) + 422 tests (3 endpoints × 1 case = 3 tests)

### Phase 1 — Frontend enum migration (after Phase 0 green)

- T7. `packages/domain` dist rebuild (consumed by `@memo/api-client` and admin)
- T8. `app/components/shared/config/VISIT_STATUS_CONFIG.ts`: single source — labels, colors, icons (extract from current `STATUS_LABELS`/`STATUS_COLORS` and `StatusPicker.tsx`)
- T9. Grep-and-replace: `RecordStatus` → `VisitStatus` everywhere in `frontend/admin/`
- T10. `app/components/shared/StatusPicker.tsx`: rebuild on `CustomSelect` (mirror `MasterPicker`); drop self-rolled popover
- T11. `app/components/shared/StatusBadge.tsx`: read-only badge using `VISIT_STATUS_CONFIG`
- T12. `RecordsTable.tsx` (×2 sites) + `ClientCardModal.tsx` (×1 site) + `BookingFilters.tsx` (×1 site) → replace inline STATUS_LABELS / native `<select>` with shared components
- T13. Update Russian labels: `Ожидание / Посетил / Неявка / Отменён`

### Phase 2 — Atoms extraction (after Phase 1 green)

- T14. `records/types.ts`: `RecordWithDerived` (record + computed status)
- T15. `records/RecordHeader.tsx`: name/phone/anonym_visits edit + status badge
- T16. `records/RecordVisitRow.tsx`: extract from both consumers
- T17. `payments/PaymentList.tsx`
- T18. `payments/PaymentForm.tsx`
- T19. `payments/PaymentTotals.tsx`
- T20. `visitors/AddVisitorForm.tsx`
- T21. `visitors/VisitorRow.tsx` (preview inside AddVisitorForm)
- T22. Atom unit tests (each component → 5-10 vitest cases)

### Phase 3 — Wire parents to atoms (after Phase 2 green)

- T23. `useRecordData` returns `RecordWithDerived` (replaces raw `record` with derived status)
- T24. `useRecordMutations` gains `updateAnonymVisits` and `updateVisitStatus`
- T25. `ClientRecordTab.tsx` rewritten as ~200 LOC wrapper consuming atoms
- T26. `ClientTab.tsx` rewritten as ~200 LOC wrapper consuming atoms
- T27. Integration tests (parent × atom × hook contracts)

### Phase 4 — End-to-end verification

- T28. E2E tests for all 5 user scenarios above
- T29. Visual regression: `StatusPicker` and `StatusBadge` snapshots match across all 4 call sites
- T30. `pytest-patterns` review: `test_compute_record_status.py` follows factory + fixture pattern
- T31. `vitest-playwright-patterns` review: scenario tests use Full Cycle pattern

### Acceptance gates

- Phase 0 → 1: backend test suite green, `test_compute_record_status.py` covers all 7 cases
- Phase 1 → 2: type-check green, no `RecordStatus` references remain in frontend
- Phase 2 → 3: atom unit tests pass, no regressions in existing `ClientRecordTab`/`ClientTab` tests
- Phase 3 → 4: integration tests pass, both wrappers < 250 LOC
- Phase 4 → done: all 5 user scenarios green in E2E

---

## Visual Compliance Checks

For Step 4.5 (Visual Compliance Gate) on Phase 3:

- [ ] `StatusBadge` renders the same icon + label across `/records` table, `/clients` modal, activity's `ClientTab`, and `BookingFilters` filter
- [ ] `RecordHeader` shows "X мест" (and "+ Y анонимных" if > 0) with edit input visible
- [ ] `PaymentTotals` shows "Стоимость", "Оплачено", "К оплате" with `--danger/--success` colors
- [ ] `StatusPicker` popover opens on click and shows all 4 VisitStatus options in Russian
- [ ] `RecordVisitRow` shows visit name, age, tariff, price, status, delete button
- [ ] `AddVisitorForm` collapses after submit; new visit appears in list immediately
- [ ] Both `ClientRecordTab` and `ClientTab` use the same `StatusPicker` component (no visual divergence)
- [ ] `RecordHeader` anonym_visits edit input has min=0, type=number, and debounced save (no flash of unsaved state)

---

## Out of scope (deferred to other waves)

- Optimistic updates for visits/payments/anonym_visits (Phase 2 in a follow-up wave)
- Pre-existing `ActivityDetailsModal.test.tsx` worker timeout (separate issue)
- Pre-existing E2E selector drift (4 stale tests, separate task)
- `anonym_visits` ≥ 0 in record creation: already supported via `POST` (Phase 0 only adds edit on existing record)
- Flexible seats (`seats` independent of `visits`) — tracked in `records.md:33–45` as `FUTURE REQUIREMENT`
- Per-visitor tariff editing (Wave 5 deviation, out of scope)
- `onUpdateRecord` no-op status mutation (Wave 5 known issue, will be fixed by `updateVisitStatus` here)

---

## Risks & open questions

- **Seed-data migration.** Existing records with `pending/confirmed/no_show` must be re-mapped on first read. `computeRecordStatus(visits)` will yield correct results if visits have their own statuses; for records without visit statuses (legacy data), backend must set `status='waiting'` and visit statuses from the record's old `status` (`pending` → `waiting`, `confirmed` → `visited`, `cancelled` → `cancelled`, `no_show` → `missed`). **Implementation:** add a one-shot Alembic data migration `4d5e6f_add_status_derivation.py` that runs `UPDATE visits SET status = <mapped> FROM records` and then `UPDATE records SET status = computeRecordStatus(visits)`.
- **Russian labels — awaiting user confirmation.** Proposed mapping: `waiting → Ожидание`, `visited → Посетил`, `missed → Неявка`, `cancelled → Отменён`. Wave 5 used "Отменил" (verb, past tense) for `cancelled`; user said "Отменён" is preferred. **Final decision in writing-plans.**
- **Capacity re-check on `anonym_visits` change.** The existing rule is "no capacity re-check on update" (`records.md:88-89`). With editable `anonym_visits`, a user could push an activity over capacity by bumping anonym_visits. **Decision needed:** tighten to "re-check on PATCH if `anonym_visits` or `seats` change" (recommended) or keep "no re-check" (current). Implementation plan will surface this as a Q.
- **Concurrent edits.** Two admins editing the same record → React Query last-write-wins. No new lock introduced here; same as today.
- **Visit delete cascade.** When deleting the last visit of a record, `computeRecordStatus([])` returns `'waiting'`. If the user meant to mark the record as cancelled, they must do it on a visit that doesn't exist — outside this scope; tracked as future improvement.

---

## Related issues

- #78 — StatusPicker refactor → **addressed by Phase 1**
- #79 — Record row duplication → **addressed by Phase 2 + 3**
- #82 — anonym_visits editing → **addressed by Phase 3 (T24)**
- #98 — Migration plan → **addressed by Phase 0**
- #93, #94, #95 — New UX issues (20 Jun) → **deferred, backlog**
- #95 (anonym display) → partially addressed by `RecordHeader` showing anonym_visits count

## Related docs

- `docs/domain-rules/records.md` (commit `c0c4a8d`) — source of truth for `VisitStatus` and derivation rules
- `docs/specs/2026-06-19-wave5-ux-bugs-design.md` — predecessor spec (Wave 5, the source of the drift)
- `docs/domain-rules/_overview.md` — cross-entity relationships
