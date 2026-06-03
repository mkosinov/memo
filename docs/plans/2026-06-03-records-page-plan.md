# Records Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mock data in /bookings with real backend API, rename to /records, add RecordsContext

**Architecture:** Two-layer cache (small data always cached, period-based for large data). RecordsContext independent from ScheduleContext. Simple filter() in useMemo for runtime filtering.

**Tech Stack:** Next.js 14, TypeScript, React Query, Tailwind CSS, FastAPI backend

---

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `packages/api-client/src/schemas.ts` | Modify | Add RecordResponseSchema, ClientResponseSchema, PaymentResponseSchema |
| `packages/api-client/src/endpoints.ts` | Modify | Add getRecords, getClients, getPayments |
| `frontend/admin/contexts/RecordsContext.tsx` | Create | RecordsContext with React Query |
| `frontend/admin/app/(main)/records/page.tsx` | Rename | From bookings/page.tsx |
| `frontend/admin/app/(main)/records/components/BookingFilters.tsx` | Rename | From bookings/components/ |
| `frontend/admin/app/(main)/records/components/BookingTable.tsx` | Rename + Rewrite | Rename to RecordsTable, replace mock data with API |
| `frontend/admin/app/(main)/records/components/ClientCardModal.tsx` | Rename | From bookings/components/ |
| `frontend/admin/app/components/layout/Menubar.tsx` | Modify | Change link /bookings → /records |
| `frontend/admin/__tests__/RecordsPage.test.tsx` | Rewrite | Update from BookingsPage.test.tsx |

---

## Task 1: Add API schemas for records, clients, payments

**Files:** `packages/api-client/src/schemas.ts`
**Classification:** Small

### Steps

- [ ] 1.1 Read current `packages/api-client/src/schemas.ts` to understand existing patterns

- [ ] 1.2 Add VisitResponseSchema after existing schemas:
```typescript
export const VisitResponseSchema = z.object({
  id: z.string(),
  record_id: z.string(),
  visitor_id: z.string(),
  price: z.number(),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});
export type VisitResponse = z.infer<typeof VisitResponseSchema>;
```

- [ ] 1.3 Add RecordResponseSchema:
```typescript
export const RecordResponseSchema = z.object({
  id: z.string(),
  activity_id: z.string(),
  client_id: z.string().nullable(),
  status: z.string(),
  seats: z.number(),
  comment: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
  visits: z.array(VisitResponseSchema),
});
export type RecordResponse = z.infer<typeof RecordResponseSchema>;
```

- [ ] 1.4 Add ClientResponseSchema:
```typescript
export const ClientResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  channel: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});
export type ClientResponse = z.infer<typeof ClientResponseSchema>;
```

- [ ] 1.5 Add PaymentResponseSchema:
```typescript
export const PaymentResponseSchema = z.object({
  id: z.string(),
  record_id: z.string(),
  amount: z.number(),
  paid: z.boolean(),
  method: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  is_active: z.boolean(),
});
export type PaymentResponse = z.infer<typeof PaymentResponseSchema>;
```

- [ ] 1.6 Run `cd packages/api-client && npm run build` to verify types compile

- [ ] 1.7 Commit: `feat(api-client): add Record, Client, Payment response schemas`

---

## Task 2: Add API endpoints for records, clients, payments

**Files:** `packages/api-client/src/endpoints.ts`
**Classification:** Small

### Steps

- [ ] 2.1 Read current `packages/api-client/src/endpoints.ts` to understand patterns

- [ ] 2.2 Add imports for new schemas at top of file:
```typescript
import {
  // ... existing imports ...
  RecordResponseSchema,
  type RecordResponse,
  ClientResponseSchema,
  type ClientResponse,
  PaymentResponseSchema,
  type PaymentResponse,
} from './schemas';
```

- [ ] 2.3 Add getRecords endpoint:
```typescript
export async function getRecords(params?: {
  date_from?: string;
  date_to?: string;
}): Promise<RecordResponse[]> {
  const searchParams = new URLSearchParams();
  if (params?.date_from) searchParams.set('date_from', params.date_from);
  if (params?.date_to) searchParams.set('date_to', params.date_to);
  const query = searchParams.toString();
  return api(`/api/v1/records${query ? `?${query}` : ''}`, z.array(RecordResponseSchema));
}
```

- [ ] 2.4 Add getClients endpoint:
```typescript
export async function getClients(): Promise<ClientResponse[]> {
  return api('/api/v1/clients', z.array(ClientResponseSchema));
}
```

- [ ] 2.5 Add getPayments endpoint:
```typescript
export async function getPayments(params?: {
  record_id?: string;
}): Promise<PaymentResponse[]> {
  const searchParams = new URLSearchParams();
  if (params?.record_id) searchParams.set('record_id', params.record_id);
  const query = searchParams.toString();
  return api(`/api/v1/payments${query ? `?${query}` : ''}`, z.array(PaymentResponseSchema));
}
```

- [ ] 2.6 Run `cd packages/api-client && npm run build` to verify

- [ ] 2.7 Commit: `feat(api-client): add getRecords, getClients, getPayments endpoints`

---

## Task 3: Create RecordsContext

**Files:** `frontend/admin/contexts/RecordsContext.tsx`
**Classification:** Standard

### Steps

- [ ] 3.1 Read `frontend/admin/contexts/ScheduleContext.tsx` for patterns

- [ ] 3.2 Create `frontend/admin/contexts/RecordsContext.tsx`:
```typescript
'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRecords, getClients, getPayments, getActivities, getMasters, getServices, getLocations } from '@memo/api-client';
import type { RecordResponse, ClientResponse, PaymentResponse, ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';
import { useNavigation } from '@/contexts/NavigationContext';

export interface RecordsContextType {
  records: RecordResponse[];
  clients: Map<string, ClientResponse>;
  payments: Map<string, PaymentResponse[]>;
  activities: Map<string, ActivityResponse>;
  masters: Map<string, MasterResponse>;
  services: Map<string, ServiceResponse>;
  locations: Map<string, LocationResponse>;
  loading: boolean;
  error: Error | null;
}

const RecordsContext = createContext<RecordsContextType | null>(null);

export function RecordsProvider({ children }: { children: React.ReactNode }) {
  const { dateFrom, dateTo } = useNavigation();

  // Period-based data
  const { data: records = [], isLoading: recordsLoading, error: recordsError } = useQuery<RecordResponse[]>({
    queryKey: ['records', dateFrom, dateTo],
    queryFn: () => getRecords({ date_from: dateFrom, date_to: dateTo }),
  });

  const { data: activitiesRaw = [] } = useQuery<ActivityResponse[]>({
    queryKey: ['activities', dateFrom, dateTo],
    queryFn: () => getActivities({ date_from: dateFrom, date_to: dateTo }),
  });

  // Always cached data
  const { data: mastersRaw = [] } = useQuery<MasterResponse[]>({
    queryKey: ['masters'],
    queryFn: () => getMasters(),
    staleTime: Infinity,
  });

  const { data: servicesRaw = [] } = useQuery<ServiceResponse[]>({
    queryKey: ['services'],
    queryFn: () => getServices(),
    staleTime: Infinity,
  });

  const { data: locationsRaw = [] } = useQuery<LocationResponse[]>({
    queryKey: ['locations'],
    queryFn: () => getLocations(),
    staleTime: Infinity,
  });

  // Clients and payments for fetched records
  const recordClientIds = useMemo(() => {
    const ids = new Set<string>();
    records.forEach(r => { if (r.client_id) ids.add(r.client_id); });
    return Array.from(ids);
  }, [records]);

  const { data: clientsRaw = [] } = useQuery<ClientResponse[]>({
    queryKey: ['clients'],
    queryFn: () => getClients(),
    staleTime: Infinity,
  });

  const { data: paymentsRaw = [] } = useQuery<PaymentResponse[]>({
    queryKey: ['payments', dateFrom, dateTo],
    queryFn: () => getPayments(),
  });

  // Build maps for O(1) lookup
  const activities = useMemo(() => {
    const map = new Map<string, ActivityResponse>();
    activitiesRaw.forEach(a => map.set(a.id, a));
    return map;
  }, [activitiesRaw]);

  const masters = useMemo(() => {
    const map = new Map<string, MasterResponse>();
    mastersRaw.forEach(m => map.set(m.id, m));
    return map;
  }, [mastersRaw]);

  const services = useMemo(() => {
    const map = new Map<string, ServiceResponse>();
    servicesRaw.forEach(s => map.set(s.id, s));
    return map;
  }, [servicesRaw]);

  const locations = useMemo(() => {
    const map = new Map<string, LocationResponse>();
    locationsRaw.forEach(l => map.set(l.id, l));
    return map;
  }, [locationsRaw]);

  const clients = useMemo(() => {
    const map = new Map<string, ClientResponse>();
    clientsRaw.forEach(c => map.set(c.id, c));
    return map;
  }, [clientsRaw]);

  const payments = useMemo(() => {
    const map = new Map<string, PaymentResponse[]>();
    paymentsRaw.forEach(p => {
      const arr = map.get(p.record_id) ?? [];
      arr.push(p);
      map.set(p.record_id, arr);
    });
    return map;
  }, [paymentsRaw]);

  const contextValue = useMemo(() => ({
    records,
    clients,
    payments,
    activities,
    masters,
    services,
    locations,
    loading: recordsLoading,
    error: recordsError ?? null,
  }), [records, clients, payments, activities, masters, services, locations, recordsLoading, recordsError]);

  return (
    <RecordsContext.Provider value={contextValue}>
      {children}
    </RecordsContext.Provider>
  );
}

export function useRecords(): RecordsContextType {
  const context = useContext(RecordsContext);
  if (!context) throw new Error('useRecords must be used within RecordsProvider');
  return context;
}
```

- [ ] 3.3 Run `cd frontend/admin && npx tsc --noEmit` to verify types

- [ ] 3.4 Commit: `feat(admin): create RecordsContext with React Query`

---

## Task 4: Rename bookings → records route

**Files:** `frontend/admin/app/(main)/records/` (rename from bookings/)
**Classification:** Small

### Steps

- [ ] 4.1 Rename directory:
```bash
cd frontend/admin/app/\(main\)
git mv bookings records
```

- [ ] 4.2 Update imports in `records/page.tsx` (paths stay relative, should work)

- [ ] 4.3 Update `records/components/BookingTable.tsx` to use RecordsContext instead of mock data (see Task 5)

- [ ] 4.4 Commit: `refactor(admin): rename bookings route to records`

---

## Task 5: Rename BookingTable → RecordsTable and rewrite to use RecordsContext

**Files:** `frontend/admin/app/(main)/records/components/RecordsTable.tsx` (rename from BookingTable.tsx)
**Classification:** Large

### Steps

- [ ] 5.1 Read current `BookingTable.tsx` to understand the table structure

- [ ] 5.2 Rename BookingTable → RecordsTable:
```bash
git mv frontend/admin/app/\(main\)/records/components/BookingTable.tsx frontend/admin/app/\(main\)/records/components/RecordsTable.tsx
```

- [ ] 5.3 Read `RecordsContext` to understand available data

- [ ] 5.4 Rewrite RecordsTable to:
  - Import `useRecords` from RecordsContext
  - Replace mock data references (RECORDS, CLIENTS, etc.) with context data
  - Use `records` from context instead of `RECORDS`
  - Resolve client names via `clients.get(record.client_id)`
  - Resolve activity details via `activities.get(record.activity_id)`
  - Resolve service/master/location via their respective maps
  - Keep existing table UI, sorting, pagination, detail panel

- [ ] 5.4 Update mock data imports — remove all `import { ... } from '@/lib/mock-data'`

- [ ] 5.5 Run `cd frontend/admin && npx vitest run __tests__/RecordsPage.test.tsx` to verify

- [ ] 5.6 Commit: `feat(admin): rewrite BookingTable to use RecordsContext`

---

## Task 6: Update Menubar link

**Files:** `frontend/admin/app/components/layout/Menubar.tsx`
**Classification:** Trivial

### Steps

- [ ] 6.1 Read `Menubar.tsx` to find the link

- [ ] 6.2 Change href from `/bookings` to `/records`:
```typescript
{ label: 'Записи', icon: 'clipboard', href: '/records' },
```

- [ ] 6.3 Run `cd frontend/admin && npx vitest run` to verify no regressions

- [ ] 6.4 Commit: `fix(admin): update Menubar link from /bookings to /records`

---

## Task 7: Update tests

**Files:** `frontend/admin/__tests__/RecordsPage.test.tsx` (rename from BookingsPage.test.tsx)
**Classification:** Standard

### Steps

- [ ] 7.1 Read current `BookingsPage.test.tsx`

- [ ] 7.2 Rename test file:
```bash
git mv __tests__/BookingsPage.test.tsx __tests__/RecordsPage.test.tsx
```

- [ ] 7.3 Update test to:
  - Import from new route path
  - Mock `@memo/api-client` with new endpoints (getRecords, getClients, getPayments)
  - Wrap in `RecordsProvider` + `NavigationProvider`
  - Update assertions for real data structure

- [ ] 7.4 Run `cd frontend/admin && npx vitest run __tests__/RecordsPage.test.tsx` to verify

- [ ] 7.5 Run full test suite `npx vitest run` to verify no regressions

- [ ] 7.6 Commit: `test(admin): update RecordsPage tests for API integration`

---

## Task 8: Final verification

**Classification:** Trivial

### Steps

- [ ] 8.1 Run full test suite: `cd frontend/admin && npx vitest run`

- [ ] 8.2 Verify TypeScript: `cd frontend/admin && npx tsc --noEmit`

- [ ] 8.3 Verify dev server starts: `cd frontend/admin && npm run dev`

- [ ] 8.4 Manual test: navigate to /records, verify table shows data (or empty state if no backend)

- [ ] 8.5 Final commit if any fixes needed
