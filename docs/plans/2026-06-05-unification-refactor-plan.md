# Unification Refactoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify entity operations, extract reusable components, and fix known bugs across admin modals.

**Architecture:** Extract mutation hooks from inline component logic, create MasterPicker component, fix booking count/null fields/flexible seats, remove dead code.

**Tech Stack:** Next.js 14, TypeScript, React Query, Tailwind CSS, Vitest

---

## File Structure

```
frontend/admin/
├── app/components/shared/
│   ├── CustomSelect.tsx          ← MODIFY: add color support
│   └── MasterPicker.tsx          ← CREATE: new component
├── hooks/
│   ├── useRecordData.ts          ← CREATE: data fetching
│   ├── useRecordMutations.ts     ← CREATE: API mutations
│   └── useActivityMutations.ts   ← CREATE: activity mutations
├── app/components/modal/ActivityDetailsModal/
│   ├── ActivityDetailsModal.tsx  ← MODIFY: use hooks, fix booking count
│   ├── SettingsTab.tsx           ← MODIFY: use MasterPicker
│   └── NewBookingTab.tsx         ← MODIFY: null name/phone, flexible seats
├── app/(main)/clients/components/
│   └── ClientRecordTab.tsx       ← MODIFY: use hooks, MasterPicker
├── lib/
│   ├── booking-context.tsx       ← DELETE
│   └── artist-context.tsx        ← DELETE
└── __tests__/
    ├── useRecordMutations.test.ts ← CREATE
    └── MasterPicker.test.ts       ← CREATE
```

---

## Task 1: Dead Code Cleanup

**Classification:** Small
**Files:** Delete 2 files, fix 2 test files

### Steps

- [ ] 1.1 Delete `frontend/admin/lib/booking-context.tsx`
  ```bash
  rm frontend/admin/lib/booking-context.tsx
  ```

- [ ] 1.2 Delete `frontend/admin/lib/artist-context.tsx`
  ```bash
  rm frontend/admin/lib/artist-context.tsx
  ```

- [ ] 1.3 Check if `chat-context.tsx` is imported anywhere
  ```bash
  grep -r "chat-context" frontend/admin/app/ frontend/admin/lib/ --include="*.tsx" --include="*.ts"
  ```
  If no imports found, delete it too.

- [ ] 1.4 Fix `__tests__/buildSchedule.test.ts` — add missing `maxAge` field
  ```typescript
  // Add maxAge: '18' to both service objects in the test
  ```

- [ ] 1.5 Fix `__tests__/timezone-dnd-bug.test.ts` — add missing properties to ScheduleAdminDTO
  ```typescript
  // Add serviceName and duration to the test data
  ```

- [ ] 1.6 Run TypeScript check
  ```bash
  cd frontend/admin && npx tsc --noEmit
  ```

- [ ] 1.7 Commit
  ```bash
  git add -A && git commit -m "chore: remove dead code and fix TypeScript errors"
  ```

---

## Task 2: MasterPicker Component

**Classification:** Standard
**Files:** Create MasterPicker, modify CustomSelect

### Steps

- [ ] 2.1 Add `color` option support to CustomSelect
  ```typescript
  // frontend/admin/app/components/shared/CustomSelect.tsx
  // Add to CustomSelectOption interface:
  interface CustomSelectOption {
    value: string;
    label: string;
    icon?: React.ReactNode;
    color?: string;  // ← ADD THIS
  }
  
  // In the option render, add colored square before label:
  {option.color && (
    <span
      className="w-3 h-3 rounded-sm shrink-0"
      style={{ backgroundColor: option.color }}
    />
  )}
  ```

- [ ] 2.2 Create MasterPicker component
  ```typescript
  // frontend/admin/app/components/shared/MasterPicker.tsx
  'use client';
  
  import { CustomSelect, type CustomSelectOption } from './CustomSelect';
  import type { Master } from '@memo/api-client';
  
  interface MasterPickerProps {
    masters: Master[];
    value: string;
    onChange: (value: string) => void;
    className?: string;
  }
  
  export function MasterPicker({ masters, value, onChange, className }: MasterPickerProps) {
    const options: CustomSelectOption[] = [
      { value: '', label: 'Не выбран' },
      ...(Array.isArray(masters) ? masters.map(m => ({
        value: m.id,
        label: `${m.first_name} ${m.last_name}`,
        color: m.color,
      })) : []),
    ];
  
    return (
      <CustomSelect
        value={value}
        options={options}
        onChange={onChange}
        className={className}
      />
    );
  }
  ```

- [ ] 2.3 Write test for MasterPicker
  ```typescript
  // frontend/admin/__tests__/MasterPicker.test.tsx
  import { render, screen, fireEvent } from '@testing-library/react';
  import { MasterPicker } from '@/app/components/shared/MasterPicker';
  
  const mockMasters = [
    { id: '1', first_name: 'Анна', last_name: 'Иванова', color: '#FF0000' },
    { id: '2', first_name: 'Борис', last_name: 'Петров', color: '#00FF00' },
  ];
  
  describe('MasterPicker', () => {
    it('renders with color indicators', () => {
      render(<MasterPicker masters={mockMasters} value="" onChange={() => {}} />);
      expect(screen.getByText('Не выбран')).toBeInTheDocument();
    });
    
    it('calls onChange with selected master id', () => {
      const onChange = vi.fn();
      render(<MasterPicker masters={mockMasters} value="" onChange={onChange} />);
      fireEvent.click(screen.getByText('Не выбран'));
      fireEvent.click(screen.getByText('Иванова'));
      expect(onChange).toHaveBeenCalledWith('1');
    });
  });
  ```

- [ ] 2.4 Run tests
  ```bash
  cd frontend/admin && npx vitest run __tests__/MasterPicker.test.tsx
  ```

- [ ] 2.5 Commit
  ```bash
  git add -A && git commit -m "feat: add MasterPicker component with color indicator"
  ```

---

## Task 3: useRecordData Hook

**Classification:** Standard
**Files:** Create hook, modify ClientRecordTab

### Steps

- [ ] 3.1 Create `useRecordData` hook
  ```typescript
  // frontend/admin/hooks/useRecordData.ts
  'use client';
  
  import { useQuery } from '@tanstack/react-query';
  import { useMemo } from 'react';
  import {
    getRecord, getClientVisitors, getActivity, getServices,
    getMasters, getLocations, getPayments,
  } from '@memo/api-client';
  
  export function useRecordData(recordId: string, clientId: string) {
    const { data: record, isLoading } = useQuery({
      queryKey: ['record', recordId],
      queryFn: () => getRecord(recordId),
    });
  
    const { data: visitors = [] } = useQuery({
      queryKey: ['visitors', clientId],
      queryFn: () => getClientVisitors(clientId),
      enabled: !!clientId,
    });
  
    const { data: activity } = useQuery({
      queryKey: ['activity', record?.activity_id],
      queryFn: () => getActivity(record!.activity_id),
      enabled: !!record?.activity_id,
    });
  
    const { data: services = [] } = useQuery({
      queryKey: ['services'],
      queryFn: () => getServices(),
    });
  
    const { data: masters = [] } = useQuery({
      queryKey: ['masters'],
      queryFn: () => getMasters(),
    });
  
    const { data: locations = [] } = useQuery({
      queryKey: ['locations'],
      queryFn: () => getLocations(),
    });
  
    const { data: payments = [] } = useQuery({
      queryKey: ['payments', recordId],
      queryFn: () => getPayments({ record_id: recordId }),
      enabled: !!recordId,
    });
  
    const visitorsMap = useMemo(() => {
      const map = new Map<string, { name: string; age: number | null }>();
      if (Array.isArray(visitors)) {
        visitors.forEach(v => map.set(v.id, { name: v.name, age: v.age }));
      }
      return map;
    }, [visitors]);
  
    const tariffs = useMemo(() => {
      if (!Array.isArray(services)) return [];
      const service = services.find(s => s.id === activity?.service_id);
      return service?.tariffs ?? [];
    }, [services, activity]);
  
    return {
      record, visitors, activity, services, masters, locations,
      payments, visitorsMap, tariffs, isLoading,
    };
  }
  ```

- [ ] 3.2 Run TypeScript check
  ```bash
  cd frontend/admin && npx tsc --noEmit
  ```

- [ ] 3.3 Commit
  ```bash
  git add -A && git commit -m "feat: add useRecordData hook for data fetching"
  ```

---

## Task 4: useRecordMutations Hook

**Classification:** Standard
**Files:** Create hook

### Steps

- [ ] 4.1 Create `useRecordMutations` hook
  ```typescript
  // frontend/admin/hooks/useRecordMutations.ts
  'use client';
  
  import { useQueryClient } from '@tanstack/react-query';
  import { useCallback } from 'react';
  import {
    patchRecord, deleteRecord as apiDeleteRecord,
    patchActivity, createPayment, deletePayment as apiDeletePayment,
    createVisitor, deleteVisitor as apiDeleteVisitor,
  } from '@memo/api-client';
  
  interface VisitData {
    visitor_id?: string | null;
    price: number;
    custom_price?: number | null;
    status?: string;
  }
  
  export function useRecordMutations(recordId: string) {
    const queryClient = useQueryClient();
  
    const invalidateRecord = useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      queryClient.invalidateQueries({ queryKey: ['records'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    }, [queryClient, recordId]);
  
    const saveRecord = useCallback(async (data: {
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
  
      invalidateRecord();
    }, [recordId, invalidateRecord]);
  
    const deleteRecord = useCallback(async () => {
      await apiDeleteRecord(recordId);
      invalidateRecord();
    }, [recordId, invalidateRecord]);
  
    const addVisitor = useCallback(async (data: {
      client_id: string;
      name: string;
      age?: number;
    }) => {
      return await createVisitor(data);
    }, []);
  
    const deleteVisitor = useCallback(async (
      visitorId: string,
      currentVisits: VisitData[],
    ) => {
      await apiDeleteVisitor(visitorId);
      const remaining = currentVisits.filter(v => v.visitor_id !== visitorId);
      await patchRecord(recordId, { visits: remaining });
      invalidateRecord();
    }, [recordId, invalidateRecord]);
  
    const addPayment = useCallback(async (amount: number, method: string) => {
      await createPayment({ record_id: recordId, amount, method: method as any });
      invalidateRecord();
    }, [recordId, invalidateRecord]);
  
    const deletePayment = useCallback(async (paymentId: string) => {
      await apiDeletePayment(paymentId);
      invalidateRecord();
    }, [invalidateRecord]);
  
    return {
      saveRecord, deleteRecord, addVisitor,
      deleteVisitor, addPayment, deletePayment,
    };
  }
  ```

- [ ] 4.2 Run TypeScript check
  ```bash
  cd frontend/admin && npx tsc --noEmit
  ```

- [ ] 4.3 Commit
  ```bash
  git add -A && git commit -m "feat: add useRecordMutations hook for API operations"
  ```

---

## Task 5: Integrate MasterPicker in SettingsTab

**Classification:** Small
**Files:** Modify SettingsTab

### Steps

- [ ] 5.1 Replace artist select in SettingsTab with MasterPicker
  ```typescript
  // frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx
  // Replace lines 240-274 (artist select with color hack) with:
  import { MasterPicker } from '@/app/components/shared/MasterPicker';
  
  // In the JSX, replace the artist select block:
  <div className="flex-1">
    <label className="text-xs font-medium text-ink-mid block mb-1" htmlFor="settings-master">
      Мастер
    </label>
    <MasterPicker
      masters={artists}
      value={masterId}
      onChange={(value) => {
        setMasterId(value);
        onUpdate({ masterId: value });
      }}
      className={`${inputClass} appearance-none`}
    />
  </div>
  ```

- [ ] 5.2 Remove the old color dot hack (lines 264-273)

- [ ] 5.3 Run tests
  ```bash
  cd frontend/admin && npx vitest run
  ```

- [ ] 5.4 Commit
  ```bash
  git add -A && git commit -m "feat: use MasterPicker in SettingsTab"
  ```

---

## Task 6: Integrate MasterPicker in ClientRecordTab

**Classification:** Small
**Files:** Modify ClientRecordTab

### Steps

- [ ] 6.1 Replace master select in ClientRecordTab with MasterPicker
  ```typescript
  // frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx
  // Add import:
  import { MasterPicker } from '@/app/components/shared/MasterPicker';
  
  // Replace the master CustomSelect (lines 470-477) with:
  <div>
    <label className="text-xs font-medium text-ink-mid block mb-1">Мастер</label>
    <MasterPicker
      masters={masters}
      value={masterId}
      onChange={(v) => { setMasterId(v); markChanged(); }}
      className={`${inputClass} appearance-none`}
    />
  </div>
  ```

- [ ] 6.2 Run tests
  ```bash
  cd frontend/admin && npx vitest run
  ```

- [ ] 6.3 Commit
  ```bash
  git add -A && git commit -m "feat: use MasterPicker in ClientRecordTab"
  ```

---

## Task 7: Fix Booking Count After Deletion

**Classification:** Trivial
**Files:** Modify ActivityDetailsModal

### Steps

- [ ] 7.1 Add activity query invalidation after record deletion
  ```typescript
  // frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
  // In handleDeleteRecord, after apiDeleteRecord, add:
  const handleDeleteRecord = useCallback(async (recordId: string) => {
    await apiDeleteRecord(recordId);
    showToast('Запись удалена');
    setActiveTab('settings');
    queryClient.invalidateQueries({ queryKey: ['records'] });
    queryClient.invalidateQueries({ queryKey: ['activities'] }); // ← ADD THIS
  }, [queryClient]);
  ```

- [ ] 7.2 Run tests
  ```bash
  cd frontend/admin && npx vitest run
  ```

- [ ] 7.3 Commit
  ```bash
  git add -A && git commit -m "fix: invalidate activities query after record deletion"
  ```

---

## Task 8: Null Name/Phone Support

**Classification:** Small
**Files:** Modify NewBookingTab

### Steps

- [ ] 8.1 Remove name required validation in NewBookingTab
  ```typescript
  // frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx
  // Remove lines 66-68 (name validation):
  // BEFORE:
  if (!data.name) {
    showToast('Заполните имя');
    return;
  }
  
  // AFTER: (remove this block entirely)
  ```

- [ ] 8.2 Allow submit even when both name and phone are empty
  ```typescript
  // The form should still work — backend supports all-null Client
  ```

- [ ] 8.3 Run tests
  ```bash
  cd frontend/admin && npx vitest run
  ```

- [ ] 8.4 Commit
  ```bash
  git add -A && git commit -m "feat: allow creating records without name or phone"
  ```

---

## Task 9: Flexible Seats

**Classification:** Standard
**Files:** Modify NewBookingTab

### Steps

- [ ] 9.1 Add seats input to NewBookingTab
  ```typescript
  // frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx
  // Add state:
  const [seatsCount, setSeatsCount] = useState(1);
  
  // Add input field before visitors section:
  <div>
    <label className="text-xs font-medium text-ink-mid block mb-1">Мест</label>
    <input
      type="number"
      min={1}
      max={10}
      value={seatsCount}
      onChange={(e) => setSeatsCount(Number(e.target.value))}
      className={inputClass}
      style={inputStyle}
    />
  </div>
  ```

- [ ] 9.2 Modify createRecord call to include seats
  ```typescript
  // In handleNewBookingSubmit, pass seats to createRecord:
  await createRecord({
    activity_id: activityId,
    client_id: clientId,
    seats: seatsCount, // ← ADD THIS
    visits: visitors.length > 0 ? visitors.map(/* ... */) : [],
  });
  ```

- [ ] 9.3 Run tests
  ```bash
  cd frontend/admin && npx vitest run
  ```

- [ ] 9.4 Commit
  ```bash
  git add -A && git commit -m "feat: add seats count input to booking form"
  ```

---

## Task 10: Refactor ActivityDetailsModal to Use Hooks

**Classification:** Standard
**Files:** Modify ActivityDetailsModal

### Steps

- [ ] 10.1 Replace inline API calls with useRecordMutations hook
  ```typescript
  // frontend/admin/app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx
  // Import and use the hook:
  import { useRecordMutations } from '@/hooks/useRecordMutations';
  
  // In the component, use the hook for each record tab:
  const { saveRecord, deleteRecord, addPayment } = useRecordMutations(recordId);
  ```

- [ ] 10.2 Remove duplicated API call logic
  - Remove inline `handleDeleteRecord` (use `deleteRecord` from hook)
  - Remove inline `handleAddPayment` (use `addPayment` from hook)

- [ ] 10.3 Run tests
  ```bash
  cd frontend/admin && npx vitest run
  ```

- [ ] 10.4 Commit
  ```bash
  git add -A && git commit -m "refactor: use useRecordMutations in ActivityDetailsModal"
  ```

---

## Task 11: Refactor ClientRecordTab to Use Hooks

**Classification:** Standard
**Files:** Modify ClientRecordTab

### Steps

- [ ] 11.1 Replace inline data fetching with useRecordData hook
  ```typescript
  // frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx
  import { useRecordData } from '@/hooks/useRecordData';
  import { useRecordMutations } from '@/hooks/useRecordMutations';
  
  // Replace 7 useQuery calls with:
  const { record, visitors, activity, services, masters, locations, payments, visitorsMap, tariffs, isLoading } =
    useRecordData(recordId, clientId);
  
  // Replace inline API calls with:
  const { saveRecord, deleteRecord, addVisitor, deleteVisitor, addPayment, deletePayment } =
    useRecordMutations(recordId);
  ```

- [ ] 11.2 Remove duplicated logic
  - Remove inline `invalidateRecord` function
  - Remove inline `handleDeleteVisitor` (use `deleteVisitor` from hook)
  - Remove inline `handleAddPayment` (use `addPayment` from hook)
  - Remove inline `handleDeletePayment` (use `deletePayment` from hook)

- [ ] 11.3 Verify component size reduced
  ```bash
  wc -l frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx
  # Should be ~300 lines instead of 764
  ```

- [ ] 11.4 Run full test suite
  ```bash
  cd frontend/admin && npx vitest run
  ```

- [ ] 11.5 Commit
  ```bash
  git add -A && git commit -m "refactor: use useRecordData and useRecordMutations in ClientRecordTab"
  ```

---

## Final Verification

- [ ] All TypeScript errors resolved: `npx tsc --noEmit`
- [ ] All tests pass: `npx vitest run`
- [ ] Build succeeds: `npx next build`
- [ ] No console.log in production code
- [ ] MasterPicker works in SettingsTab and ClientRecordTab
- [ ] Booking count updates after deletion
- [ ] Name and phone are optional
- [ ] Seats input works
