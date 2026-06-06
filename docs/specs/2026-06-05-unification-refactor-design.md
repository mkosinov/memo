# Design Spec: Unification Refactoring

**Date:** 2026-06-05
**Status:** Draft
**Author:** @architect

## Problem Statement

Business logic, validation, and UI patterns are duplicated across multiple modals:
- `ActivityDetailsModal` (schedule page)
- `ClientRecordTab` (clients page)
- `NewBookingTab` (booking creation)

The same entities (Record, Activity, Client, Visitor) are managed in different ways with different validation rules, different API call sequences, and different UI patterns. This leads to:
- Inconsistent behavior across pages
- Bugs from duplicated logic
- Difficulty adding new features

## Goals

1. **Unify entity operations** — same validation, same API patterns, same UI components
2. **Fix known bugs** — booking count, console errors, null name/phone
3. **Extract reusable components** — ArtistPicker, mutation hooks
4. **Clean up dead code** — booking-context.tsx, artist-context.tsx

## Non-Goals

- Full EntityModal refactor (deferred to future phase)
- New feature development (only unification of existing features)
- Backend API changes (only frontend refactoring)

---

## Component 1: MasterPicker

**Purpose:** Reusable component for selecting a master with color indicator.

**Current state:**
- SettingsTab: colored span hack over native `<select>`
- ClientRecordTab: CustomSelect without color

**Target state:**
```tsx
<MasterPicker
  masters={masters}
  value={masterId}
  onChange={setMasterId}
/>
```

**Implementation:**
- Extend `CustomSelect` with `color` prop on options
- Each option shows colored square + name
- Used in: SettingsTab, ClientRecordTab, any future master selection

**Files:**
- Create: `frontend/admin/app/components/shared/MasterPicker.tsx`
- Modify: `frontend/admin/app/components/shared/CustomSelect.tsx` (add color support)
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx`
- Modify: `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`

---

## Component 2: Mutation Hooks

**Purpose:** Extract API call logic from components into reusable hooks.

**Current state:**
- ScheduleContext: inline mutations for activities
- ActivityDetailsModal: inline API calls for records
- ClientRecordTab: inline API calls for records
- ClientsContext: mutations for clients

**Target state:**
```tsx
// hooks/useRecordsMutations.ts
export function useRecordsMutations() {
  const createRecord = useMutation({ ... })
  const updateRecord = useMutation({ ... })
  const deleteRecord = useMutation({ ... })
  return { createRecord, updateRecord, deleteRecord }
}
```

**Files:**
- Create: `frontend/admin/hooks/useRecordsMutations.ts`
- Create: `frontend/admin/hooks/useActivitiesMutations.ts`
- Create: `frontend/admin/hooks/useClientsMutations.ts`
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`
- Modify: `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`
- Modify: `frontend/admin/contexts/ScheduleContext.tsx`

---

## Component 3: Flexible Seats

**Purpose:** Allow booking seats without specifying visitor names.

**Current behavior:**
- `seats` = `len(visits)` always
- Must provide visitor names when booking

**Target behavior:**
- User can specify `seats` count without visitors
- System creates placeholder visits (visitor_id = null)
- Visitors can be added later

**API changes:** None (backend already supports nullable visitor_id)

**Files:**
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx`
- Modify: `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`

---

## Component 4: Null Name/Phone Support

**Purpose:** Allow creating bookings without requiring name or phone.

**Current behavior:**
- Name required (toast "Заполните имя")
- Phone optional but client creation needs a name

**Target behavior:**
- Name optional (can be null)
- Phone optional
- System creates anonymous client if both are empty

**Files:**
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx`

---

## Component 5: Booking Count Fix

**Purpose:** ActivityCard occupied count updates after Record deletion.

**Current bug:**
- Delete Record → occupied count doesn't refresh

**Fix:**
- After Record deletion, invalidate activity queries
- Add `queryClient.invalidateQueries({ queryKey: ['activities'] })` after delete

**Files:**
- Modify: `frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx`

---

## Component 6: Dead Code Cleanup

**Purpose:** Remove unused code that causes TypeScript errors.

**Files to delete:**
- `frontend/admin/lib/booking-context.tsx` (mock data, not imported)
- `frontend/admin/lib/artist-context.tsx` (mock data, not imported)
- `frontend/admin/lib/chat-context.tsx` (if unused)

**Files to fix:**
- `frontend/admin/__tests__/buildSchedule.test.ts` (add missing maxAge)
- `frontend/admin/__tests__/timezone-dnd-bug.test.ts` (fix type mismatch)

---

## Implementation Order

| # | Task | Classification | Dependencies |
|---|------|---------------|--------------|
| 1 | Dead code cleanup | Small | None |
| 2 | MasterPicker component | Standard | None |
| 3 | Mutation hooks extraction | Standard | None |
| 4 | Booking count fix | Trivial | Task 3 |
| 5 | Null name/phone support | Small | Task 3 |
| 6 | Flexible seats | Standard | Task 3 |
| 7 | Integrate MasterPicker in SettingsTab | Small | Task 2 |
| 8 | Integrate MasterPicker in ClientRecordTab | Small | Task 2 |
| 9 | Refactor ActivityDetailsModal to use hooks | Standard | Task 3 |
| 10 | Refactor ClientRecordTab to use hooks | Standard | Task 3 |

---

## Testing Strategy

- **Unit tests:** Each new hook/component gets vitest tests
- **Integration tests:** Verify API call sequences work correctly
- **Visual tests:** ArtistPicker renders correctly in all modals
- **Regression:** Existing E2E tests must pass

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing functionality | High | incremental approach, test after each task |
| Hook extraction changes behavior | Medium | Compare API call sequences before/after |
| ArtistPicker visual regression | Low | Visual comparison with current implementation |

---

## Success Criteria

- [ ] MasterPicker works in SettingsTab and ClientRecordTab
- [ ] Booking count updates after Record deletion
- [ ] Name and phone are optional when creating Records
- [ ] Seats can be specified without visitor names
- [ ] All existing tests pass
- [ ] No TypeScript errors in modified files
- [ ] Dead code removed
- [ ] Mutation hooks extracted and used in both modals
