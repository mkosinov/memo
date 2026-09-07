import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ScheduleDataProvider,
  useScheduleData,
} from '../../contexts/schedule/ScheduleDataContext';
import { ScheduleProvider } from '../../contexts/schedule/ScheduleProvider';
import { useGridSettings } from '../../contexts/schedule/GridSettingsContext';
import { useScheduleView } from '../../contexts/schedule/ScheduleViewContext';
import { NavigationProvider } from '../../contexts/NavigationContext';
import { toISODate } from '@/lib/datetime';
import { transformService } from '../../lib/transformers';

// ─── Mock api-client ─────────────────────────────────────────────────────────
vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn(),
  getLocations: vi.fn(),
  getServices: vi.fn(),
  getActivities: vi.fn(),
  getAllMasters: vi.fn(),
  getAllLocations: vi.fn(),
  getAllServices: vi.fn(),
  createActivity: vi.fn(),
  updateActivity: vi.fn(),
  patchActivity: vi.fn(),
  deleteActivity: vi.fn(),
}));

import {
  getMasters,
  getLocations,
  getServices,
  getActivities,
  getAllMasters,
  getAllLocations,
  getAllServices,
  createActivity,
  patchActivity,
  deleteActivity,
} from '@memo/api-client';

// ─── Date helpers (floating-local, GH #142) ─────────────────────────────────

/** Monday (local midnight) of the current week. */
function mondayOfCurrentWeek(): Date {
  const d = new Date();
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Local 'YYYY-MM-DD' date key of the current week's Monday + dayOffset (Mon=0). */
function currentWeekDate(dayOffset: number): string {
  const monday = mondayOfCurrentWeek();
  monday.setDate(monday.getDate() + dayOffset);
  return toISODate(monday);
}

// ─── Fixtures (raw API shapes) ─────────────────────────────────────────────

const masterM1 = {
  id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A',
  position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false,
  sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01',
};
const masterM2 = {
  id: 'm2', first_name: 'Юлия', last_name: 'Большакова', color: '#6B7E9C',
  position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false,
  sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01',
};
const serviceS1 = {
  id: 's1', title: 'Картина маслом', description: '', image_url: '', specialty: '',
  min_age: 12, max_age: 99, duration: 120, record_info: '', tariffs: [], tags: [],
  archived: false, created_at: '', updated_at: '',
};
const locationAlpika = {
  id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null,
  capacity: 10, yandex_map_url: null, review_url: null, record_info: null,
  image_url: null, location_hint: null, archived: false, created_at: '', updated_at: '',
};

/** Build a raw ActivityResponse for the current week at a given day/minutes. */
function activityA1(dayOffset = 0, startMinutes = 600) {
  return {
    id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika',
    start: `${currentWeekDate(dayOffset)}T${pad(startMinutes)}`, duration: 120,
    capacity: 8, is_private: false, comment: null, record_info: null,
    created_at: '', updated_at: '', occupied: 3,
  };
}
function pad(mins: number): string {
  const h = String(Math.floor(mins / 60)).padStart(2, '0');
  const m = String(mins % 60).padStart(2, '0');
  return `${h}:${m}:00`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function wrap<T>(items: T[]) {
  return { items, total: items.length, page: 1, per_page: 100 };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** Seed the three dictionaries so buildAdminSchedule keeps an activity. */
function seedDictionaries(masters = [masterM1], services = [serviceS1], locations = [locationAlpika]) {
  vi.mocked(getAllMasters).mockResolvedValue(masters as never);
  vi.mocked(getAllServices).mockResolvedValue(services as never);
  vi.mocked(getAllLocations).mockResolvedValue(locations as never);
}

// Test component consuming ONLY the data context.
function DataConsumer() {
  const {
    activities,
    masters,
    services,
    locations,
    addActivity,
    updateActivity,
    deleteActivity,
    copyLastWeek,
    loading,
    error,
    gridStartMinutes,
    gridEndMinutes,
  } = useScheduleData();

  return (
    <div>
      <span data-testid="activity-count">{activities.length}</span>
      <span data-testid="activity-occupied">{activities[0]?.occupied ?? ''}</span>
      <span data-testid="master-count">{masters.length}</span>
      <span data-testid="service-count">{services.length}</span>
      <span data-testid="location-count">{locations.length}</span>
      <span data-testid="loading">{loading.toString()}</span>
      <span data-testid="error">{error ? error.message : 'null'}</span>
      <span data-testid="grid-start">{gridStartMinutes}</span>
      <span data-testid="grid-end">{gridEndMinutes}</span>

      <button
        data-testid="add-activity"
        onClick={() =>
          addActivity({
            dayIndex: 2,
            masterId: 'm1',
            serviceId: 's1',
            locationId: 'alpika',
            startMinutes: 630, // 10:30
            durationMinutes: 120,
            capacity: 8,
            isPrivate: false,
          })
        }
      >
        Add
      </button>
      <button
        data-testid="update-activity"
        onClick={() => updateActivity(activities[0]?.id ?? '', { occupied: 5 })}
      >
        Update
      </button>
      <button
        data-testid="update-activity-time"
        onClick={() => updateActivity('a1', { dayIndex: 1, startMinutes: 720, durationMinutes: 150 })}
      />
      <button
        data-testid="update-activity-null-capacity"
        onClick={() => updateActivity('a1', { serviceId: 's5', durationMinutes: 120, capacity: null } as never)}
      />
      <button
        data-testid="update-activity-with-capacity"
        onClick={() => updateActivity('a1', { serviceId: 's5', durationMinutes: 120, capacity: 8 })}
      />
      <button
        data-testid="delete-activity"
        onClick={() => deleteActivity(activities[0]?.id ?? '')}
      >
        Delete
      </button>
      <button data-testid="copy-last-week" onClick={copyLastWeek}>
        Copy
      </button>
    </div>
  );
}

interface DataProviderOpts {
  filterMasterIds?: string[];
  filterLocationIds?: string[];
  setFilterMasterIds?: (ids: string[]) => void;
  setFilterLocationIds?: (ids: string[]) => void;
  workingHoursStart?: number;
  workingHoursEnd?: number;
}

/** Render ScheduleDataProvider directly with explicit inputs (isolates data logic). */
function renderDataProvider(opts: DataProviderOpts = {}) {
  const queryClient = createTestQueryClient();
  const setFilterMasterIds = opts.setFilterMasterIds ?? vi.fn();
  const setFilterLocationIds = opts.setFilterLocationIds ?? vi.fn();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <ScheduleDataProvider
          filterMasterIds={opts.filterMasterIds ?? []}
          filterLocationIds={opts.filterLocationIds ?? []}
          setFilterMasterIds={setFilterMasterIds}
          setFilterLocationIds={setFilterLocationIds}
          workingHoursStart={opts.workingHoursStart ?? 9}
          workingHoursEnd={opts.workingHoursEnd ?? 21}
        >
          <DataConsumer />
        </ScheduleDataProvider>
      </NavigationProvider>
    </QueryClientProvider>,
  );
  return { queryClient, setFilterMasterIds, setFilterLocationIds, ...utils };
}

/** Render the FULL composition (settings → view → data gate). */
function renderWithSchedule(children: React.ReactNode) {
  const queryClient = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <ScheduleProvider>{children}</ScheduleProvider>
      </NavigationProvider>
    </QueryClientProvider>,
  );
  return { queryClient, ...utils };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ScheduleDataProvider (data half of the old ScheduleContext)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllMasters).mockResolvedValue([] as never);
    vi.mocked(getAllLocations).mockResolvedValue([] as never);
    vi.mocked(getAllServices).mockResolvedValue([] as never);
    vi.mocked(getActivities).mockResolvedValue(wrap([]));
    vi.mocked(createActivity).mockResolvedValue({} as never);
    vi.mocked(patchActivity).mockResolvedValue({} as never);
    vi.mocked(deleteActivity).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws when useScheduleData is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenConsumer() {
      useScheduleData();
      return null;
    }
    expect(() => render(<BrokenConsumer />)).toThrow(
      'useScheduleData must be used within ScheduleDataProvider',
    );
    spy.mockRestore();
  });

  it('fetches dictionary lookups via getAllX bare-array methods (#205 T12)', async () => {
    vi.mocked(getAllMasters).mockResolvedValue([masterM1] as never);

    renderDataProvider();

    await waitFor(() => {
      expect(getAllMasters).toHaveBeenCalled();
      expect(getAllServices).toHaveBeenCalled();
      expect(getAllLocations).toHaveBeenCalled();
    });

    // Paginated lookups must NOT be used for the cached reference data
    expect(getMasters).not.toHaveBeenCalled();
    expect(getServices).not.toHaveBeenCalled();
    expect(getLocations).not.toHaveBeenCalled();
  });

  it('provides masters, services, locations from React Query hooks', async () => {
    seedDictionaries([masterM1, masterM2], [serviceS1], [locationAlpika]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      activityA1(0, 600),
      { ...activityA1(1, 840), id: 'a2', master_id: 'm2', location_id: 'alpika' },
    ]));

    renderDataProvider();

    await waitFor(() => {
      expect(screen.getByTestId('master-count').textContent).toBe('2');
    });
    expect(screen.getByTestId('service-count').textContent).toBe('1');
    expect(screen.getByTestId('location-count').textContent).toBe('1');
    expect(screen.getByTestId('activity-count').textContent).toBe('2');
  });

  it('initializes with locations (not studios)', async () => {
    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(screen.getByTestId('activity-count').textContent).toBe('0');
    expect(screen.getByTestId('location-count').textContent).toBe('0');
  });

  it('sets loading to false after data resolves', async () => {
    vi.mocked(getActivities).mockResolvedValue(wrap([]));
    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('sets error when data fetching fails', async () => {
    vi.mocked(getActivities).mockRejectedValue(new Error('Network error'));
    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).not.toBe('null');
    });
  });

  // ─── mutations ──────────────────────────────────────────────────────────────

  it('calls createActivity mutation when addActivity is called', async () => {
    vi.mocked(createActivity).mockResolvedValue({
      id: 'new-id', master_id: 'm1', service_id: 's1', location_id: 'alpika',
      start: `${currentWeekDate(2)}T10:30:00`, duration: 120, capacity: 8,
      is_private: false, comment: null, record_info: null, created_at: '',
      updated_at: '', occupied: 0,
    } as never);

    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    act(() => {
      screen.getByTestId('add-activity').click();
    });

    await waitFor(() => {
      expect(createActivity).toHaveBeenCalled();
    });
    // GH #142: floating-local start string (no zone suffix) + integer minute duration
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        master_id: 'm1',
        service_id: 's1',
        location_id: 'alpika',
        start: `${currentWeekDate(2)}T10:30:00`,
        duration: 120,
        capacity: 8,
        is_private: false,
      }),
    );
  });

  it('maps dayIndex/startMinutes to a floating-local start string on PATCH (GH #142)', async () => {
    seedDictionaries();
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]));
    vi.mocked(patchActivity).mockResolvedValue({
      ...activityA1(1, 720), duration: 150,
    } as never);

    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });

    act(() => {
      screen.getByTestId('update-activity-time').click();
    });

    await waitFor(() => {
      expect(patchActivity).toHaveBeenCalled();
    });
    expect(patchActivity).toHaveBeenCalledWith('a1', expect.objectContaining({
      start: `${currentWeekDate(1)}T12:00:00`,
      duration: 150,
    }));
  });

  it('calls patchActivity mutation when updateActivity is called', async () => {
    seedDictionaries();
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]));
    vi.mocked(patchActivity).mockResolvedValue({
      ...activityA1(0, 600), occupied: 5,
    } as never);

    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });

    act(() => {
      screen.getByTestId('update-activity').click();
    });

    await waitFor(() => {
      expect(patchActivity).toHaveBeenCalled();
    });
    expect(patchActivity).toHaveBeenCalledWith('a1', expect.objectContaining({ occupied: 5 }));
  });

  // ─── BUG-63 regression tests (updateActivity payload shaping) ──────────────

  it('excludes capacity from PATCH payload when capacity is null (BUG-63 regression)', async () => {
    seedDictionaries();
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]));
    vi.mocked(patchActivity).mockResolvedValue(activityA1(0, 600) as never);

    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });

    act(() => {
      screen.getByTestId('update-activity-null-capacity').click();
    });

    await waitFor(() => {
      expect(patchActivity).toHaveBeenCalled();
    });
    const callArgs = (patchActivity as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty('capacity');
  });

  it('includes capacity in PATCH payload when capacity has a defined value (BUG-63 regression)', async () => {
    seedDictionaries();
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]));
    vi.mocked(patchActivity).mockResolvedValue(activityA1(0, 600) as never);

    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });

    act(() => {
      screen.getByTestId('update-activity-with-capacity').click();
    });

    await waitFor(() => {
      expect(patchActivity).toHaveBeenCalled();
    });
    const callArgs = (patchActivity as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toHaveProperty('capacity', 8);
    expect(callArgs[1]).toHaveProperty('service_id');
  });

  it('transformService does not produce maxCapacity field (BUG-63 regression)', () => {
    const mockRaw = {
      id: 's1', title: 'Картина маслом', duration: 120, min_age: 12, max_age: null,
      tariffs: [], tags: [], description: '', image_url: '', specialty: '', record_info: '',
      archived: false, created_at: '', updated_at: '',
    } as never;
    const result = transformService(mockRaw);
    expect(result).not.toHaveProperty('maxCapacity');
  });

  it('calls deleteActivity mutation when deleteActivity is called', async () => {
    seedDictionaries();
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]));

    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });

    act(() => {
      screen.getByTestId('delete-activity').click();
    });

    await waitFor(() => {
      expect(deleteActivity).toHaveBeenCalledWith('a1');
    });
  });

  it('copyLastWeek does not throw', () => {
    renderDataProvider();
    expect(() => {
      act(() => {
        screen.getByTestId('copy-last-week').click();
      });
    }).not.toThrow();
  });

  // ─── grid bounds (GH #142 — single derivation site) ────────────────────────

  it('defaults grid bounds to working hours (9:00–21:00) when no activities', async () => {
    vi.mocked(getActivities).mockResolvedValue(wrap([]));
    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(screen.getByTestId('grid-start').textContent).toBe('540');
    expect(screen.getByTestId('grid-end').textContent).toBe('1260');
  });

  it('extends grid bounds to fit activities outside working hours', async () => {
    seedDictionaries([masterM1], [{ ...serviceS1, duration: 150 }], [locationAlpika]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      activityA1(0, 420), // 07:00
      { ...activityA1(1, 1320), id: 'a2', duration: 120 }, // 22:00 + 120 = 1440
    ]));

    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('2');
    });
    // adaptive start: floor(420/60)*60 - 60 = 360; adaptive end: 1440 clamped
    expect(screen.getByTestId('grid-start').textContent).toBe('360');
    expect(screen.getByTestId('grid-end').textContent).toBe('1440');
  });

  // ─── С4: per-directory filter initialization (spec §6) ─────────────────────

  it('initializes master filters even when the locations dictionary is EMPTY (С4)', async () => {
    const setFilterMasterIds = vi.fn();
    const setFilterLocationIds = vi.fn();
    seedDictionaries([masterM1, masterM2], [serviceS1], []); // locations EMPTY

    renderDataProvider({ setFilterMasterIds, setFilterLocationIds });

    // Old code gated on `masters.length > 0 && locations.length > 0` → never fired.
    // New code: each directory initializes independently on settled success.
    await waitFor(() => {
      expect(setFilterMasterIds).toHaveBeenCalledWith(['m1', 'm2']);
    });
    // Empty locations dictionary → initialized to [] (renders as "show all").
    await waitFor(() => {
      expect(setFilterLocationIds).toHaveBeenCalledWith([]);
    });
  });

  it('initializes master filters while locations are still loading (С4)', async () => {
    const setFilterMasterIds = vi.fn();
    const setFilterLocationIds = vi.fn();
    vi.mocked(getAllMasters).mockResolvedValue([masterM1, masterM2] as never);
    vi.mocked(getAllServices).mockResolvedValue([serviceS1] as never);
    // locations NEVER settle — stay pending
    vi.mocked(getAllLocations).mockReturnValue(new Promise(() => {}) as never);

    renderDataProvider({ setFilterMasterIds, setFilterLocationIds });

    // Masters initialize independently; old code waited for BOTH non-empty.
    await waitFor(() => {
      expect(setFilterMasterIds).toHaveBeenCalledWith(['m1', 'm2']);
    });
    expect(setFilterLocationIds).not.toHaveBeenCalled();
  });

  // ─── С2: no artificial timeout on the update mutation (spec §5) ────────────

  it('keeps the optimistic state past 5s — no artificial timeout rolls it back (С2)', async () => {
    seedDictionaries();
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]));

    // Deferred PATCH — resolved manually, never before the assertions.
    let resolvePatch: (v: unknown) => void = () => {};
    const patchPromise = new Promise((res) => { resolvePatch = res; });
    vi.mocked(patchActivity).mockReturnValue(patchPromise as never);

    // Initial load with real timers, then freeze time for the timeout window.
    const { queryClient } = renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });

    const queryKey = ['activities', weekStartKey(), weekEndKey()];

    vi.useFakeTimers();

    // Trigger the optimistic update.
    act(() => {
      screen.getByTestId('update-activity').click();
    });
    // Flush onMutate (cancelQueries await → setQueryData) under fake timers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(patchActivity).toHaveBeenCalledTimes(1);
    // Optimistic write applied: occupied 3 → 5 in the cache.
    const cacheOptimistic = queryClient.getQueryData<unknown[]>(queryKey);
    expect((cacheOptimistic?.[0] as { occupied: number }).occupied).toBe(5);

    // Advance past the OLD 5s timeout window. Old code: setTimeout(5000) rejects
    // the Promise.race → onError rollback → occupied back to 3. New code: nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });

    const cacheAfter = queryClient.getQueryData<unknown[]>(queryKey);
    expect((cacheAfter?.[0] as { occupied: number }).occupied).toBe(5);

    // Resolve the deferred PATCH — mutation settles normally.
    await act(async () => {
      resolvePatch(activityA1(0, 600));
      await vi.advanceTimersByTimeAsync(0);
    });
  });

  it('rolls the optimistic state back on a REAL patch error', async () => {
    seedDictionaries();
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]));

    // Deferred rejection — the optimistic write is observable BEFORE the error.
    let rejectPatch: (e: Error) => void = () => {};
    const patchPromise = new Promise((_, rej) => { rejectPatch = rej; });
    vi.mocked(patchActivity).mockReturnValue(patchPromise as never);

    const { queryClient } = renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });

    const queryKey = ['activities', weekStartKey(), weekEndKey()];

    act(() => {
      screen.getByTestId('update-activity').click();
    });

    // Optimistic write lands first: occupied 3 → 5.
    await waitFor(() => {
      const cache = queryClient.getQueryData<unknown[]>(queryKey);
      expect((cache?.[0] as { occupied: number }).occupied).toBe(5);
    });

    // Real error → onError restores the snapshot (occupied back to 3).
    await act(async () => {
      rejectPatch(new Error('server rejected'));
    });
    await waitFor(() => {
      const cache = queryClient.getQueryData<unknown[]>(queryKey);
      expect((cache?.[0] as { occupied: number }).occupied).toBe(3);
    });
  });

  // ─── С1: zoom isolation — data-only consumer does NOT re-render (spec §3) ──

  it('does not re-render a data-only consumer when cellHeight changes (С1)', async () => {
    seedDictionaries([masterM1, masterM2], [serviceS1], [locationAlpika]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      activityA1(0, 600),
      { ...activityA1(1, 840), id: 'a2', master_id: 'm2' },
    ]));

    let probeRenders = 0;
    function DataProbe() {
      probeRenders++;
      const { activities } = useScheduleData();
      return <span data-testid="probe">{activities.length}</span>;
    }
    // Reads the VIEW context only — used to detect that the data provider's
    // filter-init effect has settled BEFORE the render-count snapshot (the
    // init itself legitimately re-renders data consumers).
    function FilterProbe() {
      const { filterMasterIds, filterLocationIds } = useScheduleView();
      return (
        <span data-testid="filter-probe">
          {`${filterMasterIds.join(',')}|${filterLocationIds.join(',')}`}
        </span>
      );
    }
    function ZoomControl() {
      const { setCellHeight } = useGridSettings();
      return <button data-testid="zoom" onClick={() => setCellHeight(60)} />;
    }
    function FilterControl() {
      const { setFilterMasterIds } = useScheduleView();
      return <button data-testid="narrow-filters" onClick={() => setFilterMasterIds(['m1'])} />;
    }

    renderWithSchedule(
      <>
        <DataProbe />
        <FilterProbe />
        <ZoomControl />
        <FilterControl />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('2');
    });
    // Filter init must have settled before snapshotting the render count.
    await waitFor(() => {
      expect(screen.getByTestId('filter-probe').textContent).toBe('m1,m2|alpika');
    });
    const before = probeRenders;

    // Zoom changes ONLY the settings value → data value untouched → no re-render.
    act(() => {
      screen.getByTestId('zoom').click();
    });
    expect(probeRenders).toBe(before);

    // Sanity: a data-affecting change (filter narrows the visible items) DOES
    // re-render the data-only probe.
    act(() => {
      screen.getByTestId('narrow-filters').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('probe').textContent).toBe('1');
    });
    expect(probeRenders).toBeGreaterThan(before);
  });
});

// ─── week-range key helpers (NavigationProvider defaults to the current week) ─

function weekStartKey(): string {
  return toISODate(mondayOfCurrentWeek());
}
function weekEndKey(): string {
  const monday = mondayOfCurrentWeek();
  monday.setDate(monday.getDate() + 6);
  return toISODate(monday);
}
