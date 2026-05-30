# API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace mock data in admin panel with real API calls via React Query. Schedule page loads from FastAPI backend.

**Architecture:** React Query for data layer (cache + retry + dedup). `select()` transforms backend snake_case → frontend camelCase. ScheduleContext stores only UI state (currentWeek, stamp, selectedActivity). ScheduleProvider moves from root layout to page.tsx.

**Tech Stack:** @tanstack/react-query v5, @memo/api-client (fetch + Zod), FastAPI /api/v1/

---

## File Plan

### New files:
| File | Purpose |
|------|---------|
| `apps/admin/lib/transformers.ts` | Backend DTO → frontend type mapping |
| `apps/admin/hooks/useActivities.ts` | React Query hook for activities |
| `apps/admin/hooks/useMasters.ts` | React Query hook for masters (artists) |
| `apps/admin/hooks/useServices.ts` | React Query hook for services |
| `apps/admin/hooks/useLocations.ts` | React Query hook for locations |
| `apps/admin/.env.local` | `NEXT_PUBLIC_API_URL=http://localhost:8000` |
| `packages/api-client/src/schemas.ts` | Backend-shaped Zod schemas (snake_case) |

### Modified files:
| File | Change |
|------|--------|
| `apps/admin/package.json` | Add `@tanstack/react-query` dependency |
| `apps/admin/app/layout.tsx` | Remove ScheduleProvider, add QueryClientProvider |
| `apps/admin/app/page.tsx` | Wrap in ScheduleProvider |
| `apps/admin/contexts/ScheduleContext.tsx` | Remove mock data, use React Query hooks + mutations |
| `packages/api-client/src/endpoints.ts` | Update paths to /api/v1/, add new endpoints |
| `packages/api-client/src/index.ts` | Export new schemas/types |

### Verification:
- `apps/admin/__tests__/` — update tests to mock React Query

---

## Task 1: Install React Query + Setup Provider

**Classification:** Trivial
**Files:**
- `apps/admin/package.json` — add `@tanstack/react-query`
- `apps/admin/app/layout.tsx` — add QueryClientProvider

**Steps:**

- [ ] `cd /root/workspace/memo && npm install @tanstack/react-query` (from root workspace)
- [ ] In `apps/admin/app/layout.tsx`:
  - Import `QueryClientProvider`, `QueryClient` from `@tanstack/react-query`
  - Create `const queryClient = new QueryClient()` outside component
  - Wrap `{children}` in `<QueryClientProvider client={queryClient}>`
  - Keep `UIProvider` inside `QueryClientProvider`
  - Keep `ScheduleProvider` for now (removed in Task 6)

```typescript
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body className={`${inter.variable} antialiased`}>
        <QueryClientProvider client={queryClient}>
          <UIProvider>
            <ScheduleProvider>
              {children}
            </ScheduleProvider>
            <ToastContainer />
          </UIProvider>
        </QueryClientProvider>
      </body>
    </html>
  );
}
```

- [ ] Verify: `npm run build` or `npm run test` still passes

---

## Task 2: Update @memo/api-client for Backend /api/v1/

**Classification:** Standard
**Files:**
- `packages/api-client/src/schemas.ts` — NEW: backend-shaped Zod schemas
- `packages/api-client/src/endpoints.ts` — MODIFY: update paths + add endpoints
- `packages/api-client/src/index.ts` — MODIFY: export new schemas

**Context:** Backend returns snake_case JSON (e.g., `master_id` not `masterId`). Frontend uses camelCase. We add backend-format Zod schemas to validate API responses, then transform to frontend types in `select()`.

### 2a: Create `packages/api-client/src/schemas.ts`

Backend response schemas matching the Pydantic models:

```typescript
import { z } from 'zod';

// ─── Master (Artist) ────────────────────────────────────────
export const MasterResponseSchema = z.object({
  id: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  color: z.string(),
  position: z.string(),
  specialty: z.string(),
  avatar_url: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// ─── Location ───────────────────────────────────────────────
export const LocationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  description: z.string().nullable(),
  capacity: z.number(),
  yandex_map_url: z.string().nullable(),
  review_url: z.string().nullable(),
  record_info: z.string().nullable(),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// ─── Tariff ──────────────────────────────────────────────────
export const TariffResponseSchema = z.object({
  id: z.string(),
  service_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  price: z.number(),
});

// ─── Service Tag ──────────────────────────────────────────────
export const TagResponseSchema = z.object({
  id: z.string(),
  tag: z.string(),
});

// ─── Service ─────────────────────────────────────────────────
export const ServiceResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  image_url: z.string(),
  specialty: z.string(),
  min_age: z.number(),
  max_age: z.number(),
  duration: z.number(),
  record_info: z.string(),
  tariffs: z.array(TariffResponseSchema),
  tags: z.array(TagResponseSchema),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// ─── Activity ────────────────────────────────────────────────
export const ActivityResponseSchema = z.object({
  id: z.string(),
  master_id: z.string(),
  service_id: z.string(),
  location_id: z.string(),
  start: z.string(),  // ISO datetime
  duration: z.number(),  // minutes
  capacity: z.number(),
  is_private: z.boolean(),
  comment: z.string().nullable(),
  record_info: z.string().nullable(),
  occupied: z.number(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

// Types
export type MasterResponse = z.infer<typeof MasterResponseSchema>;
export type LocationResponse = z.infer<typeof LocationResponseSchema>;
export type ServiceResponse = z.infer<typeof ServiceResponseSchema>;
export type ActivityResponse = z.infer<typeof ActivityResponseSchema>;

// ─── Activity Create/Update ──────────────────────────────────
export const ActivityCreateSchema = z.object({
  master_id: z.string(),
  service_id: z.string(),
  location_id: z.string(),
  start: z.string(),  // ISO datetime
  duration: z.number(),
  capacity: z.number(),
  is_private: z.boolean(),
  comment: z.string().nullable().optional(),
  record_info: z.string().nullable().optional(),
});
export type ActivityCreate = z.infer<typeof ActivityCreateSchema>;
```

### 2b: Update `packages/api-client/src/endpoints.ts`

Rewrite to use new schemas and /api/v1/ paths:

```typescript
import { z } from 'zod';
import { api } from './client';
import {
  ActivityResponseSchema,
  MasterResponseSchema,
  LocationResponseSchema,
  ServiceResponseSchema,
  ActivityCreateSchema,
  type ActivityResponse,
  type MasterResponse,
  type LocationResponse,
  type ServiceResponse,
  type ActivityCreate,
} from './schemas';

// ─── Masters (Artists) ──────────────────────────────────────
export async function getMasters(): Promise<MasterResponse[]> {
  return api('/api/v1/masters', z.array(MasterResponseSchema));
}

export async function getMaster(id: string): Promise<MasterResponse> {
  return api(`/api/v1/masters/${id}`, MasterResponseSchema);
}

// ─── Locations ───────────────────────────────────────────────
export async function getLocations(): Promise<LocationResponse[]> {
  return api('/api/v1/locations', z.array(LocationResponseSchema));
}

// ─── Services ────────────────────────────────────────────────
export async function getServices(): Promise<ServiceResponse[]> {
  return api('/api/v1/services', z.array(ServiceResponseSchema));
}

// ─── Activities ─────────────────────────────────────────────
export async function getActivities(params: {
  date_from: string;
  date_to: string;
}): Promise<ActivityResponse[]> {
  const search = new URLSearchParams();
  search.set('date_from', params.date_from);
  search.set('date_to', params.date_to);
  return api(`/api/v1/activities?${search.toString()}`, z.array(ActivityResponseSchema));
}

export async function getActivity(id: string): Promise<ActivityResponse> {
  return api(`/api/v1/activities/${id}`, ActivityResponseSchema);
}

export async function createActivity(data: ActivityCreate): Promise<ActivityResponse> {
  return api('/api/v1/activities', ActivityResponseSchema, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateActivity(id: string, data: Partial<ActivityCreate>): Promise<ActivityResponse> {
  return api(`/api/v1/activities/${id}`, ActivityResponseSchema, {
    method: 'PUT',  // Backend uses PUT (full update), not PATCH
    body: JSON.stringify(data),
  });
}

export async function deleteActivity(id: string): Promise<void> {
  await api(`/api/v1/activities/${id}`, z.any(), { method: 'DELETE' });
}
```

### 2c: Update `packages/api-client/src/index.ts`

```typescript
export { api, ApiError } from './client';
export * from './endpoints';
export * from './schemas';
```

- [ ] Build check: `cd packages/api-client && npx tsc --noEmit` or verify via parent workspace

---

## Task 3: Create Transformers

**Classification:** Small
**File:** `apps/admin/lib/transformers.ts` (NEW)

```typescript
import type { Activity, Artist, Service, Location } from '@memo/domain';
import type { ActivityResponse, MasterResponse, ServiceResponse, LocationResponse } from '@memo/api-client';

// ─── Activity ────────────────────────────────────────────────
export function transformActivity(raw: ActivityResponse): Activity {
  const startDate = new Date(raw.start);
  const jsDay = startDate.getDay();        // 0=Sun, 1=Mon, ..., 6=Sat
  const day = jsDay === 0 ? 6 : jsDay - 1; // frontend: 0=Mon,...,6=Sun
  return {
    id: raw.id,
    day,
    masterId: raw.master_id,
    artistId: raw.master_id,
    startTime: startDate.getHours() + startDate.getMinutes() / 60,
    duration: raw.duration / 60,  // backend: minutes → frontend: hours
    serviceId: raw.service_id,
    locationId: raw.location_id,
    occupied: raw.occupied,
    capacity: raw.capacity,
    isPrivate: raw.is_private,
    comment: raw.comment ?? undefined,
  };
}

// ─── Master → Artist ─────────────────────────────────────────
export function transformMaster(raw: MasterResponse): Artist {
  return {
    id: raw.id,
    name: `${raw.first_name} ${raw.last_name}`,
    shortName: raw.first_name,
    color: raw.color,
  };
}

// ─── Service ─────────────────────────────────────────────────
export function transformService(raw: ServiceResponse): Service {
  return {
    id: raw.id,
    name: raw.title,
    duration: raw.duration / 60,  // backend: minutes → frontend: hours
    durationMinutes: raw.duration,
    maxCapacity: raw.max_age,  // FIXME: backend has no maxCapacity, using max_age as proxy
    minAge: `${raw.min_age}+`,
    description: raw.description,
    // Prices not in backend yet — use defaults or 0
    defaultAdultPrice: raw.tariffs?.[0]?.price ?? 0,
  };
}

// ─── Location ────────────────────────────────────────────────
export function transformLocation(raw: LocationResponse): Location {
  return {
    id: raw.id,
    name: raw.name,
    address: raw.address ?? undefined,
    emoji: undefined,
    defaultCapacity: raw.capacity,
  };
}
```

- [ ] Verify types compile: `cd apps/admin && npx tsc --noEmit`

---

## Task 4: Create React Query Hooks

**Classification:** Small
**Files:**
- `apps/admin/hooks/useActivities.ts` (NEW)
- `apps/admin/hooks/useMasters.ts` (NEW)
- `apps/admin/hooks/useServices.ts` (NEW)
- `apps/admin/hooks/useLocations.ts` (NEW)

### `hooks/useActivities.ts`

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';
import { getActivities } from '@memo/api-client';
import { transformActivity } from '@/lib/transformers';
import type { Activity } from '@memo/domain';

export function useActivities(weekStart: string, weekEnd: string) {
  return useQuery<Activity[]>({
    queryKey: ['activities', weekStart, weekEnd],
    queryFn: () => getActivities({ date_from: weekStart, date_to: weekEnd }),
    select: (raw) => raw.map(transformActivity),
  });
}
```

### `hooks/useMasters.ts`

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';
import { getMasters } from '@memo/api-client';
import { transformMaster } from '@/lib/transformers';
import type { Artist } from '@memo/domain';

export function useMasters() {
  return useQuery<Artist[]>({
    queryKey: ['masters'],
    queryFn: () => getMasters(),
    select: (raw) => raw.map(transformMaster),
    staleTime: 5 * 60 * 1000,  // 5 min cache
  });
}
```

### `hooks/useServices.ts`

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';
import { getServices } from '@memo/api-client';
import { transformService } from '@/lib/transformers';
import type { Service } from '@memo/domain';

export function useServices() {
  return useQuery<Service[]>({
    queryKey: ['services'],
    queryFn: () => getServices(),
    select: (raw) => raw.map(transformService),
    staleTime: 5 * 60 * 1000,
  });
}
```

### `hooks/useLocations.ts`

```typescript
'use client';
import { useQuery } from '@tanstack/react-query';
import { getLocations } from '@memo/api-client';
import { transformLocation } from '@/lib/transformers';
import type { Location } from '@memo/domain';

export function useLocations() {
  return useQuery<Location[]>({
    queryKey: ['locations'],
    queryFn: () => getLocations(),
    select: (raw) => raw.map(transformLocation),
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] Ensure all 4 hooks are properly exported (add index.ts or export directly)

---

## Task 5: Rewrite ScheduleContext — Remove Mock Data, Use React Query

**Classification:** Large
**File:** `apps/admin/contexts/ScheduleContext.tsx` (MODIFY)

**What changes:**
1. Remove all imports from `@/lib/mock-data`
2. Remove `activities`, `artists`, `services`, `studios` from state
3. Add React Query hooks for data fetching
4. Wire mutations (addActivity, updateActivity, deleteActivity) through api-client
5. Add optimistic updates
6. Keep: currentWeek, stamp, selectedActivity

```typescript
'use client';

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { Activity, Artist, Service, Location, StampState } from '@memo/domain';
import { useActivities } from '@/hooks/useActivities';
import { useMasters } from '@/hooks/useMasters';
import { useServices } from '@/hooks/useServices';
import { useLocations } from '@/hooks/useLocations';
import { getMonday, formatDate } from '@/lib/utils';
import { createActivity as apiCreateActivity, updateActivity as apiUpdateActivity, deleteActivity as apiDeleteActivity } from '@memo/api-client';
import { useQueryClient, useMutation } from '@tanstack/react-query';

interface ScheduleContextType {
  activities: Activity[];
  artists: Artist[];
  services: Service[];
  locations: Location[];
  currentWeek: Date;
  stamp: StampState;
  setCurrentWeek: (date: Date) => void;
  addActivity: (activity: Omit<Activity, 'id'>) => void;
  updateActivity: (id: string, updates: Partial<Activity>) => void;
  deleteActivity: (id: string) => void;
  setStamp: (stamp: StampState) => void;
  copyLastWeek: () => void;
  loading: boolean;
  error: Error | null;
}

const ScheduleContext = createContext<ScheduleContextType | null>(null);

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  const [currentWeek, setCurrentWeek] = useState(() => getMonday(new Date()));
  const [stamp, setStamp] = useState<StampState>({
    masterId: null,
    serviceId: null,
    locations: new Set(),
    ready: false,
  });

  const queryClient = useQueryClient();
  const weekStart = formatDate(currentWeek);
  const weekEnd = formatDate(new Date(currentWeek.getTime() + 7 * 24 * 60 * 60 * 1000));

  // ─── Data Fetching via React Query ─────────────────────────
  const { data: activities = [], isLoading: activitiesLoading, error: activitiesError } = useActivities(weekStart, weekEnd);
  const { data: artists = [] } = useMasters();
  const { data: services = [] } = useServices();
  const { data: locations = [] } = useLocations();

  // ─── Mutations ─────────────────────────────────────────────
  const activitiesQueryKey = ['activities', weekStart, weekEnd];

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof apiCreateActivity>[0]) => apiCreateActivity(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activitiesQueryKey });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof apiUpdateActivity>[1] }) => apiUpdateActivity(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activitiesQueryKey });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDeleteActivity(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: activitiesQueryKey });
    },
  });

  // ─── Action Methods ────────────────────────────────────────
  const addActivity = useCallback((activity: Omit<Activity, 'id'>) => {
    const startDate = new Date(currentWeek);
    startDate.setDate(startDate.getDate() + activity.day);
    startDate.setHours(Math.floor(activity.startTime), (activity.startTime % 1) * 60, 0, 0);

    // Optimistic: no optimistic update for now — invalidateQueries handles it
    createMutation.mutate({
      master_id: activity.masterId,
      service_id: activity.serviceId,
      location_id: activity.locationId,
      start: startDate.toISOString(),
      duration: Math.round(activity.duration * 60),  // hours → minutes
      capacity: activity.capacity,
      is_private: activity.isPrivate ?? false,
      comment: activity.comment ?? null,
      record_info: null,
    });
  }, [currentWeek, createMutation]);

  const updateActivityFn = useCallback((id: string, updates: Partial<Activity>) => {
    const payload: Record<string, unknown> = {};
    if (updates.masterId !== undefined) payload.master_id = updates.masterId;
    if (updates.serviceId !== undefined) payload.service_id = updates.serviceId;
    if (updates.locationId !== undefined) payload.location_id = updates.locationId;
    if (updates.duration !== undefined) payload.duration = Math.round(updates.duration * 60);
    if (updates.capacity !== undefined) payload.capacity = updates.capacity;
    if (updates.isPrivate !== undefined) payload.is_private = updates.isPrivate;
    if (updates.comment !== undefined) payload.comment = updates.comment;
    // Handle startTime changes (drag & drop)
    if (updates.startTime !== undefined && updates.day !== undefined) {
      const startDate = new Date(currentWeek);
      startDate.setDate(startDate.getDate() + updates.day);
      startDate.setHours(Math.floor(updates.startTime), (updates.startTime % 1) * 60, 0, 0);
      payload.start = startDate.toISOString();
    }
    updateMutation.mutate({ id, data: payload });
  }, [currentWeek, updateMutation]);

  const deleteActivityById = useCallback((id: string) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const copyLastWeek = useCallback(() => {
    // TODO: In API mode, this should fetch last week's activities and create copies
    // For now, it's a no-op until the feature is reimplemented
    console.warn('copyLastWeek not yet implemented with API data');
  }, []);

  // Memoize context value to prevent re-renders
  const contextValue = useMemo(() => ({
    activities,
    artists,
    services,
    locations,
    currentWeek,
    stamp,
    loading: activitiesLoading,
    error: activitiesError,
    setCurrentWeek,
    addActivity,
    updateActivity: updateActivityFn,
    deleteActivity: deleteActivityById,
    setStamp,
    copyLastWeek,
  }), [
    activities, artists, services, locations,
    currentWeek, stamp, activitiesLoading, activitiesError,
    setCurrentWeek, addActivity, updateActivityFn, deleteActivityById, setStamp, copyLastWeek,
  ]);

  return (
    <ScheduleContext.Provider value={contextValue}>
      {children}
    </ScheduleContext.Provider>
  );
}

export function useSchedule() {
  const context = useContext(ScheduleContext);
  if (!context) throw new Error('useSchedule must be used within ScheduleProvider');
  return context;
}
```

**Important note:** The `ARTISTS`, `SERVICES`, `STUDIOS` constants are also imported in other files (Sidebar.tsx, chat-context.tsx, etc.) — these will be handled separately.

- [ ] Verify: TypeScript compiles with no errors

---

## Task 6: Move ScheduleProvider + Create .env.local

**Classification:** Small
**Files:**
- `apps/admin/app/layout.tsx` — MODIFY: remove ScheduleProvider
- `apps/admin/app/page.tsx` — MODIFY: add ScheduleProvider wrapper
- `apps/admin/.env.local` — CREATE

### 6a: `apps/admin/.env.local`

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 6b: Remove ScheduleProvider from `layout.tsx`

Remove the import and usage of ScheduleProvider. Layout should only have:
- QueryClientProvider
- UIProvider
- ToastContainer

### 6c: Wrap ScheduleProvider in `page.tsx`

```typescript
'use client';

import { Sidebar } from './components/layout/Sidebar';
import { Toolbar } from './components/layout/Toolbar';
import { RightPanel } from './components/layout/RightPanel';
import { StampFab } from './components/layout/StampFab';
import { WeekView } from './components/schedule/WeekView';
import { useUI } from '@/contexts/UIContext';
import { ScheduleProvider } from '@/contexts/ScheduleContext';

export default function Home() {
  const { sidebarCollapsed, rightPanelCollapsed } = useUI();

  return (
    <ScheduleProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div
          data-testid="center-content"
          className="flex-1 flex flex-col min-w-0 ml-[var(--sidebar-w,230px)] mr-[var(--right-w,0px)] transition-all duration-300"
          style={{
            marginLeft: sidebarCollapsed ? 'var(--sidebar-collapsed-w)' : undefined,
            marginRight: rightPanelCollapsed ? '0' : undefined,
          }}
        >
          <Toolbar />
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-auto">
              <WeekView />
            </div>
            <RightPanel />
          </div>
        </div>
        <StampFab />
      </div>
    </ScheduleProvider>
  );
}
```

- [ ] Verify: `npm run dev` loads the page without errors

---

## Task 7: Add Loading / Error / Empty States

**Classification:** Small
**Files:**
- `apps/admin/app/components/schedule/WeekView.tsx` — MODIFY

**Context:** ScheduleContext now exposes `loading` and `error` from React Query. WeekView needs to handle these states.

### Loading state: Add a skeleton component or inline loader

In WeekView.tsx, import `useSchedule()` and check `loading`:

```typescript
const { activities, loading, error } = useSchedule();

if (loading) {
  return (
    <div className="flex items-center justify-center h-full text-text-secondary">
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-surface rounded w-32" />
        <div className="h-4 bg-surface rounded w-48" />
        <div className="h-4 bg-surface rounded w-40" />
      </div>
      <span className="ml-3">Загрузка...</span>
    </div>
  );
}

if (error) {
  return (
    <div className="flex items-center justify-center h-full text-status-error">
      <span>Ошибка загрузки: {error.message}</span>
    </div>
  );
}

if (activities.length === 0) {
  return (
    <div className="flex items-center justify-center h-full text-text-secondary">
      <span>Нет занятий на эту неделю</span>
    </div>
  );
}
```

- [ ] Verify visually: loading state shows briefly, then data renders

---

## Task 8: Update Existing Tests

**Classification:** Standard
**Files:** `apps/admin/__tests__/*`

**Context:** Existing tests import mock data directly or depend on ScheduleContext. After the rewrite, ScheduleContext uses React Query, so tests need to:

1. Mock React Query (`@tanstack/react-query`)
2. Provide mock data through React Query rather than through mock-data.ts imports

**Test configuration:** Add to vitest setup or individual tests:

```typescript
// Mock React Query
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useQuery: vi.fn().mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    }),
    useMutation: vi.fn().mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    }),
    useQueryClient: vi.fn().mockReturnValue({
      invalidateQueries: vi.fn(),
    }),
  };
});
```

Specific test files to update (to be verified during implementation):
- `__tests__/DayColumn.test.tsx` — uses ARTISTS, SERVICES from mock-data
- Any other tests that use `useSchedule()` or mock-data directly

- [ ] All tests pass: `cd apps/admin && npm run test`

---

## Summary

| Task | Classification | Files Changed | Depends On |
|------|---------------|--------------|------------|
| 1 — Install React Query | Trivial | 2 | — |
| 2 — Update api-client | Standard | 3 | — |
| 3 — Create transformers | Small | 1 | Task 2 |
| 4 — Create React Query hooks | Small | 4 | Task 2, 3 |
| 5 — Rewrite ScheduleContext | Large | 1 | Task 1, 4 |
| 6 — Move Provider + .env | Small | 3 | Task 5 |
| 7 — Loading/error/empty | Small | 1 | Task 5 |
| 8 — Update tests | Standard | ~3 | Task 5 |
