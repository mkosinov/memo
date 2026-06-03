# Records / Bookings — Design Spec

> **Status:** Draft
> **Date:** 2026-06-03
> **Branch:** feat/admin-polish

## Context

The `/bookings` page in admin shows records using mock data. We need to:
1. Rename `/bookings` → `/records`
2. Connect to backend API instead of mocks
3. Later: extend `ScheduleAdminDTO` with `records: RecordSummaryDTO[]` for showing records on the schedule page

## Data Architecture

### Two cache layers

**🔵 Always in memory (small data, staleTime: Infinity + invalidation):**
- Services + Tariffs — `GET /api/v1/services`
- Masters — `GET /api/v1/masters`
- Locations — `GET /api/v1/locations`

**🟡 Period-based (from NavigationProvider):**
- Activities — `GET /api/v1/activities?date_from=&date_to=`
- Records — `GET /api/v1/records` (filtered by date via GH #52)
- Clients — loaded only for fetched records
- Payments — loaded only for fetched records
- Visitors — nested in RecordResponse (visits[])

### Data flow

```
NavigationProvider (dateFrom, dateTo)
    ↓
Activities (for period) ← GET /api/v1/activities?date_from=&date_to=
    ↓ activity_id
Records (related to activities) ← GET /api/v1/records?date_from=&date_to= (#52)
    ↓ collect unique client_id
Clients (only for fetched records) ← GET /api/v1/clients
    ↓ collect record_id
Payments (only for fetched records) ← GET /api/v1/payments
```

## New types

### RecordSummaryDTO (for ScheduleAdminDTO — later)

```typescript
interface RecordSummaryDTO {
  id: string;
  clientId: string;
  clientName: string;        // resolved from ClientResponse
  status: RecordStatus;
  seats: number;
  comment?: string;
  visitors: VisitorSummaryDTO[];
  totalPrice: number;        // sum(visitors[].price)
  paymentStatus: PaymentStatus;
}

interface VisitorSummaryDTO {
  id: string;
  name: string;
  age?: number;
  // isAdult computed: age !== undefined ? age >= 18 : true
  price: number;
}

type RecordStatus = "pending" | "confirmed" | "cancelled" | "visited";
type PaymentStatus = "paid" | "partial" | "unpaid";
```

### ScheduleAdminDTO extension (later)

```typescript
interface ScheduleAdminDTO extends ScheduleDTO {
  // ... existing fields ...
  records: RecordSummaryDTO[];   // records for this activity
}
```

## /records page

### Approach

- Use `RecordDTO` from backend directly (GH #52 adds date filtering)
- Apply Topbar filters (master, location, status) in runtime via `useMemo`
- Simple `filter()` is sufficient for <1000 records (no index needed)
- `RecordsContext` provides data to all components on the page

### RecordsContext

```typescript
interface RecordsContextType {
  records: RecordDTO[];
  loading: boolean;
  error: Error | null;
}
```

RecordsContext is independent from ScheduleContext. Each page manages its own data.

## What to do

### Backend
- [ ] #52 — Add date filtering to `GET /api/v1/records`

### Frontend

**Phase 1: /records page (this sprint)**
- [ ] Add endpoints to api-client: `getRecords`, `getClients`, `getPayments`
- [ ] Add schemas to api-client: `RecordResponseSchema`, `ClientResponseSchema`, `PaymentResponseSchema`
- [ ] Create `frontend/admin/contexts/RecordsContext.tsx`
- [ ] Rename `(main)/bookings/` → `(main)/records/`
- [ ] Update `Menubar.tsx` — link `/bookings` → `/records`
- [ ] Update tests

**Phase 2: Schedule records (later)**
- [ ] Create `frontend/admin/lib/buildRecordSummary.ts` — enrichment function
- [ ] Extend `ScheduleAdminDTO` with `records: RecordSummaryDTO[]`
- [ ] Update `buildAdminSchedule()` to include records
- [ ] Display records on activity cards on main page

**Phase 3: Review (after implementation)**
- [ ] GH issue: Review RecordsContext necessity — maybe merge into ScheduleContext or refactor

## Visual Compliance Checks

- [ ] Records page shows table with data from backend
- [ ] Filters work (by master, location, status)
- [ ] Clients and payments load only for fetched records
- [ ] Navigation link points to /records
