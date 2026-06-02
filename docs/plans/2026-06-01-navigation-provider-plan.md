# NavigationProvider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create NavigationProvider as the unified date navigation source, add Menubar (ex-Sidebar) to /bookings, rename Sidebar→Menubar/Toolbar→Topbar/RightPanel→Toolbar.

**Architecture:** Lightweight NavigationContext with `dateFrom`/`dateTo`/`selectDateRange`. Route group `(main)/layout.tsx` provides NavigationProvider + Menubar. ScheduleProvider reads from NavigationProvider instead of its own useState. All navigation (MiniCalendar, Topbar prev/next, BookingFilters) flows through NavigationProvider.

**Tech Stack:** React Context, Next.js 14 App Router (route groups), TypeScript

**Sequence:** Tasks are ordered to minimize import conflict churn — renames first, then logic refactors, then layout/page wiring.

---

## Task 1: Create NavigationContext (Standard)

**Classification:** Standard

**Files:**
- Create: `frontend/admin/contexts/NavigationContext.tsx`
- Create: `frontend/admin/__tests__/NavigationContext.test.tsx`

**Context:** New lightweight context — pure state, no API calls. Provides `dateFrom`, `dateTo`, and `selectDateRange(from, to)`. Initializes to current week (Mon–Sun).

**Actions:**
- [ ] Create `contexts/NavigationContext.tsx`:
  ```tsx
  'use client';
  import React, { createContext, useContext, useState, useCallback } from 'react';
  import { getMonday, formatDateISO } from '@/lib/utils';

  interface NavigationContextType {
    dateFrom: string;
    dateTo: string;
    selectDateRange: (from: string, to: string) => void;
  }

  const NavigationContext = createContext<NavigationContextType | null>(null);

  function getCurrentWeekRange(): { dateFrom: string; dateTo: string } {
    const monday = getMonday(new Date());
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    return {
      dateFrom: formatDateISO(monday),
      dateTo: formatDateISO(sunday),
    };
  }

  export function NavigationProvider({ children }: { children: React.ReactNode }) {
    const [dateFrom, setDateFrom] = useState(getCurrentWeekRange().dateFrom);
    const [dateTo, setDateTo] = useState(getCurrentWeekRange().dateTo);

    const selectDateRange = useCallback((from: string, to: string) => {
      setDateFrom(from);
      setDateTo(to);
    }, []);

    return (
      <NavigationContext.Provider value={{ dateFrom, dateTo, selectDateRange }}>
        {children}
      </NavigationContext.Provider>
    );
  }

  export function useNavigation(): NavigationContextType {
    const ctx = useContext(NavigationContext);
    if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
    return ctx;
  }
  ```

- [ ] Create `__tests__/NavigationContext.test.tsx`:
  - Test initial values: dateFrom = Monday of current week, dateTo = following Sunday
  - Test `selectDateRange` updates both values
  - Test that `useNavigation` throws without provider
  - Use `renderHook` with wrapper pattern

- [ ] Run test: `cd frontend/admin && npx vitest run __tests__/NavigationContext.test.tsx` — all pass

---

## Task 2: Rename Sidebar → Menubar (Small)

**Classification:** Small

**Files:**
- Rename: `components/layout/Sidebar.tsx` → `components/layout/Menubar.tsx`
- Modify: all files importing `Sidebar` → `Menubar`

**Context:** Pure rename. No logic changes. Update component name, export name, data-testid, and all imports.

**Actions:**
- [ ] `git mv frontend/admin/app/components/layout/Sidebar.tsx frontend/admin/app/components/layout/Menubar.tsx`
- [ ] In `Menubar.tsx`:
  - Rename function from `Sidebar` to `Menubar`
  - Rename `export function Sidebar` → `export function Menubar`
  - Update `data-testid="sidebar"` → `data-testid="menubar"`
  - If any CSS classes reference "sidebar", rename to "menubar" in comments/data attrs
- [ ] Find all files importing `Sidebar` from `@/components/layout/Sidebar`:
  - `frontend/admin/app/page.tsx`: `import { Menubar } from './components/layout/Menubar'`
  - Test files referencing Sidebar
  - Update all to `import { Menubar } from '...'`
- [ ] Run tests: `cd frontend/admin && npx vitest run` — verify all pass

---

## Task 3: Rename Toolbar → Topbar (Small)

**Classification:** Small

**Files:**
- Rename: `components/layout/Toolbar.tsx` → `components/layout/Topbar.tsx`
- Modify: all files importing `Toolbar` from layout → `Topbar`

**Context:** Pure rename. No logic changes.

**Actions:**
- [ ] `git mv frontend/admin/app/components/layout/Toolbar.tsx frontend/admin/app/components/layout/Topbar.tsx`
- [ ] In `Topbar.tsx`: rename function `Toolbar` → `Topbar`
- [ ] Update all imports:
  - `page.tsx`: `import { Topbar } from './components/layout/Topbar'`
  - Test files
- [ ] Run tests: `cd frontend/admin && npx vitest run`

---

## Task 4: Rename RightPanel → Toolbar (Small)

**Classification:** Small

**Files:**
- Rename: `components/layout/RightPanel.tsx` → `components/layout/Toolbar.tsx`
- Modify: all files importing `RightPanel` → `Toolbar`

**Context:** Pure rename. `Toolbar` name now refers to the right panel (per user's naming). Top bar is `Topbar`.

**Actions:**
- [ ] `git mv frontend/admin/app/components/layout/RightPanel.tsx frontend/admin/app/components/layout/Toolbar.tsx`
- [ ] In `Toolbar.tsx`: rename function `RightPanel` → `Toolbar`
- [ ] Update all imports:
  - `page.tsx`: `import { Toolbar } from './components/layout/Toolbar'`
  - Test files
- [ ] Run tests: `cd frontend/admin && npx vitest run`

---

## Task 5: Refactor Menubar to use NavigationProvider + useMasters (Standard)

**Classification:** Standard

**Files:**
- Modify: `frontend/admin/app/components/layout/Menubar.tsx`

**Context:** Menubar currently uses `useSchedule()` from ScheduleContext for MiniCalendar's `selectedWeek` and `artists`. Need to switch to `useNavigation()` for date nav and `useMasters()` for artists list. This makes Menubar independent of ScheduleProvider.

**Actions:**
- [ ] Change imports:
  - Remove: `import { useSchedule } from '@/contexts/ScheduleContext';`
  - Add: `import { useNavigation } from '@/contexts/NavigationContext';`
  - Add: `import { useMasters } from '@/hooks/useMasters';`
- [ ] In the `Menubar` component body, replace:
  ```tsx
  const { currentWeek, setCurrentWeek, artists } = useSchedule();
  ```
  with:
  ```tsx
  const { dateFrom, dateTo, selectDateRange } = useNavigation();
  const { data: artists = [] } = useMasters();
  ```
- [ ] Calculate `selectedWeek` (for MiniCalendar display) from `dateFrom`:
  ```tsx
  const selectedWeek = useMemo(() => new Date(dateFrom + 'T00:00:00'), [dateFrom]);
  ```
- [ ] Update MiniCalendar `setCurrentWeek` → integrate with nav:
  - Replace `setCurrentWeek(date)` calls with logic that computes Mon-Sun range from clicked date:
  ```tsx
  const handleWeekSelect = (date: Date) => {
    const monday = getMonday(date);
    const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
    selectDateRange(formatDateISO(monday), formatDateISO(sunday));
  };
  ```
  - Pass `handleWeekSelect` as the callback where `setCurrentWeek` was used
- [ ] Update MiniCalendar props: pass `selectedWeek` (derived from dateFrom) instead of `currentWeek`, and `handleWeekSelect` instead of `setCurrentWeek`
- [ ] Update ArtistLegend — prop `artists` already passed from component, just now sourced from `useMasters()` instead of `useSchedule()`
- [ ] Remove unused `DAYS` import if MiniCalendar now uses `DAYS` from directly imported utils (keep if needed)
- [ ] Run tests: `cd frontend/admin && npx vitest run`

---

## Task 6: Create (main)/layout.tsx (Small)

**Classification:** Small

**Files:**
- Create: `frontend/admin/app/(main)/layout.tsx`

**Context:** Route group layout that wraps pages WITH menubar. Provides NavigationProvider + renders Menubar + flex container with margin for the menubar.

**Actions:**
- [ ] Create `frontend/admin/app/(main)/layout.tsx`:
  ```tsx
  'use client';

  import React from 'react';
  import { Menubar } from '../components/layout/Menubar';
  import { NavigationProvider } from '@/contexts/NavigationContext';
  import { useUI } from '@/contexts/UIContext';

  function MainShell({ children }: { children: React.ReactNode }) {
    const { sidebarCollapsed } = useUI();

    return (
      <div className="flex h-screen overflow-hidden">
        <Menubar />
        <div
          className="flex-1 flex flex-col min-w-0 transition-all duration-300"
          style={{
            marginLeft: sidebarCollapsed
              ? 'var(--sidebar-collapsed-w)'
              : 'var(--sidebar-w)',
          }}
        >
          {children}
        </div>
      </div>
    );
  }

  export default function MainLayout({ children }: { children: React.ReactNode }) {
    return (
      <NavigationProvider>
        <MainShell>{children}</MainShell>
      </NavigationProvider>
    );
  }
  ```
- [ ] Run tests: `cd frontend/admin && npx vitest run` — should still pass (no pages use this layout yet)

---

## Task 7: Refactor Topbar to use NavigationProvider (Standard)

**Classification:** Standard

**Files:**
- Modify: `frontend/admin/app/components/layout/Topbar.tsx`

**Context:** Topbar (ex-Toolbar) has prev/next week buttons and displays current week range. Currently uses `selectedWeek`/`setSelectedWeek` from ScheduleContext. Switch to `useNavigation()`.

**Actions:**
- [ ] Change imports:
  - Remove: `import { useSchedule } from '@/contexts/ScheduleContext';`
  - Add: `import { useNavigation } from '@/contexts/NavigationContext';`
  - Keep: `import { getMonday, formatDateISO } from '@/lib/utils';` (for date math)
- [ ] Replace:
  ```tsx
  const { currentWeek, setCurrentWeek } = useSchedule();
  ```
  with:
  ```tsx
  const { dateFrom, dateTo, selectDateRange } = useNavigation();
  ```
- [ ] Replace prev/next week logic:
  - `prevWeek`: compute new Mon-Sun shifted by -7 days from `dateFrom` → `selectDateRange(newFrom, newTo)`
  - `nextWeek`: shifted by +7 days
  - `selectedWeek` display: derive from `dateFrom` for display formatting
- [ ] Remove `currentWeek`/`setCurrentWeek` references — use `dateFrom` for display
- [ ] Run tests: `cd frontend/admin && npx vitest run`

---

## Task 8: Refactor ScheduleProvider to read NavigationProvider (Standard)

**Classification:** Standard

**Files:**
- Modify: `frontend/admin/contexts/ScheduleContext.tsx`
- Update tests: `__tests__/ScheduleContext.test.tsx`

**Context:** ScheduleProvider currently has its own `useState<Date>` for `selectedWeek`. It should read `dateFrom`/`dateTo` from NavigationProvider (which wraps it via (main)/layout.tsx).

**Actions:**
- [ ] Add import: `import { useNavigation } from '@/contexts/NavigationContext';`
- [ ] Remove:
  ```tsx
  const [selectedWeek, setSelectedWeek] = useState(() => getMonday(new Date()));
  ```
  and corresponding `setSelectedWeek` from context value
- [ ] Add:
  ```tsx
  const { dateFrom, dateTo } = useNavigation();
  const selectedWeek = useMemo(() => new Date(dateFrom + 'T00:00:00'), [dateFrom]);
  ```
- [ ] Replace `formatDateISO(selectedWeek)` usage — now use `dateFrom` directly:
  ```tsx
  const weekStart = dateFrom;
  const weekEnd = dateTo;
  ```
  (Previously it was computed from `selectedWeek`.)
- [ ] Remove `setSelectedWeek` from `ScheduleContextType` interface
- [ ] Update `ScheduleContextType` — keep `selectedWeek` as read-only (for backward compat with Topbar... wait, Topbar no longer reads from ScheduleProvider). Actually check if any other component reads `selectedWeek` or `setSelectedWeek` from ScheduleProvider:
  - Delete `setSelectedWeek` from interface and context value
  - Keep `selectedWeek` in interface if any component needs it (derive from dateFrom internally)
- [ ] Update ScheduleContext tests:
  - Remove tests for `setSelectedWeek`
  - Wrap test render in `NavigationProvider` (since ScheduleProvider now depends on it)
- [ ] Run tests: `cd frontend/admin && npx vitest run`

---

## Task 9: Update main page.tsx (Small)

**Classification:** Small

**Files:**
- Modify: `frontend/admin/app/page.tsx`

**Context:** Main page currently imports Sidebar, Toolbar, RightPanel and wraps in ScheduleProvider. Now:
- Menubar comes from (main)/layout.tsx
- ScheduleProvider is inside page (inside layout, below NavigationProvider)
- Renamed imports: Topbar (ex-Toolbar), Toolbar (ex-RightPanel)
- Remove StampFab if it's part of page (keep it)

**Actions:**
- [ ] Update imports:
  ```tsx
  import { Topbar } from './components/layout/Topbar';
  import { Toolbar } from './components/layout/Toolbar';
  import { StampFab } from './components/layout/StampFab';
  import { WeekView } from './components/schedule/WeekView';
  import { ScheduleProvider } from '@/contexts/ScheduleContext';
  ```
  (Remove Menubar — now in layout)
- [ ] Remove `import { useUI } from '@/contexts/UIContext';` (or keep if used for rightPanelCollapsed)
- [ ] Simplify component:
  ```tsx
  export default function Home() {
    const { rightPanelCollapsed } = useUI();

    return (
      <ScheduleProvider>
        <Topbar />
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-auto">
            <WeekView />
          </div>
          <Toolbar />
        </div>
        <StampFab />
      </ScheduleProvider>
    );
  }
  ```
- [ ] Run tests: `cd frontend/admin && npx vitest run`

---

## Task 10: Move /bookings into (main)/bookings + connect filters (Standard)

**Classification:** Standard

**Files:**
- Move: `app/bookings/` → `app/(main)/bookings/`
- Modify: `app/(main)/bookings/page.tsx`

**Context:** Move bookings page under the (main) route group so it gets the layout with Menubar + NavigationProvider. Connect the existing filter state to NavigationProvider.

**Actions:**
- [ ] `git mv frontend/admin/app/bookings frontend/admin/app/\(main\)/bookings`
- [ ] Update `app/(main)/bookings/page.tsx`:
  - Add import: `import { useNavigation } from '@/contexts/NavigationContext';`
  - Remove local `dateFrom`/`dateTo` state (they come from NavigationProvider now)
  - Keep `locationId`, `serviceId`, `masterId`, `status` as local state
  - Use `useNavigation()` values:
    ```tsx
    const { dateFrom, dateTo, selectDateRange } = useNavigation();
    ```
  - Update `handleDateFromChange`:
    ```tsx
    const handleDateFromChange = (v: string) => selectDateRange(v, dateTo);
    ```
  - Update `handleDateToChange`:
    ```tsx
    const handleDateToChange = (v: string) => selectDateRange(dateFrom, v);
    ```
  - Update `handleReset`:
    ```tsx
    const handleReset = () => {
      const monday = getMonday(new Date());
      const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
      selectDateRange(formatDateISO(monday), formatDateISO(sunday));
      setFilters({ locationId: '', serviceId: '', masterId: '', status: '' });
    };
    ```
  - Pass `dateFrom`, `dateTo` to `BookingFilters` from NavigationProvider
- [ ] Check that BookingFilters and BookingTable don't have direct dependencies on ScheduleProvider (they shouldn't — they use their own hooks)
- [ ] Run tests: `cd frontend/admin && npx vitest run`

---

## Task 11: Fix all tests — import paths + new dependencies (Standard)

**Classification:** Standard

**Files:**
- Modify: Any tests broken by renames or refactors
- Run: full test suite

**Context:** After all changes, some tests may have stale imports (old Sidebar/Toolbar/RightPanel names) or missing NavigationProvider wrappers.

**Actions:**
- [ ] Run: `cd frontend/admin && npx vitest run` — identify failures
- [ ] Fix import paths in test files referencing renamed components
- [ ] For any test rendering components that use `useNavigation()`, wrap in `NavigationProvider`
- [ ] For ScheduleContext tests, wrap in `NavigationProvider` + mock `useNavigation` if needed
- [ ] Verify: `cd frontend/admin && npx vitest run` — all green
- [ ] Run backend tests too: `cd backend && uv run pytest -q --tb=short`

---

## Rollback Plan

If tests break catastrophically:
```bash
git checkout .
git clean -fd
```

To reset to main:
```bash
cd /root/workspace/memo
git branch -D feat/main-layout
git worktree remove .worktrees/main-layout
```
