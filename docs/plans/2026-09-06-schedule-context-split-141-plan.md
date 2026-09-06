# Schedule Context Split + usePersistedState (#141) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the 577-line ScheduleContext god-context into three independently-subscribable contexts (data / view / grid settings) so zoom stops re-rendering the whole schedule; add a shared `usePersistedState` hook; remove the 5s mutation-timeout race; add a saving indicator + native unsaved-changes guard; fix per-directory filter init.

**Architecture:** One provider composition (`ScheduleProvider`) mounts three nested providers on both current mount pages (/schedule, /clients). The data provider receives filters (view) and working hours (settings) as props from the composition — the data context is explicitly NOT independent (spec §3). Query keys, cache-sharing and optimistic mechanics stay byte-identical; only ownership moves. `useSchedule()` is deleted with no compat shim.

**Tech Stack:** Next.js 14 App Router, React 18, TanStack Query v5 (`useMutationState` for the indicator), Vitest + Testing Library, Playwright e2e.

**Spec:** `docs/specs/2026-09-06-schedule-context-split-design.md` (binding; §2 locked decisions, §3 split contract + migration map, §4 hook, §5 mutation correctness, §6 filter init).

**Worktree:** create after G2 via `./.opencode/scripts/create-worktree.sh feat/schedule-context-split-141`.

**Test commands** (from `frontend/admin`): `npx vitest run <paths>` targeted, `npm run test` full unit, `npx tsc --noEmit`, `npm run lint`.

---

## Behavioral Delta

How this behaves for the user, mapped to spec acceptance criteria:

- **Zoom no longer re-renders the whole schedule (С1)** — zooming / changing grid settings leaves data-only parts of the screen untouched; the schedule feels snappier. No visual change.
- **Slow save keeps the new position (С2)** — dragging/editing an activity during a slow server response no longer "undoes" itself after 5 seconds: the activity stays where the admin put it, a «сохраняем…» chip shows in the top bar while saving, and the screen always settles to what the server actually confirmed.
- **Leaving mid-save is guarded (С3)** — reloading the page or closing the tab while a schedule change is saving triggers the browser's native "leave site?" warning. Navigating inside the app is never blocked — the save completes in the background and the data converges.
- **Filters initialize with an empty locations dictionary (С4)** — a salon with no locations set up gets working master filters and a "show all" grid (was: filters never initialized).
- **Settings survive reload exactly as before (С5)** — zoom, grid frequency, working hours and table column visibility persist across restarts, now through one shared storage mechanism instead of four hand-rolled ones.
- **Everything else is behavior-identical** — all existing screens, copy and e2e flows (including the `__memo-*` test events) keep working unchanged.

---

## File Structure (decisions locked)

| File | Action | Responsibility |
|---|---|---|
| `frontend/admin/hooks/usePersistedState.ts` | CREATE | generic localStorage hook (storage mechanics only) |
| `frontend/admin/hooks/useUnsavedChangesGuard.ts` | CREATE | beforeunload attach-while-dirty |
| `frontend/admin/contexts/schedule/GridSettingsContext.tsx` | CREATE | 4 persisted settings + domain clamp wrappers |
| `frontend/admin/contexts/schedule/ScheduleViewContext.tsx` | CREATE | view state + period nav + `__memo-*` listeners (verbatim) |
| `frontend/admin/contexts/schedule/ScheduleDataContext.tsx` | CREATE | queries + mutations + derivations |
| `frontend/admin/contexts/schedule/ScheduleProvider.tsx` | CREATE | composition (3 providers; passes view/settings inputs into data) |
| `frontend/admin/contexts/ScheduleContext.tsx` | DELETE | after all consumers migrate (Task 12) |
| `frontend/admin/app/components/shared/DataTable.tsx` | MODIFY | localStorage block → usePersistedState |
| `frontend/admin/app/components/layout/Topbar.tsx` | MODIFY | 3 hooks + indicator (useMutationState) + guard |
| `frontend/admin/app/components/layout/Toolbar.tsx` | MODIFY | useScheduleData (copyLastWeek only) |
| `frontend/admin/app/components/layout/Menubar.tsx` | MODIFY | `ViewModeType` type import → ScheduleViewContext |
| `frontend/admin/app/components/schedule/WeekView.tsx`, `DayView.tsx` | MODIFY | data + view + settings hooks |
| `frontend/admin/app/components/schedule/ActivityCard.tsx` | MODIFY | data + settings (cellHeight) |
| `frontend/admin/app/components/stamp/StampPanel.tsx` | MODIFY | view (stamp) + data (dicts) |
| `frontend/admin/app/components/modal/ActivityDetailsModal/{ActivityDetailsModal,SettingsTab}.tsx` | MODIFY | data (+settings for SettingsTab) |
| `frontend/admin/app/(main)/schedule/page.tsx`, `app/(main)/clients/page.tsx` | MODIFY | mount ScheduleProvider (new path); inner ScheduleView → useScheduleView |
| `frontend/admin/app/(main)/clients/components/ClientRecordTab.tsx` | MODIFY | useGridSettings only |
| `frontend/admin/__tests__/helpers/mockContexts.ts` | MODIFY | + 3 mock factories (old one stays until Task 12) |
| `frontend/admin/__tests__/helpers/renderWithProviders.tsx` | MODIFY | + 3 mock registrations; + useMutationState in react-query mock |
| tests (26 files, see Task 12 inventory) | MODIFY | per-task alongside their components |
| `__tests__/ScheduleContext.test.tsx` | SPLIT → DELETE | cases move to per-context suites (Tasks 4-5), file deleted in Task 12 |

**Commits:** per-task, prefix `refactor(#141):` / `test(#141):`. Single PR at the end.

**Migration order note (build stays green task-by-task):** new contexts land ALONGSIDE the old one (Tasks 3-5); consumers migrate group-by-group with their tests (Tasks 8-11); the old context and its mock are deleted last (Task 12).

---

## Task 1: `usePersistedState` hook
### Classification: small
### Required Docs
- Spec §4 (binding hook contract — SSR mechanics, validation split)
- Skill: test-driven-development

### Task Description
**1.1** RED — CREATE `frontend/admin/__tests__/usePersistedState.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePersistedState } from '@/hooks/usePersistedState';

const decodeNumber = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

describe('usePersistedState', () => {
  beforeEach(() => localStorage.clear());

  it('returns fallback when key absent', () => {
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    expect(result.current[0]).toBe(7);
  });

  it('returns decoded stored value', () => {
    localStorage.setItem('k', '42');
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    expect(result.current[0]).toBe(42);
  });

  it('returns fallback on garbage / decode-null', () => {
    localStorage.setItem('k', 'not-a-number');
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    expect(result.current[0]).toBe(7);
    localStorage.setItem('k2', '99');
    const strict = (raw: string) => (raw === '1' ? 1 : null);
    const r2 = renderHook(() => usePersistedState('k2', 0, strict));
    expect(r2.result.current[0]).toBe(0);
  });

  it('setter updates value and persists JSON', () => {
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    act(() => result.current[1](50));
    expect(result.current[0]).toBe(50);
    expect(localStorage.getItem('k')).toBe('50');
  });

  it('setter keeps in-memory value when storage write throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    act(() => result.current[1](9));
    expect(result.current[0]).toBe(9);
    spy.mockRestore();
  });

  it('SSR: returns fallback when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    expect(result.current[0]).toBe(7);
    vi.unstubAllGlobals();
  });
});
```

**1.2** Run `npx vitest run __tests__/usePersistedState.test.tsx` — expect FAIL (module missing).

**1.3** GREEN — CREATE `frontend/admin/hooks/usePersistedState.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';

// localStorage-backed state (GH #141, spec §4).
// The hook owns STORAGE MECHANICS only (read/parse/persist/SSR guard);
// value semantics (clamp/validate) stay in the domain hook or component —
// write-side clamping lives in GridSettingsContext, read-side in `decode`.
// SSR mechanics are deliberately identical to the four grid settings today:
// lazy useState initializer + typeof-window guard; no useSyncExternalStore,
// no cross-tab `storage` events (considered and rejected — no requirement).
export function usePersistedState<T>(
  key: string,
  fallback: T,
  decode: (raw: string) => T | null,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return fallback;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return fallback;
      const decoded = decode(raw);
      return decoded === null ? fallback : decoded;
    } catch {
      return fallback;
    }
  });

  const setPersisted = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage full/blocked — keep the in-memory value */
      }
    },
    [key],
  );

  return [value, setPersisted];
}
```

**1.4** Run the suite — expect PASS. `npx tsc --noEmit`.
**1.5** Commit: `refactor(#141): usePersistedState — generic localStorage hook (spec §4)`.

---

## Task 2: DataTable → usePersistedState
### Classification: small
### Required Docs
- Spec §4 (DataTable migration — decode handles storage validity only)
- Existing e2e `e2e/schedule-column-visibility.spec.ts` (regression guard)

### Task Description
**2.1** MODIFY `frontend/admin/app/components/shared/DataTable.tsx`: replace the read block (`:19-36`, `localStorage.getItem` + JSON.parse + try/catch) and the write (`:66`, `localStorage.setItem`) with the hook. Storage key and JSON-array format UNCHANGED. The column-aware check (stored ids ⊆ current `columns` prop) stays in the component — it depends on runtime props and cannot live in `decode`:

```ts
import { usePersistedState } from '@/hooks/usePersistedState';

// decode: storage validity only (JSON array of strings); column-subset
// filtering stays here (runtime `columns` dependency — spec §4).
const decodeIdArray = (raw: string): string[] | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) return null;
    return parsed as string[];
  } catch {
    return null;
  }
};

// in the component (same storageKey variable as today):
const [storedIds, setStoredIds] = usePersistedState<string[]>(storageKey, [], decodeIdArray);
```

Keep the existing column-subset filtering exactly as it is today, just fed from `storedIds` instead of the parsed local; the write path calls `setStoredIds(next)` instead of `localStorage.setItem`.

**2.2** Run DataTable unit tests (`npx vitest run __tests__` — filter `DataTable`) — PASS.
**2.3** E2E regression (scenario С5 guard): `npx playwright test e2e/schedule-column-visibility.spec.ts e2e/dayview-column-reorder.spec.ts` — PASS.
**2.4** Commit: `refactor(#141): DataTable column storage via usePersistedState (spec §4)`.

---

## Task 3: GridSettingsContext
### Classification: small
### Required Docs
- Spec §3 (settings destination), §4 (write-side clamping stays in domain)
- `frontend/admin/lib/utils.ts` — `CELL_HEIGHT_OPTIONS`, `GRID_FREQUENCY_OPTIONS`, `GRID_FREQUENCY_DEFAULT`

### Task Description
**3.1** CREATE `frontend/admin/contexts/schedule/GridSettingsContext.tsx` (constants/keys copied verbatim from `contexts/ScheduleContext.tsx:28-41`):

```tsx
'use client';

import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { CELL_HEIGHT_OPTIONS, GRID_FREQUENCY_DEFAULT, GRID_FREQUENCY_OPTIONS } from '@/lib/utils';

// Cell height (px per half-hour slot)
const CELL_HEIGHT_DEFAULT = 50;
const CELL_HEIGHT_STORAGE_KEY = 'memo-cell-height';
const VALID_CELL_HEIGHTS = new Set(CELL_HEIGHT_OPTIONS.map((o) => o.value)) as Set<number>;
// Grid frequency (minutes per slot)
const GRID_FREQUENCY_STORAGE_KEY = 'memo-grid-frequency';
const VALID_GRID_FREQUENCIES = new Set(GRID_FREQUENCY_OPTIONS.map((o) => o.value)) as Set<number>;
// Working hours (default grid range)
const WORKING_HOURS_START_KEY = 'memo-working-hours-start';
const WORKING_HOURS_END_KEY = 'memo-working-hours-end';
const WORKING_HOURS_START_DEFAULT = 9;
const WORKING_HOURS_END_DEFAULT = 21;

function decodeFrom(valid: Set<number>, fallback: number) {
  return (raw: string): number | null => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    const rounded = Math.round(parsed);
    return valid.has(rounded) ? rounded : null;
  };
}
const decodeCellHeight = decodeFrom(VALID_CELL_HEIGHTS, CELL_HEIGHT_DEFAULT);
const decodeGridFrequency = decodeFrom(VALID_GRID_FREQUENCIES, GRID_FREQUENCY_DEFAULT);
function decodeHour(raw: string): number | null {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded >= 0 && rounded <= 23 ? rounded : null;
}

export interface GridSettingsContextType {
  cellHeight: number;
  setCellHeight: (height: number) => void;
  gridFrequency: number;
  setGridFrequency: (freq: number) => void;
  workingHoursStart: number;
  setWorkingHoursStart: (h: number) => void;
  workingHoursEnd: number;
  setWorkingHoursEnd: (h: number) => void;
}

const GridSettingsContext = createContext<GridSettingsContextType | null>(null);

export function GridSettingsProvider({ children }: { children: React.ReactNode }) {
  const [cellHeight, setCellHeightPersisted] = usePersistedState<number>(
    CELL_HEIGHT_STORAGE_KEY, CELL_HEIGHT_DEFAULT, decodeCellHeight,
  );
  const [gridFrequency, setGridFrequencyPersisted] = usePersistedState<number>(
    GRID_FREQUENCY_STORAGE_KEY, GRID_FREQUENCY_DEFAULT, decodeGridFrequency,
  );
  const [workingHoursStart, setStartPersisted] = usePersistedState<number>(
    WORKING_HOURS_START_KEY, WORKING_HOURS_START_DEFAULT, decodeHour,
  );
  const [workingHoursEnd, setEndPersisted] = usePersistedState<number>(
    WORKING_HOURS_END_KEY, WORKING_HOURS_END_DEFAULT, decodeHour,
  );

  // Write-side clamping preserved (GH #141 spec §4) — domain semantics stay here:
  const setCellHeight = useCallback((h: number) => {
    const rounded = Math.round(h);
    setCellHeightPersisted(VALID_CELL_HEIGHTS.has(rounded) ? rounded : CELL_HEIGHT_DEFAULT);
  }, [setCellHeightPersisted]);
  const setGridFrequency = useCallback((f: number) => {
    const rounded = Math.round(f);
    setGridFrequencyPersisted(VALID_GRID_FREQUENCIES.has(rounded) ? rounded : GRID_FREQUENCY_DEFAULT);
  }, [setGridFrequencyPersisted]);
  const setWorkingHoursStart = useCallback((h: number) => {
    setStartPersisted(Math.max(0, Math.min(23, Math.round(h))));
  }, [setStartPersisted]);
  const setWorkingHoursEnd = useCallback((h: number) => {
    setEndPersisted(Math.max(0, Math.min(23, Math.round(h))));
  }, [setEndPersisted]);

  const value = useMemo(
    () => ({ cellHeight, setCellHeight, gridFrequency, setGridFrequency, workingHoursStart, setWorkingHoursStart, workingHoursEnd, setWorkingHoursEnd }),
    [cellHeight, setCellHeight, gridFrequency, setGridFrequency, workingHoursStart, setWorkingHoursStart, workingHoursEnd, setWorkingHoursEnd],
  );
  return <GridSettingsContext.Provider value={value}>{children}</GridSettingsContext.Provider>;
}

export function useGridSettings(): GridSettingsContextType {
  const ctx = useContext(GridSettingsContext);
  if (!ctx) throw new Error('useGridSettings must be used within GridSettingsProvider');
  return ctx;
}
```

**3.2** CREATE `frontend/admin/__tests__/schedule/GridSettingsContext.test.tsx` (create the `__tests__/schedule/` directory if absent): (a) invalid stored value → default (e.g. `localStorage.setItem('memo-cell-height', '9999')` → 50); (b) valid stored → value; (c) `setCellHeight(37.6)` → 38 persisted as `"38"`; `setWorkingHoursStart(30)` → 23; (d) provider throw-guard. Pattern: mirror the render/act style of `__tests__/usePersistedState.test.tsx`.
**3.3** `npx vitest run __tests__/schedule/GridSettingsContext.test.tsx` — PASS. `npx tsc --noEmit`.
**3.4** Commit: `refactor(#141): GridSettingsContext on usePersistedState (spec §3-4)`.

---

## Task 4: ScheduleViewContext
### Classification: standard
### Required Docs
- Spec §3 (view destination + verbatim-listener rule §2.8)
- Current `contexts/ScheduleContext.tsx` — the ONLY source being moved; copy blocks verbatim (line refs in steps)

### Task Description
**4.1** CREATE `frontend/admin/contexts/schedule/ScheduleViewContext.tsx`. Contents (all moved verbatim unless noted):
- type exports `ViewModeType`, `ColumnModeType` (from `:25-26`);
- state: `stamp` (`:159-164`), `filterMasterIds`/`filterLocationIds` (`:166-167` — the `filtersInitialized` flag moves to Task 5's data provider), `viewMode`, `selectedDay`, `columnMode` (`:169-171`);
- `currentWeek` derivation + `setCurrentWeek` from `useNavigation()` (`:152-158`);
- the FOUR `__memo-*` listener effects (`:222-276`) and TWO dispatch effects (`:279-285`) — **verbatim, untouched** (#138 removes them later);
- `prevPeriod`/`nextPeriod` (`:445-475`).

```tsx
'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import type { StampState } from '@memo/domain';
import { getMonday, toISODate } from '@/lib/datetime';
import { useNavigation } from '@/contexts/NavigationContext';

export type ViewModeType = 'week' | 'day';
export type ColumnModeType = 'masters' | 'locations';

export interface ScheduleViewContextType {
  viewMode: ViewModeType;
  setViewMode: (mode: ViewModeType) => void;
  selectedDay: Date;
  setSelectedDay: (date: Date) => void;
  columnMode: ColumnModeType;
  setColumnMode: (mode: ColumnModeType) => void;
  filterMasterIds: string[];
  filterLocationIds: string[];
  setFilterMasterIds: (ids: string[]) => void;
  setFilterLocationIds: (ids: string[]) => void;
  stamp: StampState;
  setStamp: React.Dispatch<React.SetStateAction<StampState>>;
  currentWeek: Date;
  setCurrentWeek: (date: Date) => void;
  prevPeriod: () => void;
  nextPeriod: () => void;
}

const ScheduleViewContext = createContext<ScheduleViewContextType | null>(null);

export function ScheduleViewProvider({ children }: { children: React.ReactNode }) {
  // …state + verbatim blocks from ScheduleContext.tsx (see list above);
  // context value memoized; the four listeners and two dispatch effects
// are copied BYTE-IDENTICAL from :222-285 — #138 owns their removal.
}

export function useScheduleView(): ScheduleViewContextType {
  const ctx = useContext(ScheduleViewContext);
  if (!ctx) throw new Error('useScheduleView must be used within ScheduleViewProvider');
  return ctx;
}
```

Mount requirement (unchanged from today): the provider must sit INSIDE `NavigationProvider` (both page mount sites already guarantee it).

**4.2** CREATE `frontend/admin/__tests__/schedule/ScheduleViewContext.test.tsx` (directory created in Task 3.2 if absent — verify): move the view-related cases out of `__tests__/ScheduleContext.test.tsx` (period navigation week/day, `__memo-go-to-today`, `__memo-select-day`, `__memo-switch-to-day-view`, `__memo-switch-to-week-view`, dispatch events) — mock `useNavigation` like the old suite does. Do not delete the old file yet (still covers the live old context).
**4.3** `npx vitest run __tests__/schedule/ScheduleViewContext.test.tsx` — PASS. `npx tsc --noEmit`.
**4.4** Commit: `refactor(#141): ScheduleViewContext — view state + verbatim __memo-* listeners (spec §3)`.

---

## Task 5: ScheduleDataContext + ScheduleProvider composition
### Classification: large
### Required Docs
- Spec §3 (data destination, dependency graph, single-derivation-site), §5 (timeout removal + mutationKey), §6 (filter init), §7 С1/С2/С4
- `docs/domain-rules/activities.md` — Frontend §: optimistic updates + race protection (the NEW rule)
- `docs/ARCHITECTURE.md` — Data Access Patterns (hooks, no direct keys in components)

### Task Description
**5.1** CREATE `frontend/admin/contexts/schedule/ScheduleDataContext.tsx`:

```tsx
'use client';

import React, { createContext, useContext, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { Master, Service, Location, ScheduleAdminDTO, ScheduleIndex as DomainScheduleIndex, StampState } from '@memo/domain'; // only what data needs
import { buildSchedule } from '@memo/domain';
import { buildAdminSchedule } from '@/lib/buildSchedule';
import { useMasters, useMastersRaw } from '@/hooks/useMasters';
import { useServices, useServicesRaw } from '@/hooks/useServices';
import { useLocations, useLocationsRaw } from '@/hooks/useLocations';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { getActivities, createActivity as apiCreateActivity, patchActivity as apiPatchActivity, deleteActivity as apiDeleteActivity } from '@memo/api-client';
import type { ActivityResponse, ActivityPatch } from '@memo/api-client';
import { qk } from '@/lib/queryKeys';
import { composeLocalISO, dayIndexToDate, calculateGridTimeRange } from '@/lib/datetime';
import { useNavigation } from '@/contexts/NavigationContext';

// Mutation key shared by create/update/delete — feeds the Topbar indicator
// via useMutationState (spec §5; no isSaving field on any context).
export const SCHEDULE_ACTIVITY_MUTATION_KEY = ['schedule-activity'] as const;

interface ScheduleDataProviderProps {
  children: React.ReactNode;
  // inputs from the composition (spec §3: data context is NOT independent):
  filterMasterIds: string[];
  filterLocationIds: string[];
  setFilterMasterIds: (ids: string[]) => void;
  setFilterLocationIds: (ids: string[]) => void;
  workingHoursStart: number;
  workingHoursEnd: number;
}

export interface ScheduleDataContextType {
  activities: ScheduleAdminDTO[];
  scheduleIndex: DomainScheduleIndex<ScheduleAdminDTO>;
  masters: Master[];
  services: Service[];
  locations: Location[];
  loading: boolean;
  error: Error | null;
  addActivity: (activity: { /* same signature as ScheduleContext.tsx:97-107 */ }) => void;
  updateActivity: (id: string, updates: { /* same signature as :108-119 */ }) => void;
  deleteActivity: (id: string) => void;
  copyLastWeek: () => void; // stub stays — #242
  gridStartMinutes: number;
  gridEndMinutes: number;
}
```

Body — every block copied from the old context with EXACTLY ONE behavioral change each where noted:
- the data provider calls `useNavigation()` ITSELF for `weekStart`/`weekEnd` (old `:287-289`) and inside `addActivity`'s `dayIndex`→date math (old `:394`). Do NOT re-create `currentWeek`/`setCurrentWeek` here — that state lives in the view context (Task 4);
- queries `:292-303` verbatim (same keys, same raw/domain hook pairing);
- **filter init — REPLACED (spec §6, was `:306-313`)**: per-directory, settled-success, initialize-once:

```tsx
const mastersQuery = useMasters();
const locationsQuery = useLocations();
const filterMasterInitRef = useRef(false);
const filterLocationInitRef = useRef(false);
useEffect(() => {
  if (filterMasterInitRef.current || !mastersQuery.isSuccess) return;
  filterMasterInitRef.current = true;
  setFilterMasterIds(mastersQuery.data?.map((m) => m.id) ?? []);
}, [mastersQuery.isSuccess, mastersQuery.data, setFilterMasterIds]);
// identical effect for locationsQuery → setFilterLocationIds
```

- mutations `:320-323` (create) and `:377-380` (delete) verbatim, each + `mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY`;
- **update mutation — `:326-333` REPLACED (spec §5, THE race fix)**: `mutationFn: ({ id, data }: { id: string; data: ActivityPatch }) => apiPatchActivity(id, data)` + `mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY`. `onMutate`/`onError`/`onSettled` (`:337-374`) verbatim. NO Promise.race, NO setTimeout;
- `addActivity`/`updateActivityFn`/`deleteActivityById`/`copyLastWeek` (`:383-443`) verbatim;
- `enrichedData`/`filteredItems`/`gridBounds`/`scheduleIndex` (`:478-509`) verbatim (single derivation site preserved);
- context value memoized on its own deps.

**5.2** CREATE `frontend/admin/contexts/schedule/ScheduleProvider.tsx`:

```tsx
'use client';

import React from 'react';
import { GridSettingsProvider, useGridSettings } from './GridSettingsContext';
import { ScheduleViewProvider, useScheduleView } from './ScheduleViewContext';
import { ScheduleDataProvider } from './ScheduleDataContext';

// Composition (spec §3): reads view + settings values and passes them INTO
// the data provider as inputs. Zoom (cellHeight) changes the SETTINGS value
// only — the data value is untouched (DoD-1). Filter/working-hour changes DO
// re-render data consumers (accepted, identical to today).
function ScheduleDataGate({ children }: { children: React.ReactNode }) {
  const { filterMasterIds, filterLocationIds, setFilterMasterIds, setFilterLocationIds } = useScheduleView();
  const { workingHoursStart, workingHoursEnd } = useGridSettings();
  return (
    <ScheduleDataProvider
      filterMasterIds={filterMasterIds}
      filterLocationIds={filterLocationIds}
      setFilterMasterIds={setFilterMasterIds}
      setFilterLocationIds={setFilterLocationIds}
      workingHoursStart={workingHoursStart}
      workingHoursEnd={workingHoursEnd}
    >
      {children}
    </ScheduleDataProvider>
  );
}

export function ScheduleProvider({ children }: { children: React.ReactNode }) {
  return (
    <GridSettingsProvider>
      <ScheduleViewProvider>
        <ScheduleDataGate>{children}</ScheduleDataGate>
      </ScheduleViewProvider>
    </GridSettingsProvider>
  );
}
```

Nothing mounts it yet (pages come in Task 11) — dead code, build stays green.

**5.3** CREATE `frontend/admin/__tests__/schedule/ScheduleDataContext.test.tsx` — move data/mutation cases from the old suite; NEW cases (RED first where feasible, mirroring the old suite's QueryClient/mock setup):
- **no-timeout (С2, spec §5):** deferred `apiPatchActivity` + `vi.useFakeTimers()`, advance 6000ms → optimistic state still applied (old code rolled back at 5000);
- **rollback on real error:** reject the PATCH → snapshot restored (same as old behavior);
- **filter init С4:** masters query success + locations query success with EMPTY data → `setFilterMasterIds` called (with `[]` when empty); masters success while locations still loading → master filters initialized anyway (old code waited for both non-empty);
- **zoom isolation С1 (render counter):** probe component consuming ONLY `useScheduleData` inside `ScheduleProvider` (queries mocked); a control component calls `setCellHeight` via `useGridSettings`; assert probe render count unchanged after the zoom click, and changed after a data update (sanity);
- **empty activities:** `gridStartMinutes`/`gridEndMinutes` = 540/1260 with default working hours.

**5.4** `npx vitest run __tests__/schedule/` — PASS. `npx tsc --noEmit`. `grep -n "Promise.race" frontend/admin/contexts/schedule/` → empty.
**5.5** Commit: `refactor(#141): ScheduleDataContext + provider composition — timeout race removed, per-directory filter init (spec §3,5,6)`.

---

## Task 6: `useUnsavedChangesGuard`
### Classification: trivial
### Required Docs
- Spec §5 (guard — attach-only-while-dirty, native dialog, no in-app interception)
- MDN `beforeunload` — bfcache eviction by permanent listeners (why attach-on-dirty)

### Task Description
**6.1** RED — CREATE `frontend/admin/__tests__/useUnsavedChangesGuard.test.tsx`: render probe with `useUnsavedChangesGuard(false)` then rerender with `true` → `window` has a `beforeunload` listener (spy on `addEventListener`); rerender `false` → removed; while dirty, dispatch `beforeunload` event → `preventDefault` called (cancelable event).

**6.2** GREEN — CREATE `frontend/admin/hooks/useUnsavedChangesGuard.ts`:

```ts
'use client';

import { useEffect } from 'react';

// Native reload/close guard while dirty (GH #141 spec §5). Attached ONLY
// while dirty: a permanently attached beforeunload listener evicts the page
// from bfcache (MDN). In-app navigation is deliberately NOT intercepted —
// the request keeps flying and data converges via the global queryClient.
export function useUnsavedChangesGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);
}
```

**6.3** Tests PASS, `npx tsc --noEmit`.
**6.4** Commit: `refactor(#141): useUnsavedChangesGuard — beforeunload while dirty (spec §5)`.

---

## Task 7: test helpers — three new mocks
### Classification: small
### Required Docs
- Spec §3 (field→destination table — the split key)
- `__tests__/helpers/mockContexts.ts`, `__tests__/helpers/renderWithProviders.tsx` (current)

### Task Description
**7.1** MODIFY `frontend/admin/__tests__/helpers/mockContexts.ts` — ADD (keep `createMockScheduleContext` untouched until Task 12):

```ts
import type { ScheduleDataContextType } from '@/contexts/schedule/ScheduleDataContext';
import type { ScheduleViewContextType } from '@/contexts/schedule/ScheduleViewContext';
import type { GridSettingsContextType } from '@/contexts/schedule/GridSettingsContext';

// ─── Schedule split contexts (GH #141) ────────────────────────────────────

export function createMockScheduleData(overrides?: Partial<ScheduleDataContextType>): ScheduleDataContextType {
  return {
    masters: mockMasters,
    services: mockServices,
    locations: mockLocations,
    activities: [],
    scheduleIndex: {
      byId: new Map(),
      byDate: new Map(),
      byMasterId: new Map(),
      byLocation: { all: { byDate: new Map(), byServiceId: new Map() } },
    },
    loading: false,
    error: null,
    addActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: vi.fn(),
    copyLastWeek: vi.fn(),
    gridStartMinutes: 540,
    gridEndMinutes: 1260,
    ...overrides,
  };
}

export function createMockScheduleView(overrides?: Partial<ScheduleViewContextType>): ScheduleViewContextType {
  return {
    viewMode: 'week',
    setViewMode: vi.fn(),
    selectedDay: new Date(),
    setSelectedDay: vi.fn(),
    columnMode: 'masters',
    setColumnMode: vi.fn(),
    filterMasterIds: [],
    filterLocationIds: [],
    setFilterMasterIds: vi.fn(),
    setFilterLocationIds: vi.fn(),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setStamp: vi.fn(),
    currentWeek: new Date('2026-06-01'),
    setCurrentWeek: vi.fn(),
    prevPeriod: vi.fn(),
    nextPeriod: vi.fn(),
    ...overrides,
  };
}

export function createMockGridSettings(overrides?: Partial<GridSettingsContextType>): GridSettingsContextType {
  return {
    cellHeight: 50,
    setCellHeight: vi.fn(),
    gridFrequency: 30,
    setGridFrequency: vi.fn(),
    workingHoursStart: 9,
    setWorkingHoursStart: vi.fn(),
    workingHoursEnd: 21,
    setWorkingHoursEnd: vi.fn(),
    ...overrides,
  };
}
```

**7.2** MODIFY `__tests__/helpers/renderWithProviders.tsx` — ADD three mock registrations (old `@/contexts/ScheduleContext` mock stays) and extend the react-query mock with `useMutationState`:

```ts
vi.mock('@/contexts/schedule/ScheduleDataContext', () => ({
  useScheduleData: vi.fn(() => createMockScheduleData()),
}));
vi.mock('@/contexts/schedule/ScheduleViewContext', () => ({
  useScheduleView: vi.fn(() => createMockScheduleView()),
}));
vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(() => createMockGridSettings()),
}));
// inside the existing '@tanstack/react-query' mock add:
//   useMutationState: vi.fn(() => []),   // Topbar indicator (Task 8)
```

plus re-export the three hooks alongside `useSchedule`.

**7.3** `npx vitest run __tests__/` — full unit suite PASS (nothing consumes the new mocks yet).
**7.4** Commit: `test(#141): mock factories + provider mocks for the three schedule contexts`.

---

## Task 8: Topbar — migrate + saving indicator + guard
### Classification: standard
### Required Docs
- Spec §3 (Topbar reads data+view+settings), §5 (indicator via useMutationState, guard)
- `docs/design-system.md` — chip/badge styling for the indicator
- Skill: test-driven-development

### Task Description
**8.1** MODIFY `frontend/admin/app/components/layout/Topbar.tsx`: replace the single `useSchedule()` destructure (`:21-45`) with three hooks — `useScheduleData()` → `masters`, `locations`; `useScheduleView()` → `filterMasterIds`, `filterLocationIds`, `setFilterMasterIds`, `setFilterLocationIds`, `viewMode`, `setViewMode`, `selectedDay`, `setSelectedDay`, `currentWeek`, `columnMode`, `setColumnMode`, `prevPeriod`, `nextPeriod`; `useGridSettings()` → `cellHeight`, `setCellHeight`, `gridFrequency`, `setGridFrequency`, `workingHoursStart`, `setWorkingHoursStart`, `workingHoursEnd`, `setWorkingHoursEnd`. Add:

```tsx
import { useMutationState } from '@tanstack/react-query';
import { SCHEDULE_ACTIVITY_MUTATION_KEY } from '@/contexts/schedule/ScheduleDataContext';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';

// «сохраняем…» while any schedule mutation is in flight (spec §5).
const isSaving = useMutationState({
  filters: { mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY },
  select: (s: { isPending: boolean }) => s.isPending,
}).some(Boolean);
useUnsavedChangesGuard(isSaving);
```

Render next to the zoom control (match adjacent Topbar control styling per design-system.md):

```tsx
{isSaving && (
  <span className="topbar-saving-chip" role="status" aria-live="polite">Сохраняем…</span>
)}
```

(The exact className follows the design-system chip pattern; the `role="status"` + `aria-live` are required for the test.)

**8.2** UPDATE tests `__tests__/Topbar.test.tsx`, `__tests__/CellHeight.Topbar.test.tsx`, `__tests__/CellHeight.test.tsx`: mock modules switch from `@/contexts/ScheduleContext` to the three new modules (helpers from Task 7). ADD indicator tests: `useMutationState` mocked `[true]` → chip rendered with `role="status"`; `[]` → absent. Guard test: rerender Topbar with `useMutationState → [true]` → beforeunload listener added.
**8.3** `npx vitest run __tests__/Topbar.test.tsx __tests__/CellHeight.Topbar.test.tsx __tests__/CellHeight.test.tsx` — PASS. `npx tsc --noEmit`.
**8.4** Commit: `refactor(#141): Topbar on three hooks + saving indicator + beforeunload guard (spec §5)`.

---

## Task 9: WeekView + DayView (+ their satellites)
### Classification: standard
### Required Docs
- Spec §3 migration map; §7 С1 (views legitimately re-render — no change to their logic)

### Task Description
**9.1** MODIFY `frontend/admin/app/components/schedule/WeekView.tsx` and `DayView.tsx`: switch each `useSchedule()` destructure to `useScheduleData` + `useScheduleView` + `useGridSettings` per the actual fields they read (verify per file while editing — the map in spec §3 is authoritative: both are data+view+settings). NO logic changes; `__memo-*` test listeners inside these files stay verbatim (#138).
**9.2** UPDATE tests: `__tests__/WeekView.test.tsx`, `DayView.test.tsx`, `DayColumn.test.tsx`, `OverlapPopover.test.tsx`, `optimisticUpdate.test.tsx`, `timezone-dnd-bug.test.tsx` — switch module mocks to the three new modules; split overrides per factory (`createMockScheduleData`, `createMockScheduleView`, `createMockGridSettings`).
**9.3** `npx vitest run __tests__/WeekView.test.tsx __tests__/DayView.test.tsx __tests__/DayColumn.test.tsx __tests__/OverlapPopover.test.tsx __tests__/optimisticUpdate.test.tsx __tests__/timezone-dnd-bug.test.tsx` — PASS. `npx tsc --noEmit`.
**9.4** Commit: `refactor(#141): WeekView/DayView on the three schedule hooks`.

---

## Task 10: Toolbar + StampPanel + ActivityCard + modal tabs
### Classification: standard
### Required Docs
- Spec §3 migration map (field-per-component list)

### Task Description
**10.1** MODIFY (mechanical destructure swaps, no logic changes):
- `app/components/layout/Toolbar.tsx` — `useScheduleData()` for `copyLastWeek` only (stub stays, #242);
- `app/components/stamp/StampPanel.tsx` — `useScheduleView()` for stamp; `useScheduleData()` for masters/services/locations;
- `app/components/schedule/ActivityCard.tsx` — `useScheduleData()` + `useGridSettings()` for `cellHeight`;
- `app/components/modal/ActivityDetailsModal/ActivityDetailsModal.tsx` — `useScheduleData()`;
- `app/components/modal/ActivityDetailsModal/SettingsTab.tsx` — `useScheduleData()` + `useGridSettings()` for `gridFrequency`.

**10.2** UPDATE tests: `__tests__/Toolbar.test.tsx`, `StampPanel.test.tsx`, `ActivityCard.test.tsx`, `ActivityDetailsModal.test.tsx` — switch mocks to the three new modules.
**10.3** `npx vitest run __tests__/Toolbar.test.tsx __tests__/StampPanel.test.tsx __tests__/ActivityCard.test.tsx __tests__/ActivityDetailsModal.test.tsx` — PASS. `npx tsc --noEmit`.
**10.4** Commit: `refactor(#141): toolbar/stamp/activity-card/modal tabs on the three schedule hooks`.

---

## Task 11: pages + Menubar + ClientRecordTab
### Classification: standard
### Required Docs
- Spec §3 (both mount sites; Menubar type import; ClientRecordTab = settings only)

### Task Description
**11.1** MODIFY:
- `app/(main)/schedule/page.tsx` — import `ScheduleProvider` from `@/contexts/schedule/ScheduleProvider` (drop old); inner `ScheduleView` component switches to `useScheduleView()` for `viewMode`;
- `app/(main)/clients/page.tsx` — same provider swap (`:135`);
- `app/components/layout/Menubar.tsx` — `import type { ViewModeType }` from `@/contexts/schedule/ScheduleViewContext` (only the type moves; listener logic untouched);
- `app/(main)/clients/components/ClientRecordTab.tsx` — `useGridSettings()` for `gridFrequency` (only).

**11.2** UPDATE tests: `__tests__/page.test.tsx`, `scheduleIntegration.test.tsx`, `ClientsPage.test.tsx`, `ClientsIntegration.test.tsx`, `ClientTab.integration.test.tsx`, `ClientRecordTab.interactions.test.tsx`, `ClientRecordTab.api.test.tsx`, `ClientRecordTab.layout.test.tsx`, `Menubar.test.tsx` — provider import paths + three-module mocks.
**11.3** `npx vitest run` (full unit suite) — PASS. `npx tsc --noEmit`. `npm run lint`.
**11.4** Commit: `refactor(#141): both pages + Menubar + ClientRecordTab off the old ScheduleContext`.

---

## Task 12: delete old context + gates
### Classification: standard
### Required Docs
- Spec §9 (DoD — grep gates), §10 (test inventory)

### Task Description
**12.1** After confirming every view-related and data-related case was moved (Tasks 4-5), DELETE `frontend/admin/contexts/ScheduleContext.tsx` and `__tests__/ScheduleContext.test.tsx`; remove `createMockScheduleContext` + the old `@/contexts/ScheduleContext` mock registration from both helpers.
**12.2** Gates (all must hold):
- [ ] `grep -rn "useSchedule\b" frontend/admin/` → empty
- [ ] `grep -rn "localStorage" frontend/admin/contexts frontend/admin/hooks frontend/admin/app` → ONLY `hooks/usePersistedState.ts` + `contexts/UserSettingsContext.tsx`
- [ ] `grep -n "Promise.race" frontend/admin/contexts/` → empty
- [ ] `docs/domain-rules/activities.md` — Race-protection paragraph still matches the shipped behavior (no timeout, indicator + guard; wording updated with the spec, verify nothing drifted)
- [ ] `npx tsc --noEmit` && `npm run lint` && `npm run test` — green
**12.3** E2E regression set (the `__memo-*`/localStorage-touching suites — events unchanged, must keep passing): `npx playwright test e2e/schedule-column-visibility.spec.ts e2e/dayview-column-reorder.spec.ts e2e/unify-caches.spec.ts e2e/visual-compliance-checks.spec.ts e2e/error-messages.spec.ts`.
**12.4** Commit: `refactor(#141): delete ScheduleContext + old mocks; DoD grep gates green`.

---

## Self-Review

**Spec coverage:** §2.1 split → Tasks 3-5, 8-11; §2.2 hook + DataTable → Tasks 1-3; §2.3 timeout removal → Task 5 (5.1 update-mutation block, test 5.3); §2.4 indicator → Task 8; §2.5 guard (beforeunload-only) → Tasks 6, 8; §2.6 copyLastWeek untouched → Tasks 5/10 (stub carried); §2.7 #243 out of scope → no task touches useRecordMutations; §2.8 #138 listeners verbatim → Task 4 + Task 9 (no listener edits); §3 contract/map → Tasks 3-5 (contexts), 8-11 (map); §4 → Tasks 1-3; §5 → Tasks 5, 6, 8; §6 → Task 5; §7 С1→5.3 test, С2→5.3 test + 8 indicator, С3→6+8 tests, С4→5.3 test, С5→Tasks 1-2 (+e2e regression 2.3); §9 DoD → Task 12.2 gates; §10 → Tasks 4-5 (splits), 7 (helpers), 8-11 (24 files), 12 (deletion).
**Placeholders:** none — every step names files, code, or exact commands.
**Type consistency:** `SCHEDULE_ACTIVITY_MUTATION_KEY` exported from ScheduleDataContext (Task 5), consumed in Topbar (Task 8); hook signatures per spec §3-5.
**Required Docs:** present on all 12 tasks.
**Scenario tests:** С1-С4 are unit-level per spec §10 (panel-approved scoping — named tests in Tasks 5, 6, 8); С5 covered by hook tests (Task 1) + DataTable e2e regression (Task 2.3, RED-GREEN via migration).
