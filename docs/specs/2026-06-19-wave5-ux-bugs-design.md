# Wave 5 — 14 P1/P3 UX Bugs in Admin

> Date: 2026-06-19
> Status: **DESIGN** (G1a approved; awaiting G1b written approval)
> Branch (target): `fix/wave5-ux-bugs`
> Strategy: **single PR with all 14 issues**, flat list, issue-numbered tasks
> Closes: #74, #75, #76, #77, #78, #79, #80, #81, #82, #83, #84, #85, #86

## Context

Thirteen open issues (#74–#86 excluding closed #73) describe broken UX in
`ActivityDetailsModal`, the `ClientTab`/`SettingsTab`/`NewBookingTab` children,
the `ActivityCard` occupied counter, and the schedule grid backdrop blur.

Most bugs share a small set of root causes:
- React Query cache is not invalidated after mutations (#79, #85)
- `ClientTab` has dead `onClick` handlers (#75) and the wrong navigation target (#76)
- Status labels in code don't match the spec wording (#77)
- Status control is a `<select>` but the spec calls for an icon picker (#78)
- Backend `count_records` returns count, not seats-sum, and ignores status (#84)
- Schedule grid uses `z-[110]` on the overlap badge — above the modal's `z-50` (#86)
- New booking form payload may not match the Pydantic schema (#80)
- "Неизвестный" placeholder hides identity; spec wants phone as fallback or `placeholder="Не указано"` (#81)
- Visitor row in `ClientTab` doesn't render `seats` (#82)
- Settings tab stacks "Приватное" label and switch on one line (#83)
- Modal has `maxHeight: '85vh'` without a fixed height — content height drives modal height (#74)

## Goal

Fix all 14 bugs in a single PR (`fix/wave5-ux-bugs`) with one commit per issue.
Each commit:
- Has a focused diff (one component or one backend function)
- Has tests (RED → GREEN) where applicable
- Is reviewable in isolation (≤200 lines, one concern per commit)

## Out of Scope

- New design (e.g. icon set redesign, full StatusPicker component library)
- Backend API contract changes (no new fields; #81 stays pure-frontend)
- Performance refactors (e.g. denormalizing `occupied` into a separate column)
- Migration of test seed data to add missing `client.name` values
- i18n / multi-language support

## Approach Summary

| # | Issue | P | Component | Fix |
|---|-------|-----|-----------|-----|
| 1 | #74 | P3 | `ActivityDetailsModal.tsx` | Add fixed `h-[80vh]` + `overflow-hidden` modal; `overflow-y-auto` on content area |
| 2 | #75 | P1 | `ClientTab.tsx` | Wire `+ Добавить посетителя` onClick to inline form (name + age + tariff), call `createVisitor` + `patchRecord` |
| 3 | #76 | P3 | `ClientTab.tsx` | Replace `<Link target="_blank">` with `useRouter().push('/clients/'+id)` + close modal |
| 4 | #77 | P3 | `ClientTab.tsx` | Update `STATUS_CONFIG` labels to `Ожидание / Посетил / Отменил / Неявка` |
| 5 | #78 | P3 | `ClientTab.tsx` | Replace `<select>` with icon-button + popover (use existing SVG icons already in the file) |
| 6 | #79 | P1 | `ClientTab.tsx` | Add `invalidateRecord()` after `apiDeletePayment` |
| 7 | #80 | P1 | `NewBookingTab.tsx` + `ActivityDetailsModal.tsx` | Audit `createRecord` payload (verify `phone` is passed, `seats` is number, `visits` schema matches); add `console.warn` removed before merge; rely on hook for invalidation |
| 8 | #81 | P1 | `ClientTab.tsx` + `ActivityDetailsModal.tsx` | Add `placeholder="Не указано"` to name/phone inputs; tab label falls back to phone if name is null |
| 9 | #82 | P3 | `ClientTab.tsx` | Render `seats` in visitor row (with Russian pluralisation: 1 место / 2-4 места / 5-20 мест) |
| 10 | #83 | P3 | `SettingsTab.tsx` | Replace inline `flex items-center gap-2` for "Приватное" with `flex-col items-start` |
| 11 | #84 | P1 | `backend/src/services/activity.py` + `backend/src/api/v1/activities.py` | Change `count_records` to `sum_active_seats` (`SUM(seats) WHERE status IN ('pending','confirmed','visited')`); add unit test |
| 12 | #85 | P1 | `useRecordMutations.ts` + `ActivityDetailsModal.tsx` | Move `createRecord` flow into the hook (`createRecord` mutation), call `invalidateRecord()` after success; also invalidate `['activities']` to refresh `occupied` |
| 13 | #86 | P3 | `ActivityDetailsModal.tsx` + `DayColumn.tsx` | Raise modal z-index from `z-50` to `z-[200]` (above all schedule grid elements) — keeps modal as single source of stacking order |

## Architecture Decisions

### A1. Single z-index root for modals

`ActivityDetailsModal` currently uses `z-50`. Schedule grid uses `z-[30]`, `z-[110]`.
We will:
- Promote modal to `z-[200]`
- Add a Tailwind comment in `globals.css` documenting the stacking order:
  - `0–30` — schedule grid content
  - `50–149` — popovers and tooltips
  - `150–199` — toasts
  - `200+` — modals

This is a small CSS-level decision, not an architectural change. It prevents
future bugs of the same shape.

### A2. Status labels — frontend only

The current code uses enum `pending / confirmed / cancelled / no_show` (matches
backend). Spec wants display labels `Ожидание / Посетил / Отменил / Неявка`.

**Decision:** keep enum unchanged (backend stable). Add display labels in
`STATUS_DISPLAY` map. This is a presentational change.

For #78 (icon picker), the icons already exist in `ClientTab.tsx:29-62` as
`StatusIcon` component. We will reuse them.

### A3. occupied — backend aggregation

Currently `count_records` returns `COUNT(*)` of all records. Fix:
- Add `sum_active_seats(activity_id)` returning `SUM(seats) WHERE status IN (...)`
- Filter set: backend's record statuses (`pending`, `confirmed`, `cancelled`, `no_show`)
  - Active = `pending` + `confirmed` (visited maps to confirmed in our model)
- Update `_to_response` to call the new method
- Add integration test: create 3 records (seats 1+2+3), cancel one, expect `occupied=3` (1+2)

Note: spec says "sum seats" but the spec lists status set `{Ожидание, Посетил}`.
"Посетил" maps to `confirmed` in our model. Cancelled / no_show excluded.

### A4. Create-record flow — hook responsibility

`ActivityDetailsModal.handleNewBookingSubmit` (lines 116–170) does:
1. `searchClientByPhone` / `createClient`
2. `createVisitor` (per visitor)
3. `createRecord` (with visits)

Currently this bypasses `useRecordMutations`. We will:
- Add a `createRecord` method to `useRecordMutations(activityId)` (note: hook will need to take `activityId` as well as `recordId`)
- Move the 3-step logic into the hook
- Call `queryClient.invalidateQueries({ queryKey: ['records'] })` AND `['activities']` after success
- Modal calls `createRecord({...})` and switches tab to settings

This is a small refactor that fixes #85 as a side effect of #80.

### A5. Frontend-only #81

Add `placeholder="Не указано"` (gray text, native HTML behavior) to:
- `client-name` input in `ClientTab.tsx`
- `client-phone` input in `ClientTab.tsx`

In `ActivityDetailsModal.tsx:91-98`:
```ts
label: client?.name?.trim() || client?.phone || 'Без контакта',
sublabel: client?.name?.trim() ? (client?.phone || '') : '',
```

So if name exists → label=name, sublabel=phone.
If name missing → label=phone, no sublabel.
If both missing → label="Без контакта".

## Components

### Modified

| File | Lines | What changes |
|------|-------|--------------|
| `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` | 116–170, 91–98, 273, 282–285 | Fixed height, new tab label logic, raise z-index, refactor create-record to hook |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` | 22–27, 107–114, 146, 155–173, 180–193, 202–212, 213 | Status labels, deletePayment invalidation, StatusPicker, SPA navigation, add-visitor form, placeholders, seats display |
| `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx` | 154–175 | "Приватное" stacked layout |
| `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx` | minor | Field labels, payload correctness audit (no logic change if payload is OK) |
| `frontend/admin/hooks/useRecordMutations.ts` | 22–103 | Add `createRecord` mutation, accept `activityId` |
| `backend/src/services/activity.py` | 61–70 | Replace `count_records` with `sum_active_seats` |
| `backend/src/api/v1/activities.py` | 30–38 | Call new method |
| `backend/tests/test_edge_cases.py` | 320–340 | Add new test for sum+status filter |
| `frontend/admin/app/globals.css` (or tailwind config) | – | Comment documenting z-index order |

### New

| File | Purpose |
|------|---------|
| `frontend/admin/app/components/modal/ActivityDetailsModal/StatusPicker.tsx` | Icon-button + popover component for status (4 icons reused from existing `StatusIcon`) |
| `frontend/admin/__tests__/StatusPicker.test.tsx` | Unit test: renders 4 options, calls onChange, closes on outside click |
| `frontend/admin/e2e/wave5-*.spec.ts` (or extend existing) | E2E: 4 new tests (modal height stable; visitor add+save; profile SPA nav; occupied excludes cancelled) |
| `frontend/admin/__tests__/pluralize.test.ts` | Unit test for Russian seats pluralisation helper |

## Data Flow

```
[User clicks activity] → ActivityDetailsModal opens
                            ↓
                       useRecordMutations(activityId)  ← NEW
                            ↓
                       createRecord({phone, name, seats, visits})
                            ↓
                       invalidate(['records']) + invalidate(['activities'])
                            ↓
                       UI updates: new tab appears, occupied counter updates
```

## Error Handling

- `createRecord` failure → toast "Ошибка создания записи" (existing)
- `deletePayment` failure → toast "Ошибка удаления оплаты" (existing) + revert
- `addVisitor` (ClientTab #75) failure → toast "Ошибка добавления посетителя" (NEW)
- `updateRecordStatus` (StatusPicker #78) failure → revert to previous status + toast
- Backend `sum_active_seats` failure → fallback to 0 + warning log (defensive)

## Testing Strategy

**Per the project's TDD workflow (RED → GREEN → REFACTOR):**

### Backend tests

| Test | File | Asserts |
|------|------|---------|
| `test_sum_active_seats` | `backend/tests/test_edge_cases.py` | 3 records (seats 1+2+3) → `occupied=6` |
| `test_sum_excludes_cancelled` | same | cancel one → `occupied` decreases by its seats |
| `test_sum_excludes_no_show` | same | no_show → excluded |
| `test_occupied_zero_no_records` | same | empty → `occupied=0` |

### Frontend unit tests

| Test | File | Asserts |
|------|------|---------|
| `StatusPicker renders 4 icons` | `StatusPicker.test.tsx` | All 4 statuses render, current is highlighted |
| `StatusPicker calls onChange` | same | Click different status → onChange called |
| `pluralizeSeats` | `pluralize.test.ts` | 1 → "место", 2-4 → "места", 5-20 → "мест", 21 → "место" |
| `ClientTab delete payment invalidates` | `ClientTab.test.tsx` | After delete, queryClient.invalidateQueries called with `['records']` |
| `ClientTab open profile navigates` | same | Click link → router.push called with `/clients/{id}` |
| `ClientTab add visitor form` | same | Click → form appears; submit → createVisitor called |
| `ActivityDetailsModal height stable` | same | Same height on tab switch |

### E2E tests

| Test | Asserts |
|------|---------|
| `modal-height-stable-on-tab-switch.spec.ts` | Open modal, switch tabs, measure height: equal within 1px |
| `add-visitor-from-client-tab.spec.ts` | Open record → click "Добавить посетителя" → fill form → submit → new visitor in list |
| `open-profile-spa-nav.spec.ts` | Click "Открыть профиль" → URL is `/clients/{id}` (no new tab) |
| `occupied-excludes-cancelled.spec.ts` | Create activity 10 seats, add 2 records (3+3), cancel one → card shows 3/10 |
| `x-cards-blurred.spec.ts` | Open modal → "x cards" badge has `backdrop-filter: blur` applied (or is hidden behind modal) |

## User Scenarios

(Required for E2E mapping per testing-strategy-v2.)

1. **Admin opens activity, switches between tabs — modal stays put.**
   → E2E: `modal-height-stable-on-tab-switch`

2. **Admin adds a new visitor to an existing record — form opens, saves, list updates.**
   → E2E: `add-visitor-from-client-tab`

3. **Admin clicks "Открыть профиль" — navigates to client card via SPA (no new tab).**
   → E2E: `open-profile-spa-nav`

4. **Admin cancels a record — activity occupancy decreases correctly.**
   → E2E: `occupied-excludes-cancelled`

5. **Admin opens modal — schedule behind it is uniformly blurred including "x cards" badge.**
   → E2E: `x-cards-blurred`

6. **Admin changes record status — icon updates, persisted to backend.**
   → Unit test: `StatusPicker calls onChange` + integration test in `test_edge_cases.py`

7. **Admin adds record with name+phone+seats — all fields appear in the new tab without F5.**
   → Manual: covered by `add-visitor-from-client-tab` E2E

## Visual Compliance Checks

For the Visual Compliance Gate (Step 4.5):

- [ ] Modal height is constant across `settings` ↔ `client-*` tabs (visual diff ≤ 1px)
- [ ] "Приватное" label and toggle are stacked vertically (`flex-col` with `items-start`)
- [ ] Status display is an icon, not text (in `client-*` tab) — except inside the popover
- [ ] Visitor row shows `seats` count with Russian pluralisation
- [ ] `placeholder="Не указано"` is visible in name/phone inputs when empty
- [ ] "x cards" badge is hidden (under modal) when modal is open
- [ ] Card footer shows correct `occupied/capacity` (sum of seats, excludes cancelled)

## Risk & Rollback

| Risk | Mitigation |
|------|------------|
| Refactor of `useRecordMutations` may break existing tests | Run full vitest + playwright after each task; small diff per commit |
| Backend `sum_active_seats` may be slower than `count_records` | Both are O(1) on the records table; index `Record.activity_id` already exists |
| Raising modal z-index may break existing toasts | Toasts use `z-150`; modal is `z-200`; toasts stay above modal — confirm visually |
| E2E "modal height stable" may be flaky on CI | Use Playwright's `boundingBox` and assert within ±2px tolerance |

**Rollback:** single PR revert. No migration, no API contract change (frontend-only for #81, enum preserved for #77).

## Files & Line Budget

| Category | Approx lines |
|----------|--------------|
| Frontend components (ActivityDetailsModal + 3 tabs) | ~250 changed |
| Frontend hook (useRecordMutations) | ~50 changed |
| Backend service + API | ~30 changed |
| Backend tests | ~80 new |
| Frontend unit tests | ~200 new |
| Frontend E2E | ~150 new |
| **Total** | **~760 lines** across 14 commits |

## Plan

After spec approval, the implementation plan (`docs/plans/2026-06-19-wave5-ux-bugs-plan.md`)
will contain 14 bite-sized tasks — one per issue — in this order:

| Order | Issue | Tier | Reason |
|-------|-------|------|--------|
| 1 | #84 | standard | Backend fix first; unblocks visual regression test for `occupied` |
| 2 | #85 | standard | Centralises mutation flow; refactor needed before #80 |
| 3 | #80 | small | Relies on #85 hook |
| 4 | #75 | small | Form in ClientTab; small scope |
| 5 | #76 | trivial | One-line change (Link → router.push) |
| 6 | #79 | small | One-line addition (invalidateRecord in deletePayment) |
| 7 | #81 | small | Placeholder additions; tab label logic |
| 8 | #77 | trivial | String changes in STATUS_CONFIG |
| 9 | #78 | standard | New StatusPicker component |
| 10 | #82 | small | Add seats display + pluralise helper + unit test |
| 11 | #83 | trivial | Tailwind class change in SettingsTab |
| 12 | #74 | small | Height/overflow changes in modal |
| 13 | #86 | trivial | Z-index change in modal + DayColumn |
| 14 | tests | standard | E2E for visual changes (#74, #78, #84, #86) |

Tasks 1–3 are sequenced first because they touch the data layer.
Tasks 12–13 are last because they're visual polish with simple fixes.
Task 14 is final E2E coverage and visual regression baseline.
