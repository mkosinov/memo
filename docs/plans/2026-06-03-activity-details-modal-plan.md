# ActivityDetailsModal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simple ActivityModal with a tabbed ActivityDetailsModal featuring left sidebar navigation, client management, new booking form, and financial summary footer.

**Architecture:** Single modal component with tab-based navigation. Left sidebar for tab switching, right content area for tab content. Backend gains phone lookup endpoint. API client gains CRUD functions. Domain types renamed (BookingRecord → Record).

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, @tanstack/react-query, native HTML datetime-local input, custom toast with undo.

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/api/v1/clients.py` | Modify | Add phone search endpoint |
| `packages/api-client/src/endpoints.ts` | Modify | Add CRUD functions for records, payments, visitors |
| `packages/api-client/src/schemas.ts` | Modify | Add request/response schemas |
| `packages/domain/src/index.ts` | Modify | Rename BookingRecord → Record, lowercase status enums |
| `frontend/admin/lib/utils.ts` | Modify | Add duration formatting helpers |
| `frontend/admin/app/components/modal/ActivityDetailsModal.tsx` | Create | Main modal component |
| `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx` | Create | Settings tab content |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx` | Create | Client tab content |
| `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx` | Create | New booking tab content |
| `frontend/admin/app/components/modal/ActivityDetailsModal/ModalFooter.tsx` | Create | Financial summary footer |
| `frontend/admin/app/components/modal/ActivityDetailsModal/TabNav.tsx` | Create | Left sidebar navigation |
| `frontend/admin/app/components/modal/ActivityDetailsModal/index.ts` | Create | Barrel export |
| `frontend/admin/app/components/schedule/WeekView.tsx` | Modify | Wire up new modal |
| `frontend/admin/app/components/schedule/ActivityCard.tsx` | Modify | Add onQuickAdd prop |
| `frontend/admin/app/components/schedule/DayColumn.tsx` | Modify | Pass onQuickAdd through |
| `frontend/admin/app/components/modal/ActivityModal.tsx` | Delete | Replaced by ActivityDetailsModal |
| `frontend/admin/__tests__/timezone-dnd-bug.test.ts` | Modify | Update BookingRecord → Record references |

---

## Task 1: Backend — Add Phone Search Endpoint

**Classification:** small

### Files
- Modify: `backend/src/api/v1/clients.py`
- Modify: `backend/src/schemas/client.py` (if needed)

### Steps

- [ ] 1. Read `backend/src/api/v1/clients.py` to understand existing patterns
- [ ] 2. Add new endpoint `GET /api/v1/clients/search?phone={phone}`:
```python
@router.get("/search", response_model=ClientResponse)
async def search_client_by_phone(
    phone: str = Query(..., min_length=3),
    db: AsyncSession = Depends(get_db),
):
    """Search for a client by phone number."""
    stmt = select(Client).where(Client.phone == phone, Client.is_active == True)
    result = await db.execute(stmt)
    client = result.scalar_one_or_none()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return client
```
- [ ] 3. Run backend tests: `cd backend && python -m pytest`
- [ ] 4. Commit: `feat: add phone search endpoint for clients`

---

## Task 2: API Client — Add CRUD Functions

**Classification:** standard

### Files
- Modify: `packages/api-client/src/endpoints.ts`
- Modify: `packages/api-client/src/schemas.ts`

### Steps

- [ ] 1. Read existing endpoints.ts and schemas.ts to understand patterns
- [ ] 2. Add to `schemas.ts`:
```typescript
// Record schemas
export const RecordCreateSchema = z.object({
  activity_id: z.string(),
  client_id: z.string().optional(),
  phone: z.string().optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'no_show']).optional(),
  seats: z.number().optional(),
  comment: z.string().optional(),
  visits: z.array(z.object({
    visitor_id: z.string().optional(),
    price: z.number(),
    status: z.enum(['waiting', 'visited', 'missed', 'cancelled']).optional(),
  })).optional(),
});
export type RecordCreate = z.infer<typeof RecordCreateSchema>;

export const RecordUpdateSchema = RecordCreateSchema.partial();
export type RecordUpdate = z.infer<typeof RecordUpdateSchema>;

// Payment schemas
export const PaymentCreateSchema = z.object({
  record_id: z.string(),
  amount: z.number(),
  method: z.enum(['cash', 'card', 'transfer']).optional(),
});
export type PaymentCreate = z.infer<typeof PaymentCreateSchema>;

export const PaymentUpdateSchema = PaymentCreateSchema.partial();
export type PaymentUpdate = z.infer<typeof PaymentUpdateSchema>;

// Visitor schemas
export const VisitorCreateSchema = z.object({
  client_id: z.string(),
  name: z.string(),
  age: z.number().optional(),
});
export type VisitorCreate = z.infer<typeof VisitorCreateSchema>;

export const VisitorUpdateSchema = VisitorCreateSchema.partial();
export type VisitorUpdate = z.infer<typeof VisitorUpdateSchema>;
```
- [ ] 3. Add to `endpoints.ts`:
```typescript
// Records
export async function createRecord(data: RecordCreate): Promise<RecordResponse> { ... }
export async function updateRecord(id: string, data: RecordUpdate): Promise<RecordResponse> { ... }
export async function deleteRecord(id: string): Promise<void> { ... }

// Payments
export async function createPayment(data: PaymentCreate): Promise<PaymentResponse> { ... }
export async function updatePayment(id: string, data: PaymentUpdate): Promise<PaymentResponse> { ... }
export async function deletePayment(id: string): Promise<void> { ... }

// Visitors
export async function createVisitor(data: VisitorCreate): Promise<VisitorResponse> { ... }
export async function updateVisitor(id: string, data: VisitorUpdate): Promise<VisitorResponse> { ... }
export async function deleteVisitor(id: string): Promise<void> { ... }

// Client search
export async function searchClientByPhone(phone: string): Promise<ClientResponse> { ... }

// Visit status
export async function updateVisitStatus(id: string, status: string): Promise<VisitResponse> { ... }
```
- [ ] 4. Build: `cd packages/api-client && pnpm build`
- [ ] 5. Commit: `feat: add CRUD functions to API client`

---

## Task 3: Domain — Rename BookingRecord → Record

**Classification:** standard

### Files
- Modify: `packages/domain/src/index.ts`
- Modify: `frontend/admin/` — all references
- Modify: `packages/api-client/` — schema references

### Steps

- [ ] 1. In `packages/domain/src/index.ts`:
  - Rename `BookingRecordSchema` → `RecordSchema`
  - Rename `BookingRecord` → `Record`
  - Rename `BookingStatusSchema` → `RecordStatusSchema`
  - Rename `BookingStatus` → `RecordStatus`
  - Change enum values to lowercase: `['PENDING', ...]` → `['pending', ...]`
- [ ] 2. Search all references: `grep -r "BookingRecord\|BookingStatus" --include="*.ts" --include="*.tsx"`
- [ ] 3. Update all imports and references in frontend
- [ ] 4. Update api-client schemas if they reference domain types
- [ ] 5. Build: `cd packages/domain && pnpm build && cd ../api-client && pnpm build`
- [ ] 6. Run tests: `cd frontend && npx vitest run`
- [ ] 7. Commit: `refactor: rename BookingRecord → Record, lowercase status enums`

---

## Task 4: Utility Functions — Duration Formatting

**Classification:** trivial

### Files
- Modify: `frontend/admin/lib/utils.ts`

### Steps

- [ ] 1. Read `frontend/admin/lib/utils.ts` to understand existing utilities
- [ ] 2. Add functions:
```typescript
/** Convert decimal hours (1.5) to HH:MM string ("01:30") */
export function decimalToHHMM(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Convert HH:MM string ("01:30") to decimal hours (1.5) */
export function hhmmToDecimal(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h + m / 60;
}

/** Format datetime for display: "Сб, 7 июня · 14:00" */
export function formatActivityContext(date: Date): string {
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
                  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const dayName = days[date.getDay()];
  const dayNum = date.getDate();
  const month = months[date.getMonth()];
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${dayName}, ${dayNum} ${month} · ${time}`;
}
```
- [ ] 3. Commit: `feat: add duration formatting utilities`

---

## Task 5: ActivityDetailsModal — Core Component

**Classification:** large

### Files
- Create: `frontend/admin/app/components/modal/ActivityDetailsModal.tsx`
- Create: `frontend/admin/app/components/modal/ActivityDetailsModal/TabNav.tsx`
- Create: `frontend/admin/app/components/modal/ActivityDetailsModal/SettingsTab.tsx`
- Create: `frontend/admin/app/components/modal/ActivityDetailsModal/ClientTab.tsx`
- Create: `frontend/admin/app/components/modal/ActivityDetailsModal/NewBookingTab.tsx`
- Create: `frontend/admin/app/components/modal/ActivityDetailsModal/ModalFooter.tsx`
- Create: `frontend/admin/app/components/modal/ActivityDetailsModal/index.ts`

### Steps

- [ ] 1. Create `ActivityDetailsModal/index.ts` — barrel export
- [ ] 2. Create `TabNav.tsx` — left sidebar with tabs:
  - Props: `tabs: Tab[]`, `activeTab: string`, `onTabChange: (id: string) => void`
  - Tabs: "Настройка", client tabs (name + phone), "+" at bottom
  - Active state highlighting
- [ ] 3. Create `SettingsTab.tsx`:
  - Props: `activity: Activity`, `onSave: (data) => void`
  - Fields: datetime-local input, service select, master select (with color dot), location select, capacity input, duration HH:MM input, private toggle
  - Service change → auto-fill duration, capacity, show tariffs
  - Display min_age–max_age from service
  - Display tariffs read-only
- [ ] 4. Create `ClientTab.tsx`:
  - Props: `record: RecordResponse`, `client: ClientResponse`, `visits: VisitResponse[]`, `payments: PaymentResponse[]`, `tariffs: Tariff[]`, `onUpdate: (data) => void`, `onDelete: () => void`
  - Client info: name (editable), phone (readonly), link to /client/{id}
  - Visitors list: name, age, tariff select, price, delete button, "+" add
  - Payment section: sum, paid, remaining, method select, "Добавить оплату"
  - Status dropdowns: record status, visit status
  - Delete button with delayed delete + toast undo
- [ ] 5. Create `NewBookingTab.tsx`:
  - Props: `activity: Activity`, `tariffs: Tariff[]`, `onCreate: (data) => void`
  - Phone input → `searchClientByPhone()` → auto-fill
  - Client name input
  - Visitors dynamic list: name, age, tariff
  - Notifications checkbox + channel select
  - "Создать запись" button
- [ ] 6. Create `ModalFooter.tsx`:
  - Props: `records: RecordResponse[]`, `payments: Map<string, PaymentResponse[]>`
  - Calculate totalCost and totalOwed
  - Display: "Стоимость: X ₽ | К оплате: Y ₽"
- [ ] 7. Create `ActivityDetailsModal.tsx` — main component:
  - Props: `isOpen`, `onClose`, `activity: Activity`, `mode: 'edit' | 'quickAdd'`
  - State: `activeTab`, `records`, `clientData`
  - Layout: overlay + backdrop + flex row (TabNav 240px + content) + footer
  - Tab switching logic
  - Data loading via RecordsContext
- [ ] 8. Run tests: `npx vitest run`
- [ ] 9. Commit: `feat: ActivityDetailsModal with tabbed navigation`

---

## Task 6: Wire Up Modal in WeekView + ActivityCard

**Classification:** standard

### Files
- Modify: `frontend/admin/app/components/schedule/WeekView.tsx`
- Modify: `frontend/admin/app/components/schedule/ActivityCard.tsx`
- Modify: `frontend/admin/app/components/schedule/DayColumn.tsx`

### Steps

- [ ] 1. In `ActivityCard.tsx`:
  - Add `onQuickAdd?: (activity: Activity) => void` prop
  - Update `handleQuickAction` to call `onQuickAdd?.(activity)` instead of showing toast
- [ ] 2. In `DayColumn.tsx`:
  - Add `onQuickAdd` prop, pass through to ActivityCard
- [ ] 3. In `WeekView.tsx`:
  - Import `ActivityDetailsModal` instead of `ActivityModal`
  - Add `modalMode` state: `'edit' | 'quickAdd'`
  - Add `openQuickAdd` callback: sets activity + mode + opens modal
  - Pass `onQuickAdd={openQuickAdd}` through DayColumn to ActivityCard
  - Render `<ActivityDetailsModal>` with mode prop
- [ ] 4. Delete old `ActivityModal.tsx`
- [ ] 5. Run tests: `npx vitest run`
- [ ] 6. Commit: `feat: wire up ActivityDetailsModal in WeekView`

---

## Task 7: Integration Test + Visual Verification

**Classification:** small

### Files
- Test: `frontend/admin/__tests__/activity-details-modal.test.ts`

### Steps

- [ ] 1. Write test: modal renders with correct tabs
- [ ] 2. Write test: settings tab shows datetime picker, service, master selects
- [ ] 3. Write test: client tab shows visitor list
- [ ] 4. Write test: new booking tab phone lookup triggers
- [ ] 5. Write test: delete button triggers delayed delete
- [ ] 6. Run all tests: `npx vitest run`
- [ ] 7. Visual verification: start dev server, test modal interactions
- [ ] 8. Commit: `test: ActivityDetailsModal integration tests`

---

## Execution Order

1. Task 1 (backend phone lookup) — no dependencies
2. Task 2 (API client CRUD) — no dependencies
3. Task 3 (rename) — no dependencies, but do early to avoid conflicts
4. Task 4 (utilities) — no dependencies
5. Task 5 (modal component) — depends on Tasks 1-4
6. Task 6 (wire up) — depends on Task 5
7. Task 7 (tests) — depends on Task 6

Tasks 1-4 can be done in parallel.
Tasks 5-6-7 are sequential.
