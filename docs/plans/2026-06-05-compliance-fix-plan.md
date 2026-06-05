# Admin Clients — Bug Fix & Compliance Plan

> **Goal:** Bring implementation to 100% spec compliance. Fix all missing elements, broken features, and add full test coverage.

**Branch:** `feat/admin-clients`
**Spec:** `docs/specs/2026-06-04-admin-clients-design.md`

---

## Summary

| Category | Count |
|----------|-------|
| Missing elements | 14 |
| Partially implemented | 13 |
| Broken features | 5 |
| Schema bugs | 2 |
| **Total to fix** | **34** |

---

## Phase 1: Schema & API Fixes (Critical)

### Fix 1.1: ClientResponseSchema — name/phone nullable
**File:** `packages/api-client/src/schemas.ts`
```typescript
// Before
name: z.string(),
phone: z.string(),

// After
name: z.string().nullable(),
phone: z.string().nullable(),
```

### Fix 1.2: ClientCreateSchema — name optional
**File:** `packages/api-client/src/schemas.ts`
```typescript
// Before
name: z.string(),

// After
name: z.string().optional(),
```

---

## Phase 2: Client Card — Client Tab

### Fix 2.1: Add is_active toggle
**File:** `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx`

**UI:**
```
Контактные данные              Статистика
┌─────────────┬─────────────┬─────────────┐
│ Имя:        │ Телефон:    │ Канал:      │
│ [_______ ]  │ [+7 ...   ] │ [___▾]      │
├─────────────┼─────────────┼─────────────┤
│ Email:      │ Статус:     │             │
│ [_______ ]  │ [Активна ✓] │             │
└─────────────┴─────────────┴─────────────┘
```

Add toggle/checkbox for `is_active`:
```typescript
<div>
    <label className="text-xs font-medium text-ink-mid block mb-1">Статус</label>
    <label className="flex items-center gap-2">
        <input
            type="checkbox"
            checked={client.is_active}
            onChange={(e) => { setIsActive(e.target.value); handleChange(); }}
        />
        <span className="text-sm">{isActive ? 'Активна' : 'Неактивна'}</span>
    </label>
</div>
```

### Fix 2.2: Add Cancel button
**File:** `frontend/admin/app/(main)/clients/components/ClientInfoTab.tsx`

**UI:**
```
[Удалить клиента]                    [Отмена] [Сохранить]
```

```typescript
<div className="flex justify-between pt-4 border-t" style={{ borderColor: 'var(--line)' }}>
    <button onClick={onDelete} className="text-sm text-red-500 hover:text-red-600">
        Удалить клиента
    </button>
    <div className="flex gap-2">
        <button
            disabled={!hasChanges}
            onClick={handleCancel}
            className="px-4 py-2 text-sm text-ink-mid border rounded-lg disabled:opacity-50"
            style={{ borderColor: 'var(--line)' }}
        >
            Отмена
        </button>
        <button
            disabled={!hasChanges}
            onClick={handleSave}
            className="px-4 py-2 text-sm text-white rounded-lg disabled:bg-gray-300"
            style={{ backgroundColor: hasChanges ? 'var(--brand)' : undefined }}
        >
            Сохранить
        </button>
    </div>
</div>
```

### Fix 2.3: Delete confirmation dialog
**File:** `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx`

```typescript
const handleDelete = useCallback(async () => {
    if (window.confirm(`Удалить ${client?.name ?? 'клиента'}? Это скроет клиента из списка.`)) {
        await deleteClient(client!.id);
        onClose();
    }
}, [client, deleteClient, onClose]);
```

---

## Phase 3: Client Card — Record Tab (Major)

### Fix 3.1: Add Мастер, Активность, Место dropdowns
**File:** `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`

**UI:**
```
Мероприятие                    Статус
┌─────────────┬─────────────┬─────────────┐
│ Мастер:     │ Активность: │ Место:      │
│ [Ольга ▾]   │ [Живопись ▾]│ [Мастерская▾]│
├─────────────┼─────────────┼─────────────┤
│ Дата:       │ Время:      │             │
│ 01.06.2026  │ 14:00       │             │
└─────────────┴─────────────┴─────────────┘
```

Need to fetch:
- Activity details (for master, activity name, location, date/time)
- Masters list (for dropdown)
- Services list (for activity dropdown)
- Locations list (for location dropdown)

```typescript
// Fetch activity
const { data: activity } = useQuery({
    queryKey: ['activity', record?.activity_id],
    queryFn: () => getActivity(record!.activity_id),
    enabled: !!record?.activity_id,
});

// Fetch dropdown options
const { data: masters = [] } = useQuery({ queryKey: ['masters'], queryFn: getMasters });
const { data: services = [] } = useQuery({ queryKey: ['services'], queryFn: getServices });
const { data: locations = [] } = useQuery({ queryKey: ['locations'], queryFn: getLocations });

// In the UI
<div className="grid grid-cols-3 gap-4">
    <div>
        <label className="text-xs font-medium text-ink-mid block mb-1">Мастер</label>
        <select value={activity?.masterId || ''} onChange={handleMasterChange}>
            {masters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
    </div>
    <div>
        <label className="text-xs font-medium text-ink-mid block mb-1">Активность</label>
        <select value={activity?.serviceId || ''} onChange={handleActivityChange}>
            {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
    </div>
    <div>
        <label className="text-xs font-medium text-ink-mid block mb-1">Место</label>
        <select value={activity?.locationId || ''} onChange={handleLocationChange}>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
    </div>
</div>

{/* Date + Time */}
<div className="grid grid-cols-2 gap-4 mt-4">
    <div>
        <label className="text-xs font-medium text-ink-mid block mb-1">Дата</label>
        <div className="text-sm">{activity?.date ? new Date(activity.date).toLocaleDateString('ru-RU') : '—'}</div>
    </div>
    <div>
        <label className="text-xs font-medium text-ink-mid block mb-1">Время</label>
        <div className="text-sm">{activity?.time || '—'}</div>
    </div>
</div>
```

### Fix 3.2: Visitor status as dropdown
**File:** `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`

**UI:**
```
Посетители
┌──────────────────────────────────────┐
│ Анна (взр.)    [Пришла ▾]     1500₽ │
│ Маша (8 л.)    [Пропущена ▾]  1500₽ │
└──────────────────────────────────────┘
```

```typescript
<select
    value={visit.status}
    onChange={(e) => handleVisitStatusChange(visit.id, e.target.value)}
    className="text-xs rounded border px-2 py-1"
    style={{ borderColor: 'var(--line)' }}
>
    <option value="waiting">Ожидает</option>
    <option value="visited">Пришла</option>
    <option value="missed">Пропущена</option>
    <option value="cancelled">Отменена</option>
</select>
```

### Fix 3.3: Payment summary (Оплачено / Остаток)
**File:** `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`

**UI:**
```
Оплата
┌──────────────────┬──────────┬──────────┐
│ Итого: 3 000 ₽  │ Оплачено:│ Остаток: │
│                  │ 3 000 ₽  │    0 ₽   │
├──────────────────┴──────────┴──────────┤
│ [card ▾] [3000] [Добавить оплату]     │
└────────────────────────────────────────┘
```

```typescript
// Fetch payments for this record
const { data: payments = [] } = useQuery({
    queryKey: ['payments', recordId],
    queryFn: () => getRecordPayments(recordId),
    enabled: !!recordId,
});

const totalCost = customPrice || record.visits.reduce((sum, v) => sum + v.price, 0);
const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
const remaining = totalCost - totalPaid;

<div className="grid grid-cols-3 gap-2 p-3 bg-surface rounded-lg">
    <div className="text-center">
        <div className="text-lg font-semibold">{totalCost.toLocaleString('ru-RU')} ₽</div>
        <div className="text-xs text-ink-light">Итого</div>
    </div>
    <div className="text-center">
        <div className="text-lg font-semibold">{totalPaid.toLocaleString('ru-RU')} ₽</div>
        <div className="text-xs text-ink-light">Оплачено</div>
    </div>
    <div className="text-center">
        <div className="text-lg font-semibold" style={{ color: remaining > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {remaining.toLocaleString('ru-RU')} ₽
        </div>
        <div className="text-xs text-ink-light">Остаток</div>
    </div>
</div>
```

### Fix 3.4: Comment field
**File:** `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`

**UI:**
```
Комментарий
┌────────────────────────────────────────┐
│ [____________________________]         │
└────────────────────────────────────────┘
```

```typescript
<div>
    <h4 className="text-xs font-medium text-ink-mid mb-2">Комментарий</h4>
    <textarea
        className="w-full rounded-lg border px-3 py-2 text-sm bg-white"
        style={{ borderColor: 'var(--line)' }}
        value={comment}
        onChange={(e) => { setComment(e.target.value); setHasChanges(true); }}
        onBlur={handleCommentSave}
        rows={2}
    />
</div>
```

---

## Phase 4: Table & Filters

### Fix 4.1: Row hover style
**File:** `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`

```typescript
// Add hover:bg-gray-50 to <tr>
<tr
    key={client.id}
    onClick={() => onClientClick(client)}
    className="border-b hover:bg-gray-50 cursor-pointer group transition-colors"
>
```

### Fix 4.2: Delete icon functional + visible
**File:** `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`

```typescript
// Add group class to <tr> (done above)
// Fix delete button
<td className="py-3 px-4">
    <button
        onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Удалить ${client.name ?? 'клиента'}?`)) {
                deleteClient(client.id);
            }
        }}
        className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
    >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
        </svg>
    </button>
</td>
```

### Fix 4.3: Empty states
**File:** `frontend/admin/app/(main)/clients/components/ClientsTable.tsx`

```typescript
// Check if filters are active
const hasActiveFilters = filters.search || filters.is_active !== null || /* ... */;

if (clients.length === 0 && !isLoading) {
    if (hasActiveFilters) {
        return (
            <div className="text-center py-12">
                <p className="text-gray-500 mb-2">Ничего не найдено</p>
                <button onClick={resetFilters} className="text-brand text-sm hover:underline">
                    Сбросить фильтры
                </button>
            </div>
        );
    }
    return (
        <div className="text-center py-12">
            <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 010-8 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
            </svg>
            <p className="text-gray-500 mb-2">Нет клиентов</p>
            <button onClick={() => setIsCreateMode(true)} className="text-brand text-sm hover:underline">
                Добавить первого
            </button>
        </div>
    );
}
```

### Fix 4.4: Per-page selector
**File:** `frontend/admin/app/(main)/clients/page.tsx`

```typescript
<div className="flex items-center justify-between">
    <span className="text-sm text-ink-light">{total} клиентов</span>
    <div className="flex items-center gap-4">
        <select
            value={perPage}
            onChange={(e) => setPerPage(Number(e.target.value))}
            className="text-sm border rounded px-2 py-1"
            style={{ borderColor: 'var(--line)' }}
        >
            <option value={10}>10</option>
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
        </select>
        <div className="flex items-center gap-2">
            {/* pagination buttons */}
        </div>
    </div>
</div>
```

### Fix 4.5: Remove double border in filters
**File:** `frontend/admin/app/(main)/clients/components/ClientsFilters.tsx`

Remove the wrapper div with border/padding since `page.tsx` already wraps it.

---

## Phase 5: Left Panel — Record List with Time

### Fix 5.1: Show activity date/time in left panel
**File:** `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx`

```typescript
// Fetch activity for each record
const { data: recordActivities } = useQuery({
    queryKey: ['activities', records?.map(r => r.activity_id)],
    queryFn: () => Promise.all(records.map(r => getActivity(r.activity_id))),
    enabled: !!records?.length,
});

// In left panel
{records?.map((record, i) => {
    const activity = recordActivities?.[i];
    return (
        <button
            key={record.id}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm ${activeTab === `record-${record.id}` ? 'bg-brand text-white font-medium' : 'text-ink-mid hover:bg-white/60'}`}
            onClick={() => setActiveTab(`record-${record.id}`)}
        >
            <div>{activity?.date ? new Date(activity.date).toLocaleDateString('ru-RU') : '—'}</div>
            <div className="text-xs opacity-70">{activity?.time || ''}</div>
        </button>
    );
})}
```

---

## Phase 6: Error Handling

### Fix 6.1: Error toasts
Need a toast notification system. Check if `UIContext` has `showToast`.

```typescript
// In ClientInfoTab
const { showToast } = useUI();

const handleSave = useCallback(async () => {
    try {
        await onSave({ name, phone, email, channel, is_active: isActive });
        setHasChanges(false);
        showToast('Сохранено');
    } catch {
        showToast('Не удалось сохранить');
    }
}, [/* ... */]);
```

### Fix 6.2: Create error — don't close modal
**File:** `frontend/admin/app/(main)/clients/components/ClientCardModal.tsx`

```typescript
const handleCreate = useCallback(async (data) => {
    try {
        const newClient = await createClient(data);
        onClientCreated(newClient);
        showToast('Клиент создан');
    } catch {
        showToast('Не удалось создать клиента');
        // Don't close modal
    }
}, [/* ... */]);
```

---

## Phase 7: Record Delete with Undo Toast

### Fix 7.1: Delete with undo
**File:** `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx`

```typescript
const handleDelete = useCallback(async () => {
    const { showToast, showUndoToast } = useUI();
    
    showUndoToast('Запись удалена через 5 секунд', async () => {
        await deleteRecord(recordId);
        onClose();
        queryClient.invalidateQueries({ queryKey: ['records'] });
    });
}, [/* ... */]);
```

---

## Test Requirements

Every fix MUST have corresponding tests:

| Fix | Test Type | What to Test |
|-----|-----------|--------------|
| 1.1 Schema nullable | Unit | Schema validates null name/phone |
| 1.2 Schema optional name | Unit | Schema allows missing name |
| 2.1 is_active toggle | Component | Toggle renders, changes state |
| 2.2 Cancel button | Component | Cancel resets values |
| 2.3 Delete confirm | Component | confirm() called, delete on OK |
| 3.1 Dropdowns | Component | All 3 dropdowns render, change handler works |
| 3.2 Visit status | Component | Status dropdown renders, change works |
| 3.3 Payment summary | Component | Correct totals calculated |
| 3.4 Comment | Component | Textarea renders, saves on blur |
| 4.1 Hover style | Visual | Class applied correctly |
| 4.2 Delete icon | Component | Icon visible on hover, delete works |
| 4.3 Empty states | Component | Correct state shown for each scenario |
| 4.4 Per-page | Component | Selector renders, changes perPage |
| 5.1 Record time | Component | Date/time displayed from activity |
| 6.1 Error toasts | Component | Toast shown on error |
| 6.2 Create error | Component | Modal stays open on error |
| 7.1 Delete undo | Component | Toast with undo shown |

---

## Execution Order

1. **Phase 1:** Schema fixes (quick, high impact)
2. **Phase 2:** Client tab fixes (Cancel, is_active, confirm)
3. **Phase 3:** Record tab (dropdowns, payments, comment) — **biggest effort**
4. **Phase 4:** Table & filters (hover, delete icon, empty states)
5. **Phase 5:** Left panel time display
6. **Phase 6:** Error handling
7. **Phase 7:** Delete undo toast
8. **Tests:** After each phase
9. **Visual compliance:** After all phases
