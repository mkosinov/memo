# Frontend–Backend API Integration Design

> Date: 2026-05-30
> Stage: 5 — Frontend–Backend API Integration
> Status: Draft

## 1. Problem Statement

The admin panel (`apps/admin/`) is currently **100% mock-driven**. All data (activities, artists, services, locations, bookings, clients) comes from hardcoded arrays in `lib/mock-data.ts`. The `@memo/api-client` package exists but is never called. Backend has a full REST API at `/api/v1/` with 161 passing tests, but frontend never connects to it.

**Goal:** Replace mock data with live API calls. Admin panel works with real backend data.

## 2. Architecture (Approved)

### Layer Diagram

```
UI Components (WeekView, DayColumn, etc.)
        ↕ useSchedule(), useUI()
ScheduleContext (React Context)
  ┌──────────────────────────────────┐
  │  Data:    currentWeek, stamp,    │
  │           selectedActivity       │
  │  No API calls, no mock imports   │
  │  Uses React Query hooks ↓       │
  └──────────────────────────────────┘
        ↕
React Query (useQuery / useMutation)
  ┌──────────────────────────────────┐
  │  Features:                       │
  │  • Automatic caching (staleTime) │
  │  • Retry on failure (retry: 2)   │
  │  • Request deduplication         │
  │  • Background refetch            │
  │  • select() for data transform   │
  └──────────────────────────────────┘
        ↕
@memo/api-client (fetch + Zod validation)
  ┌──────────────────────────────────┐
  │  • GET/POST/PUT/DELETE           │
  │  • Zod schema validation         │
  │  • ApiError class                │
  └──────────────────────────────────┘
        ↕
Backend API (FastAPI, /api/v1/)
```

### Key Design Decisions

1. **React Query** — data fetching, caching, retry, deduplication. Replaces any custom DataProvider.
2. **No separate DataProvider** — React Query is the data layer.
3. **No separate mappers package** — `select()` in React Query handles transformation.
4. **ScheduleContext** — stores ONLY UI state (currentWeek, stamp, selectedActivity). No data from backend.
5. **ScheduleProvider** — moved from root layout to page-level (or route group).
6. **Reference data** (masters, services, locations) — fetched via React Query with `staleTime: 5min`. Cached globally. No Context needed.

### Mapping Strategy

One mapper function per entity, called inside React Query's `select()`:

```typescript
// lib/transformers.ts (single file in apps/admin)
export function transformActivity(raw: ActivityResponse): Activity {
  const startDate = new Date(raw.start)
  const jsDay = startDate.getDay()        // 0=Sun, 1=Mon, ..., 6=Sat
  const day = jsDay === 0 ? 6 : jsDay - 1 // frontend: 0=Mon,...,6=Sun
  return {
    id: raw.id,
    masterId: raw.master_id,
    serviceId: raw.service_id,
    locationId: raw.location_id,
    day,
    startTime: startDate.getHours() + startDate.getMinutes() / 60,
    duration: raw.duration / 60,        // backend minutes → frontend hours
    capacity: raw.capacity,
    occupied: raw.occupied,
    isPrivate: raw.is_private,
    comment: raw.comment ?? undefined,
  }
}
```

Enrichment (joining activity with service name, artist color, etc.) — done at the component level via `useMemo` + lookup in reference arrays. This keeps data fetching simple and avoids coupling.

## 3. Scope — What Changes

### 3.1 Schedule Page (First priority)

The schedule page (`/`) is the main page with WeekView, drag & drop, stamp. It's the most complex and most important to integrate first.

**What changes in ScheduleContext:**
- Remove: `activities`, `artists`, `services`, `studios` from state
- Remove: imports from `mock-data.ts`
- Keep: `currentWeek`, `stamp`, `selectedActivity`
- Add: React Query hooks for data fetching

**New hooks:**
- `useActivities(weekStart, weekEnd)` → `useQuery` with `select`
- `useMasters()` → `useQuery` with `staleTime: 300_000`
- `useServices()` → `useQuery` with `staleTime: 300_000`
- `useLocations()` → `useQuery` with `staleTime: 300_000`

**Mutations:**
- addActivity, updateActivity, deleteActivity — become `useMutation` calls
- Optimistic updates: update cache on mutate, rollback on error

**ScheduleProvider placement:**
- Move from `app/layout.tsx` (root) to `app/page.tsx` (wraps only schedule page)
- This prevents fetching schedule data on non-schedule pages

### 3.2 @memo/api-client Updates

Current endpoint paths use `/api/activities`, `/api/artists`, etc.
Backend serves at `/api/v1/activities`, `/api/v1/masters`, etc.

**Changes needed:**
- Update path prefixes: `/api/` → `/api/v1/`
- Add missing endpoints: `getMasters`, `getServices` (only `getArtists` exists)
- Align request/response schemas with backend Pydantic models
- Backend uses `PUT` for full updates (not `PATCH`)

### 3.3 Environment

- Create `.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:8000`
- Backend runs on port 8000 by default (configurable)

### 3.4 Loading, Error, Empty States

- **Loading:** Skeleton/loader in WeekView while activities load
- **Error:** Toast notification on API failure + retry button
- **Empty:** "Нет занятий на эту неделю" message when 0 activities returned

### 3.5 Mock Data

- `mock-data.ts` kept as fallback during implementation
- Removed only after all pages successfully load from real API
- Tests currently depend on mock data — updated in final phase

## 4. Out of Scope

- Booking page (Stage 6): will be migrated after schedule page
- Artist context / Chat context: future
- Backend changes: backend is ready (161 tests pass). No backend changes needed.
- Auth: backend has no auth yet, stays as-is

## 5. Dependencies

- `npm install @tanstack/react-query` (v5)
- `.env.local` with API URL
- Backend must be running on port 8000

## 6. Acceptance Criteria

- [ ] Schedule page loads real activities from `GET /api/v1/activities?date_from=&date_to=`
- [ ] Artist colors/names display correctly from `GET /api/v1/masters`
- [ ] Service names display correctly from `GET /api/v1/services`
- [ ] Location names display correctly from `GET /api/v1/locations`
- [ ] Creating an activity posts to `POST /api/v1/activities`
- [ ] Editing an activity puts to `PUT /api/v1/activities/{id}`
- [ ] Deleting an activity deletes via `DELETE /api/v1/activities/{id}`
- [ ] Drag & drop triggers API update
- [ ] Stamp mode creates activities via API
- [ ] Copy last week creates multiple activities via API
- [ ] Loading state shown while data loads
- [ ] Error state shown on API failure (toast)
- [ ] All existing tests pass (frontend vitest + backend pytest)

## Visual Compliance Checks

Checks use Playwright text selectors (`text=...`). Must include trigger word "button" in description to enable text-based selection.

- [ ] "Сегодня" button label renders in schedule toolbar
- [ ] "Мини-картина акрилом" button service name on activity card
- [ ] "12:00" button time format on activity from API
- [ ] "Ольга" button artist name renders in sidebar

## 8. Implementation Order

1. Install React Query + set up QueryClientProvider
2. Update @memo/api-client (paths + new endpoints)
3. Create React Query hooks: useActivities, useMasters, useServices, useLocations
4. Create transform functions (lib/transformers.ts)
5. Rewrite ScheduleContext: remove mock data, use hooks
6. Move ScheduleProvider to page-level
7. Add loading/error states to WeekView
8. Wire mutations (create, update, delete) through useMutation
9. Wire drag & drop + stamp through mutations
10. Verify E2E: backend + frontend together
11. Update existing tests
12. Remove mock-data.ts (after verification)
