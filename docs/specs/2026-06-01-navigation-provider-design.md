# NavigationProvider — Unified Navigation Architecture for Admin Panel

> Date: 2026-06-01
> Status: Design draft
> Worktree: `feat/main-layout`

## Problem

The MiniCalendar in the Sidebar is intended as the **global navigation widget** for the admin panel — it should control which time period is displayed on any page. Currently it's coupled to `ScheduleProvider` purely as an implementation artifact, which means:

1. Sidebar `useSchedule()` makes it dependent on schedule data it doesn't need
2. Any page that wants the Sidebar must also mount `ScheduleProvider` (with 4 API queries)
3. The `/bookings` page is missing the Sidebar entirely
4. ScheduleProvider manages `currentWeek` as local `useState` — it should read from the global navigator

## Solution: NavigationProvider

A lightweight context that manages only **date range navigation**:

```tsx
interface NavigationContextType {
  dateFrom: string;       // ISO date "YYYY-MM-DD"
  dateTo: string;         // ISO date "YYYY-MM-DD"
  setDateRange: (from: string, to: string) => void;
  focusOnDate: (date: string) => void;  // sets week around this date
}
```

- **No API calls.** Pure state management.
- `focusOnDate(date)` → sets `dateFrom` = Monday of that week, `dateTo` = Sunday.
- Default: `dateFrom` = Monday of current week, `dateTo` = following Sunday.

## Architecture

```
Providers (root)
├── QueryClientProvider
├── UIProvider (toasts, sidebar collapse, theme)
└── {children}
        │
    (main)/layout.tsx        ← route group for pages WITH sidebar
    ├── NavigationProvider   ← date nav state
    ├── Sidebar              ← MiniCalendar reads/writes NavigationProvider
    └── {children}
            │
            ├── page.tsx (главная)   ← ScheduleProvider читает currentWeek из NavigationProvider
            │   ├── Toolbar          ← prev/next week → focusOnDate
            │   ├── WeekView         ← activities for currentWeek
            │   └── RightPanel
            │
            └── bookings/page.tsx    ← BookingFilters связаны с NavigationProvider
                ├── BookingFilters  ← dateFrom/dateTo из NavigationProvider
                └── BookingTable
```

### Key changes

| Component | Before | After |
|-----------|--------|-------|
| **Sidebar** | `useSchedule()` for currentWeek + artists | `useNavigation()` for focusOnDate; `useMasters()` for artists |
| **ScheduleProvider** | `useState<Date>` for currentWeek | Reads `dateFrom`/`dateTo` from NavigationProvider (via context or prop) |
| **Main page** | ScheduleProvider wraps everything | ScheduleProvider inside (main) layout, reads nav context |
| **Bookings page** | No Sidebar, standalone filters | Sidebar + BookingFilters connected to NavigationProvider |
| **MiniCalendar** | Passive display | Active navigator: click → focusOnDate → updates all consumers |

## Data Flow

### Main page (`/`)
```
User clicks date in MiniCalendar
  → NavigationProvider.focusOnDate("2026-06-01")
    → dateFrom = "2026-05-25" (Monday)
    → dateTo = "2026-05-31" (Sunday)
      → ScheduleProvider reads dateFrom → fetches activities for that week
      → WeekView renders new activities
      → Toolbar shows new week range
```

### Bookings page (`/bookings`)
```
User changes filters (dateFrom, dateTo)
  → BookingFilters calls NavigationProvider.setDateRange(...)
    → MiniCalendar highlights selected range
    → BookingTable refetches with new dates

User clicks date in MiniCalendar
  → NavigationProvider.focusOnDate("2026-06-15")
    → sets dateFrom..dateTo to that week
      → BookingFilters display updated
      → BookingTable refetches
```

## File Changes

### New files:
- `frontend/admin/contexts/NavigationContext.tsx` — NavigationProvider + useNavigation hook
- `frontend/admin/app/(main)/layout.tsx` — route group layout (NavigationProvider + Sidebar)

### Modified files:
- `frontend/admin/app/page.tsx` — remove Sidebar, remove ScheduleProvider (now in layout). Keep Toolbar + WeekView + RightPanel + StampFab
- `frontend/admin/app/bookings/page.tsx` — move to (main)/bookings/page.tsx, connect to NavigationProvider
- `frontend/admin/app/components/layout/Sidebar.tsx` — replace `useSchedule()` with `useNavigation()` + `useMasters()`
- `frontend/admin/contexts/ScheduleContext.tsx` — read currentWeek from NavigationProvider instead of local useState

### Moved files:
- `frontend/admin/app/bookings/page.tsx` → `frontend/admin/app/(main)/bookings/page.tsx`
- `frontend/admin/app/bookings/components/` → `frontend/admin/app/(main)/bookings/components/`

## Testing

- **NavigationContext.test.tsx** — unit tests for context state management
- **Sidebar standalone** — existing Sidebar tests should pass without ScheduleProvider
- **Main page** — existing schedule tests should pass (ScheduleProvider reads nav context)
- **Bookings page** — existing booking tests pass with nav-connected filters
- **Integration** — MiniCalendar click → filters update → table refreshes

## Visual Compliance Checks

- [ ] Sidebar visible on both `/` and `/bookings` pages
- [ ] MiniCalendar shows current/selected week highlighted
- [ ] Clicking a date in MiniCalendar on `/bookings` updates BookingFilters
- [ ] Changing BookingFilters date range highlights that range in MiniCalendar
- [ ] On main page, MiniCalendar click updates WeekView's week
- [ ] Sidebar collapse/expand works on both pages
- [ ] ArtistLegend shows in sidebar on both pages
