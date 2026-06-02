# NavigationProvider — Unified Navigation Architecture for Admin Panel

> Date: 2026-06-01
> Status: Design spec ✅
> Worktree: `feat/main-layout`

## Problem

The MiniCalendar in the Menubar is intended as the **global navigation widget** for the admin panel — it should control which time period is displayed on any page. Currently it's coupled to `ScheduleProvider` purely as an implementation artifact, which means:

1. Menubar `useSchedule()` makes it dependent on schedule data it doesn't need
2. Any page that wants the Menubar must also mount `ScheduleProvider` (with 4 API queries)
3. The `/bookings` page is missing the Menubar entirely
4. ScheduleProvider manages `selectedWeek` as local `useState` — it should read from the global navigator

## Solution: NavigationProvider

A lightweight context that manages only **date range navigation**:

```tsx
interface NavigationContextType {
  dateFrom: string;       // ISO date "YYYY-MM-DD"
  dateTo: string;         // ISO date "YYYY-MM-DD"
  selectDateRange: (from: string, to: string) => void;
}
```

- **No API calls.** Pure state management.
- `selectDateRange` sets both dates. Caller decides the range:
  - MiniCalendar: click date → compute week (Mon–Sun) → `selectDateRange(monday, sunday)`
  - Topbar: prev/next week → shift by ±7 days → `selectDateRange(newFrom, newTo)`
  - BookingFilters: user picks arbitrary dates → `selectDateRange(from, to)`
- Default: `dateFrom` = Monday of current week, `dateTo` = following Sunday.

## Renames

| Old name | New name | Purpose |
|----------|----------|---------|
| `Sidebar.tsx` | `Menubar.tsx` | Left panel with logo, MiniCalendar, nav, artists |
| `Toolbar.tsx` | `Topbar.tsx` | Top bar with prev/next week navigation |
| `RightPanel.tsx` | `Toolbar.tsx` | Right sliding panel (stamp, week info) |

## Architecture

```
Providers (root)
├── QueryClientProvider
├── UIProvider (toasts, menubar collapse, theme)
└── {children}
        │
    (main)/layout.tsx       ← route group for pages WITH menubar
    ├── NavigationProvider  ← date nav state (dateFrom, dateTo, selectDateRange)
    ├── Menubar             ← MiniCalendar reads/writes NavigationProvider
    └── {children}
            │
            ├── page.tsx (главная)   ← ScheduleProvider читает selectedWeek из NavigationProvider
            │   ├── Topbar           ← prev/next week → selectDateRange
            │   ├── WeekView         ← activities for selectedWeek
            │   └── Toolbar (right)  ← right panel (stamp, week info)
            │
            └── bookings/page.tsx    ← BookingFilters связаны с NavigationProvider
                ├── BookingFilters   ← dateFrom/dateTo из NavigationProvider
                └── BookingTable
```

### Key changes

| Component | Before | After |
|-----------|--------|-------|
| **Menubar** (ex-Sidebar) | `useSchedule()` for selectedWeek + artists | `useNavigation()` for MiniCalendar; `useMasters()` for artists |
| **ScheduleProvider** | `useState<Date>` for selectedWeek | Reads `dateFrom`/`dateTo` from NavigationProvider |
| **Main page** | ScheduleProvider wraps everything | ScheduleProvider inside (main) layout, reads nav context |
| **Bookings page** | No Menubar, standalone filters | Menubar + BookingFilters connected to NavigationProvider |
| **MiniCalendar** | Passive display | Active navigator: click → selectDateRange(week start, week end) |
| **Topbar** (ex-Toolbar) | Local week nav | prev/next → selectDateRange(shifted week); synced with MiniCalendar |
| **Toolbar** (ex-RightPanel) | Right panel | Kept as is, just renamed |

## Data Flow

### Navigation is a circle:
```
MiniCalendar click date
  → selectDateRange(Monday, Sunday)
    → Topbar displays "Week of June 1–7"
    → WeekView fetches activities
    → BookingFilters (if on /bookings) show new range

Topbar "Next week"
  → selectDateRange(current + 7)
    → MiniCalendar highlights new week
    → WeekView fetches
```

### Main page (`/`)
```
User clicks date in MiniCalendar
  → NavigationProvider.selectDateRange("2026-06-01", "2026-06-07")
    → ScheduleProvider reads dateFrom → fetches activities for that week
    → WeekView renders new activities
    → Topbar shows new week range
```

### Bookings page (`/bookings`)
```
User changes filters (dateFrom, dateTo)
  → BookingFilters calls NavigationProvider.selectDateRange(...)
    → MiniCalendar highlights selected range
    → BookingTable refetches with new dates

User clicks date in MiniCalendar
  → NavigationProvider.selectDateRange(monday, sunday)
    → sets dateFrom..dateTo to that week
      → BookingFilters display updated
      → BookingTable refetches
```

## File Changes

### Renamed files:
- `components/layout/Sidebar.tsx` → `components/layout/Menubar.tsx`
- `components/layout/Toolbar.tsx` → `components/layout/Topbar.tsx`
- `components/layout/RightPanel.tsx` → `components/layout/Toolbar.tsx`

### New files:
- `contexts/NavigationContext.tsx` — NavigationProvider + useNavigation hook
- `app/(main)/layout.tsx` — route group layout (NavigationProvider + Menubar)

### Modified files:
- `app/page.tsx` — remove Menubar, remove ScheduleProvider (now in layout). Keep Topbar + WeekView + Toolbar(right) + StampFab
- `app/bookings/page.tsx` — move to `(main)/bookings/page.tsx`, connect to NavigationProvider
- `app/components/layout/Menubar.tsx` — replace `useSchedule()` with `useNavigation()` + `useMasters()`
- `contexts/ScheduleContext.tsx` — read selectedWeek from NavigationProvider instead of local useState
- Update all imports referencing renamed files

### Moved files:
- `app/bookings/page.tsx` → `app/(main)/bookings/page.tsx`
- `app/bookings/components/` → `app/(main)/bookings/components/`

## All Imports to Update

| File | Old import | New import |
|------|-----------|------------|
| `app/page.tsx` | `Sidebar` | remove |
| `app/page.tsx` | `Toolbar` | `Topbar` |
| `app/page.tsx` | `RightPanel` | `Toolbar` |
| `app/(main)/layout.tsx` | new | `Menubar` |
| Tests referencing Sidebar | `Sidebar` | `Menubar` |
| Tests referencing Toolbar | `Toolbar` | `Topbar` |
| Tests referencing RightPanel | `RightPanel` | `Toolbar` |

## Testing

- **NavigationContext.test.tsx** — unit tests for context state management
- **Menubar standalone** — existing menubar tests should pass without ScheduleProvider
- **Main page** — existing schedule tests should pass (ScheduleProvider reads nav context)
- **Bookings page** — existing booking tests pass with nav-connected filters
- **Integration** — MiniCalendar click → filters update → table refreshes

## Migration Sequence

To avoid broken `git mv` rename conflicts, use this order:

1. Create NavigationContext.tsx + test
2. Rename Sidebar → Menubar, Toolbar → Topbar, RightPanel → Toolbar (git mv)
3. Update all internal imports
4. Create `(main)/layout.tsx` with NavigationProvider + Menubar
5. Refactor Menubar to useNavigation + useMasters
6. Refactor ScheduleProvider to read from NavigationProvider
7. Move bookings into (main)/bookings + connect filters to NavigationProvider
8. Update page.tsx (main route) — remove Menubar + ScheduleProvider wrapper
9. Run tests, fix failing imports

## Visual Compliance Checks

- [ ] Menubar visible on both `/` and `/bookings` pages
- [ ] MiniCalendar shows current/selected week highlighted
- [ ] Clicking a date in MiniCalendar on `/bookings` updates BookingFilters
- [ ] Changing BookingFilters date range highlights that range in MiniCalendar
- [ ] On main page, MiniCalendar click & Topbar prev/next are synced (same week)
- [ ] Menubar collapse/expand works on both pages
- [ ] ArtistLegend shows in menubar on both pages
