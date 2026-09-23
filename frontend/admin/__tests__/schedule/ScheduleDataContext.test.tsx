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
import {
  ScheduleViewProvider,
  useScheduleView,
} from '../../contexts/schedule/ScheduleViewContext';
import { toISODate, shiftDateKey } from '@/lib/datetime';
import { transformService } from '../../lib/transformers';

// #138 Task 2: the view half of the composition reads the URL (?view=&date=&col=)
// via hooks/useScheduleView. The App Router APIs are mocked with a REACTIVE
// stand-in: push/replace update the params and re-render subscribers, so tests
// navigate through the real UI (prev/nextPeriod) instead of hand-poking state.
vi.mock('next/navigation', async () => await import('../helpers/nextNavigationMock'));
import { __resetNavigation } from '../helpers/nextNavigationMock';

// ─── Mock api-client ─────────────────────────────────────────────────────────
// Partial mock (importOriginal) — the real ApiError class stays because the
// 409-with-dependencies rejection surface is part of the deferred-delete
// contract (#286).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
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
    dryRunDeleteActivity: vi.fn(),
    deleteActivityWithExpected: vi.fn(),
    copyWeek: vi.fn(),
    getUserSettings: vi.fn(),
    patchUserSettings: vi.fn(),
  };
});

// #286: the data provider owns the deferred-delete mechanics — enqueue and
// toast are controlled by tests (same approach as useDeleteRecord.test.ts).
const mockEnqueuePendingAction = vi.fn();
vi.mock('../../contexts/PendingActionsContext', () => ({
  usePendingActions: () => ({ enqueuePendingAction: mockEnqueuePendingAction }),
}));
const mockShowToast = vi.fn();
vi.mock('../../contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

// GH #267: UserSettingsProvider gates loading on useAuth().status — mock the
// auth hook to report `authenticated` so the settings provider settles.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ status: 'authenticated', user: { id: 'u1' }, permissions: [], master: null, login: vi.fn(), logout: vi.fn(), can: vi.fn(() => false), refresh: vi.fn() })),
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
  dryRunDeleteActivity,
  deleteActivityWithExpected,
  copyWeek,
  getUserSettings,
  patchUserSettings,
  ApiError,
} from '@memo/api-client';
import type { DependencyNode } from '@memo/api-client';
import type { PendingAction } from '../../contexts/PendingActionsContext';
import { qk } from '@/lib/queryKeys';
import { UserSettingsProvider, useUserSettings } from '../../contexts/UserSettingsContext';

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
  id: 'alpika', title: 'Альпика', address: 'Альпика, 1 этаж', description: null,
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

/** #286: 409 dry-run dependency tree for an activity with one record
 *  (→ its visit + payment) plus an auto node without items. */
const ACTIVITY_DEPS: DependencyNode[] = [
  {
    entity: 'records', auto: false, relation: 'records', count: 1, allowed_actions: [],
    items: [{ id: 'r1', label: 'Картина маслом, 2026-09-14, Аноним' }],
  },
  {
    entity: 'visits', auto: false, relation: 'records', count: 1, allowed_actions: [],
    items: [{ id: 'v1', label: 'Картина маслом, 1000' }],
  },
  {
    entity: 'payments', auto: false, relation: 'records', count: 1, allowed_actions: [],
    items: [{ id: 'p1', label: '1000, карта' }],
  },
  // auto (photos/activity_tags) — no items, excluded from `expected`
  { entity: 'activity_tags', auto: true, relation: 'activity_tags', count: 2, allowed_actions: [] },
];

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
/** Week navigation driver: steps the viewed week forward via the URL hook (#286 → #138). */
function NextWeekNav() {
  const { nextPeriod } = useScheduleView();
  return (
    <button
      data-testid="next-week"
      onClick={() => nextPeriod()}
    />
  );
}

function DataConsumer() {
  const {
    activities,
    masters,
    services,
    locations,
    // GH #267: FULL schedule dictionaries (status=all, archived included).
    scheduleMasters: fullScheduleMasters,
    scheduleLocations: fullScheduleLocations,
    addActivity,
    updateActivity,
    deleteActivityDeferred,
    deleteActivityConfirmed,
    // #286 Task 5: pending-confirm dialog state.
    pendingActivityConfirm,
    setPendingActivityConfirm,
    copyLastWeek,
    loading,
    error,
    gridStartMinutes,
    gridEndMinutes,
  } = useScheduleData();
  const [copyResult, setCopyResult] = React.useState('');
  const [deleteOutcome, setDeleteOutcome] = React.useState('');

  return (
    <div>
      <span data-testid="activity-count">{activities.length}</span>
      <span data-testid="activity-occupied">{activities[0]?.occupied ?? ''}</span>
      <span data-testid="master-count">{masters.length}</span>
      <span data-testid="service-count">{services.length}</span>
      <span data-testid="location-count">{locations.length}</span>
      <span data-testid="schedule-master-count">{fullScheduleMasters.length}</span>
      <span data-testid="schedule-location-count">{fullScheduleLocations.length}</span>
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
        onClick={() => {
          deleteActivityDeferred(activities[0]?.id ?? '')
            .then((o) => setDeleteOutcome(JSON.stringify(o)))
            .catch((err: Error) => setDeleteOutcome(`error:${err.message}`));
        }}
      >
        Delete
      </button>
      <button
        data-testid="confirm-delete-activity"
        onClick={() => {
          void deleteActivityConfirmed('a1', ACTIVITY_DEPS);
        }}
      >
        ConfirmDelete
      </button>
      <span data-testid="delete-outcome">{deleteOutcome}</span>
      {/* #286 Task 5: pending-confirm dialog state (hold + clear contract). */}
      <span data-testid="pending-confirm">
        {pendingActivityConfirm
          ? JSON.stringify({
              activityId: pendingActivityConfirm.activityId,
              refetched: pendingActivityConfirm.refetched,
              deps: pendingActivityConfirm.dependencies.length,
            })
          : 'null'}
      </span>
      <button
        data-testid="set-pending-confirm"
        onClick={() =>
          setPendingActivityConfirm({ activityId: 'a1', dependencies: ACTIVITY_DEPS, refetched: true })
        }
      >
        SetPending
      </button>
      <button data-testid="clear-pending-confirm" onClick={() => setPendingActivityConfirm(null)}>
        ClearPending
      </button>
      {/* #286: week navigation driver — selectDateRange moves dateFrom/dateTo. */}
      <NextWeekNav />
      <button
        data-testid="copy-last-week"
        onClick={() => {
          // New contract (#242): copyLastWeek(weekStart, locations) → Promise<CopyWeekResult>.
          copyLastWeek('2026-09-14', ['alpika']).then((r) =>
            setCopyResult(`copied:${r.copied};dups:${r.skipped_duplicates}`),
          );
        }}
      >
        Copy
      </button>
      <span data-testid="copy-result">{copyResult}</span>
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
  /** GH #267: initial archived-visibility settings for the real UserSettingsProvider. */
  showArchivedMasters?: boolean;
  showArchivedLocations?: boolean;
}

/**
 * Renders children under the REAL UserSettingsProvider, pre-seeded via mocked
 * api-client remote settings (getUserSettings resolves the given toggles).
 * updateSettings from tests flips state → the data gate re-memoizes.
 */
function SettingsGate({
  showArchivedMasters = true,
  showArchivedLocations = false,
  settingsRef,
  children,
}: {
  showArchivedMasters?: boolean;
  showArchivedLocations?: boolean;
  settingsRef?: { current: { showArchivedMasters: boolean; showArchivedLocations: boolean } };
  children: React.ReactNode;
}) {
  const { settings, updateSettings } = useUserSettings();
  if (settingsRef) settingsRef.current = settings;
  return (
    <>
      <button
        data-testid="toggle-archived-masters"
        onClick={() => updateSettings({ showArchivedMasters: !settings.showArchivedMasters })}
      />
      <button
        data-testid="toggle-archived-locations"
        onClick={() => updateSettings({ showArchivedLocations: !settings.showArchivedLocations })}
      />
      {children}
    </>
  );
}

/** Render ScheduleDataProvider directly with explicit inputs (isolates data logic). */
function renderDataProvider(opts: DataProviderOpts = {}) {
  const queryClient = createTestQueryClient();
  const setFilterMasterIds = opts.setFilterMasterIds ?? vi.fn();
  const setFilterLocationIds = opts.setFilterLocationIds ?? vi.fn();
  // Settings fixture: remote GET resolves the toggles; PUT/PATCH no-op.
  vi.mocked(getUserSettings).mockResolvedValue({
    user_id: 'u1',
    theme: 'light',
    language: 'ru',
    column_order_staff: [],
    column_order_locations: [],
    show_archived_masters: opts.showArchivedMasters ?? true,
    show_archived_locations: opts.showArchivedLocations ?? false,
  } as never);
  vi.mocked(patchUserSettings).mockResolvedValue({} as never);

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ScheduleViewProvider>
        <UserSettingsProvider>
          <ScheduleDataProvider
            filterMasterIds={opts.filterMasterIds ?? []}
            filterLocationIds={opts.filterLocationIds ?? []}
            setFilterMasterIds={setFilterMasterIds}
            setFilterLocationIds={setFilterLocationIds}
            workingHoursStart={opts.workingHoursStart ?? 9}
            workingHoursEnd={opts.workingHoursEnd ?? 21}
          >
            <SettingsGate showArchivedMasters={opts.showArchivedMasters} showArchivedLocations={opts.showArchivedLocations}>
              <DataConsumer />
            </SettingsGate>
          </ScheduleDataProvider>
        </UserSettingsProvider>
      </ScheduleViewProvider>
    </QueryClientProvider>,
  );
  return { queryClient, setFilterMasterIds, setFilterLocationIds, ...utils };
}

/** Render the FULL composition (settings → view → data gate). */
function renderWithSchedule(children: React.ReactNode) {
  const queryClient = createTestQueryClient();
  // Settings API mocks — the real app mounts UserSettingsProvider in
  // app/providers.tsx ABOVE ScheduleProvider; mirror that composition here.
  vi.mocked(getUserSettings).mockResolvedValue({
    user_id: 'u1',
    theme: 'light',
    language: 'ru',
    column_order_staff: [],
    column_order_locations: [],
    show_archived_masters: true,
    show_archived_locations: false,
  } as never);
  vi.mocked(patchUserSettings).mockResolvedValue({} as never);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <UserSettingsProvider>
        <ScheduleProvider>{children}</ScheduleProvider>
      </UserSettingsProvider>
    </QueryClientProvider>,
  );
  return { queryClient, ...utils };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ScheduleDataProvider (data half of the old ScheduleContext)', () => {
  beforeEach(() => {
    __resetNavigation();
    vi.clearAllMocks();
    vi.mocked(getAllMasters).mockResolvedValue([] as never);
    vi.mocked(getAllLocations).mockResolvedValue([] as never);
    vi.mocked(getAllServices).mockResolvedValue([] as never);
    vi.mocked(getActivities).mockResolvedValue(wrap([]));
    vi.mocked(createActivity).mockResolvedValue({} as never);
    vi.mocked(patchActivity).mockResolvedValue({} as never);
    vi.mocked(dryRunDeleteActivity).mockResolvedValue(undefined);
    vi.mocked(deleteActivityWithExpected).mockResolvedValue(undefined);
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

  // #138 Task 2: the fetch range derives from the URL view state, not
  // NavigationContext — ?date=2026-09-16 (a Wednesday) ⇒ monday..sunday
  // 2026-09-14..2026-09-20, SAME `YYYY-MM-DD` format (cache keys + SSE
  // invalidations #239 stay identical).
  it('fetch range = monday..sunday of the URL ?date week (#138)', async () => {
    __resetNavigation('?view=week&date=2026-09-16');
    renderDataProvider();

    await waitFor(() => {
      expect(getActivities).toHaveBeenCalled();
    });
    expect(getActivities).toHaveBeenCalledWith({
      date_from: '2026-09-14',
      date_to: '2026-09-20',
      per_page: 100,
    });
  });

  it('stepping the viewed week via the URL moves the fetch range (#138)', async () => {
    renderDataProvider();
    await waitFor(() => {
      expect(getActivities).toHaveBeenCalled();
    });
    vi.mocked(getActivities).mockClear();

    // Real UI path: nextPeriod pushes ?date=<next monday> → params update →
    // the provider refetches the NEW week's range.
    act(() => {
      screen.getByTestId('next-week').click();
    });

    await waitFor(() => {
      expect(getActivities).toHaveBeenCalled();
    });
    const calls = vi.mocked(getActivities).mock.calls as Array<[Record<string, unknown>]>;
    expect(calls.every(([p]) => p.date_from === shiftDateKey(weekStartKey(), 7))).toBe(true);
    expect(calls.every(([p]) => p.date_to === shiftDateKey(weekEndKey(), 7))).toBe(true);
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

  // ─── Deferred activity delete (#286) ──────────────────────────────────────
  // Covered below in the dedicated top-level describes.

  it('copyLastWeek calls copyWeek api and invalidates the activities family (#242)', async () => {
    seedDictionaries();
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]));
    vi.mocked(copyWeek).mockResolvedValue({
      copied: 8, skipped_duplicates: 2, skipped_filtered: 1, skipped_no_master: 0,
    });

    renderDataProvider();
    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });
    expect(getActivities).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByTestId('copy-last-week').click();
    });

    // api-client hit with the explicit popup selection
    await waitFor(() => {
      expect(copyWeek).toHaveBeenCalledWith({ week_start: '2026-09-14', locations: ['alpika'] });
    });
    // family invalidation ['activities'] → the week-range query refetches
    await waitFor(() => {
      expect(getActivities).toHaveBeenCalledTimes(2);
    });
    // new Promise<CopyWeekResult> contract — result flows back to the caller
    await waitFor(() => {
      expect(screen.getByTestId('copy-result').textContent).toBe('copied:8;dups:2');
    });
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

  // ─── GH #267: schedule dictionaries — own keys, status=all, active slice ────

  it('requests the schedule dictionaries with status=all (GH #267)', async () => {
    renderDataProvider();
    await waitFor(() => {
      expect(getAllMasters).toHaveBeenCalledWith({ status: 'all' });
    });
    expect(getAllServices).toHaveBeenCalledWith({ status: 'all' });
    expect(getAllLocations).toHaveBeenCalledWith({ status: 'all' });
  });

  it('exposes FULL schedule lists (incl. archived) while domain slices stay active-only (GH #267)', async () => {
    const archivedMaster = { ...masterM1, id: 'm-arch', first_name: 'Архивный', archived: true };
    const archivedLocation = { ...locationAlpika, id: 'loc-arch', title: 'Архивная студия', archived: true };
    seedDictionaries(
      [masterM1, archivedMaster],
      [serviceS1],
      [locationAlpika, archivedLocation],
    );

    renderDataProvider();

    await waitFor(() => {
      expect(screen.getByTestId('schedule-master-count').textContent).toBe('2');
    });
    expect(screen.getByTestId('schedule-location-count').textContent).toBe('2');
    // Domain slices for existing consumers keep ACTIVE-only semantics.
    expect(screen.getByTestId('master-count').textContent).toBe('1');
    expect(screen.getByTestId('location-count').textContent).toBe('1');
    expect(screen.getByTestId('service-count').textContent).toBe('1');
  });

  it('seeds filter init from the ACTIVE slice only — archived rows are not in the options (GH #267)', async () => {
    const setFilterMasterIds = vi.fn();
    const setFilterLocationIds = vi.fn();
    const archivedMaster = { ...masterM1, id: 'm-arch', archived: true };
    const archivedLocation = { ...locationAlpika, id: 'loc-arch', archived: true };
    seedDictionaries([masterM1, archivedMaster], [serviceS1], [locationAlpika, archivedLocation]);

    renderDataProvider({ setFilterMasterIds, setFilterLocationIds });

    await waitFor(() => {
      expect(setFilterMasterIds).toHaveBeenCalledWith(['m1']);
    });
    await waitFor(() => {
      expect(setFilterLocationIds).toHaveBeenCalledWith(['alpika']);
    });
  });

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

  // ─── GH #267: archived-visibility gate on enrichedData.items ────────────────

  const archivedMasterM2 = { ...masterM2, id: 'm-arch', first_name: 'Архивный', archived: true };
  const archivedLocationLoc = { ...locationAlpika, id: 'loc-arch', title: 'Архивная студия', archived: true };
  const archivedServiceS = { ...serviceS1, id: 's-arch', title: 'Архивная услуга', archived: true };

  it('shows a card on an ARCHIVED master by default (showArchivedMasters=true) (GH #267)', async () => {
    seedDictionaries([masterM1, archivedMasterM2], [serviceS1], [locationAlpika]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      activityA1(0, 600),
      { ...activityA1(1, 840), id: 'a2', master_id: 'm-arch' },
    ]));

    renderDataProvider();

    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('2');
    });
  });

  it('hides a card on an ARCHIVED location by default (showArchivedLocations=false) (GH #267)', async () => {
    seedDictionaries([masterM1], [serviceS1], [locationAlpika, archivedLocationLoc]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      activityA1(0, 600), // active location
      { ...activityA1(1, 840), id: 'a2', location_id: 'loc-arch' }, // archived location
    ]));

    renderDataProvider();

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    // Only the active-location card survives the default gate.
    expect(screen.getByTestId('activity-count').textContent).toBe('1');
  });

  it('reveals archived-location cards the moment the toggle flips on (GH #267)', async () => {
    seedDictionaries([masterM1], [serviceS1], [locationAlpika, archivedLocationLoc]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      activityA1(0, 600),
      { ...activityA1(1, 840), id: 'a2', location_id: 'loc-arch' },
    ]));

    renderDataProvider({ showArchivedLocations: false });

    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('1');
    });

    act(() => {
      screen.getByTestId('toggle-archived-locations').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('2');
    });
  });

  it('keeps archived-master cards visible even when the id-filter names only an active master (GH #267)', async () => {
    seedDictionaries([masterM1, archivedMasterM2], [serviceS1], [locationAlpika]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      activityA1(0, 600),
      { ...activityA1(1, 840), id: 'a2', master_id: 'm-arch' },
    ]));

    // id-filter: only the ACTIVE master m1 — without the gate exemption the
    // archived card would vanish here.
    renderDataProvider({ filterMasterIds: ['m1'] });

    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('2');
    });
  });

  it('shows a card on an archived SERVICE without any toggle (services are not gated) (GH #267)', async () => {
    seedDictionaries([masterM1], [archivedServiceS, serviceS1], [locationAlpika]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      activityA1(0, 600),
      { ...activityA1(1, 840), id: 'a2', service_id: 's-arch' },
    ]));

    renderDataProvider({ showArchivedMasters: false, showArchivedLocations: false });

    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('2');
    });
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

// ─── Deferred activity delete (#286) ──────────────────────────────────────────

describe('ScheduleDataProvider — deleteActivityDeferred (#286)', () => {
  beforeEach(() => {
    __resetNavigation();
    vi.clearAllMocks();
    vi.mocked(getAllMasters).mockResolvedValue([] as never);
    vi.mocked(getAllLocations).mockResolvedValue([] as never);
    vi.mocked(getAllServices).mockResolvedValue([] as never);
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]) as never);
    vi.mocked(createActivity).mockResolvedValue({} as never);
    vi.mocked(patchActivity).mockResolvedValue({} as never);
    vi.mocked(dryRunDeleteActivity).mockResolvedValue(undefined);
    vi.mocked(deleteActivityWithExpected).mockResolvedValue(undefined);
    seedDictionaries();
  });

  function weekKey(): readonly unknown[] {
    return qk.activityRange(weekStartKey(), weekEndKey());
  }

  /** Render + settle the initial load with a FRESH week cache (the app's
   *  providers default staleTime is 30s; the test client has none). */
  async function renderReady() {
    const utils = renderDataProvider();
    utils.queryClient.setQueryDefaults(weekKey(), { staleTime: 60_000 });
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    return utils;
  }

  function lastEnqueuedAction(): PendingAction {
    expect(mockEnqueuePendingAction).toHaveBeenCalled();
    return mockEnqueuePendingAction.mock.calls.at(-1)![0] as PendingAction;
  }

  function cacheRowIds(queryClient: QueryClient, key: readonly unknown[]): string[] {
    const cache = queryClient.getQueryData<{ id: string }[]>(key);
    return (cache ?? []).map((a) => a.id);
  }

  it('(а) dry-run 409 → needs-confirm returned, NO enqueue, cache untouched', async () => {
    vi.mocked(dryRunDeleteActivity).mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, ACTIVITY_DEPS),
    );
    const { queryClient } = await renderReady();

    act(() => {
      screen.getByTestId('delete-activity').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-outcome').textContent).toContain('needs-confirm');
    });
    const outcome = JSON.parse(screen.getByTestId('delete-outcome').textContent!) as {
      kind: string;
      refetched: boolean;
      dependencies: unknown[];
    };
    expect(outcome.kind).toBe('needs-confirm');
    expect(outcome.refetched).toBe(false);
    expect(outcome.dependencies).toHaveLength(4);
    // No pending action, no commit call, the row stays in the cache.
    expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
    expect(deleteActivityWithExpected).not.toHaveBeenCalled();
    expect(cacheRowIds(queryClient, weekKey())).toContain('a1');
  });

  it('(б) dry-run 204 → enqueued (5s undo window): optimistic map-remove from EVERY [activities] family cache, no commit yet', async () => {
    const { queryClient } = await renderReady();
    // Second family member — activitiesForRecords — holds the row too.
    const forRecordsKey = qk.activitiesForRecords(['r1']);
    queryClient.setQueryData(forRecordsKey, [
      activityA1(0, 600),
      { ...activityA1(1, 840), id: 'a2' },
    ]);

    act(() => {
      screen.getByTestId('delete-activity').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-outcome').textContent).toContain('enqueued');
    });
    expect(dryRunDeleteActivity).toHaveBeenCalledWith('a1');
    const action = lastEnqueuedAction();
    expect(action.id).toBe('delete-activity-a1');
    expect(action.kind).toBe('delete');
    expect(action.message).toBe('Удалено. Отменить');
    expect(action.delayMs).toBe(5000);
    expect(deleteActivityWithExpected).not.toHaveBeenCalled();
    // Optimistic removal hits both family caches; the neighbour survives.
    expect(cacheRowIds(queryClient, weekKey())).not.toContain('a1');
    const forRecords = cacheRowIds(queryClient, forRecordsKey);
    expect(forRecords).not.toContain('a1');
    expect(forRecords).toContain('a2');
  });

  it('(в-чистый) commit carries expected {} and invalidates the activities family', async () => {
    const { queryClient } = await renderReady();
    const callsBefore = vi.mocked(getActivities).mock.calls.length;

    act(() => {
      screen.getByTestId('delete-activity').click();
    });
    await waitFor(() => {
      expect(mockEnqueuePendingAction).toHaveBeenCalled();
    });
    const action = lastEnqueuedAction();

    await act(async () => {
      await action.commit();
    });

    expect(deleteActivityWithExpected).toHaveBeenCalledTimes(1);
    expect(deleteActivityWithExpected).toHaveBeenCalledWith('a1', { expected: {} });
    // Family invalidation (['activities'] prefix) → the week query refetches.
    await waitFor(() => {
      expect(vi.mocked(getActivities).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it('(в-каскад) confirmed delete carries the FULL id lists from all three items nodes (auto excluded)', async () => {
    const { queryClient } = await renderReady();

    act(() => {
      screen.getByTestId('confirm-delete-activity').click();
    });
    await waitFor(() => {
      expect(mockEnqueuePendingAction).toHaveBeenCalled();
    });
    // The confirm path also removes the row optimistically.
    expect(cacheRowIds(queryClient, weekKey())).not.toContain('a1');

    const action = lastEnqueuedAction();
    await act(async () => {
      await action.commit();
    });

    expect(deleteActivityWithExpected).toHaveBeenCalledWith('a1', {
      expected: { records: ['r1'], visits: ['v1'], payments: ['p1'] },
    });
  });

  it('(г) undo = replace-by-id: the captured row returns, mid-window SSE updates to neighbours are NOT rolled back', async () => {
    vi.mocked(getActivities).mockResolvedValue(
      wrap([activityA1(0, 600), { ...activityA1(1, 840), id: 'a2' }]) as never,
    );
    const { queryClient } = await renderReady();
    const rowA1 = queryClient
      .getQueryData<{ id: string }[]>(weekKey())!
      .find((a) => a.id === 'a1');

    act(() => {
      screen.getByTestId('delete-activity').click();
    });
    await waitFor(() => {
      expect(mockEnqueuePendingAction).toHaveBeenCalled();
    });
    expect(cacheRowIds(queryClient, weekKey())).not.toContain('a1');

    // Mid-window SSE: the neighbour a2 is bumped in the cache.
    queryClient.setQueryData<{ id: string; occupied: number }[]>(
      weekKey(),
      (old) => (old ?? []).map((a) => (a.id === 'a2' ? { ...a, occupied: 7 } : a)),
    );

    act(() => {
      lastEnqueuedAction().undo();
    });

    const cache = queryClient.getQueryData<{ id: string; occupied: number }[]>(weekKey());
    const restored = cache?.find((a) => a.id === 'a1');
    expect(restored).toBe(rowA1); // the ORIGINAL captured object, by id
    expect(cache?.find((a) => a.id === 'a2')?.occupied).toBe(7); // SSE update survives
  });

  it('stale week cache (isInvalidated) → ensure-fresh fetchQuery runs first, refetched=true rides on the outcome', async () => {
    vi.mocked(dryRunDeleteActivity).mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, ACTIVITY_DEPS),
    );
    const { queryClient } = await renderReady();
    const callsBefore = vi.mocked(getActivities).mock.calls.length;
    // Mark invalidated WITHOUT refetch (v5 refetchType:'none').
    queryClient.invalidateQueries({ queryKey: weekKey(), refetchType: 'none' });

    act(() => {
      screen.getByTestId('delete-activity').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-outcome').textContent).toContain('needs-confirm');
    });
    expect(vi.mocked(getActivities).mock.calls.length).toBeGreaterThan(callsBefore);
    const outcome = JSON.parse(screen.getByTestId('delete-outcome').textContent!) as { refetched: boolean };
    expect(outcome.refetched).toBe(true);
  });

  it('fresh week cache → no ensure-fresh refetch (refetched=false, zero extra queries)', async () => {
    const { queryClient } = await renderReady();
    const callsBefore = vi.mocked(getActivities).mock.calls.length;

    act(() => {
      screen.getByTestId('delete-activity').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-outcome').textContent).toContain('enqueued');
    });
    const outcome = JSON.parse(screen.getByTestId('delete-outcome').textContent!) as { refetched: boolean };
    expect(outcome.refetched).toBe(false);
    expect(vi.mocked(getActivities).mock.calls.length).toBe(callsBefore);
  });

  it('dry-run network error rejects upward — no enqueue, cache untouched', async () => {
    vi.mocked(dryRunDeleteActivity).mockRejectedValue(new Error('network down'));
    const { queryClient } = await renderReady();

    act(() => {
      screen.getByTestId('delete-activity').click();
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-outcome').textContent).toBe('error:network down');
    });
    expect(mockEnqueuePendingAction).not.toHaveBeenCalled();
    expect(cacheRowIds(queryClient, weekKey())).toContain('a1');
  });

  // #286 Task 5 — the provider only HOLDS the pending-confirm state; the call
  // sites (card/modal) set it on the needs-confirm outcome.
  it('pending-confirm state: null by default, round-trips via the setter', async () => {
    await renderReady();

    expect(screen.getByTestId('pending-confirm').textContent).toBe('null');

    act(() => {
      screen.getByTestId('set-pending-confirm').click();
    });
    const exposed = JSON.parse(screen.getByTestId('pending-confirm').textContent!) as {
      activityId: string;
      refetched: boolean;
      deps: number;
    };
    expect(exposed).toEqual({ activityId: 'a1', refetched: true, deps: 4 });

    act(() => {
      screen.getByTestId('clear-pending-confirm').click();
    });
    expect(screen.getByTestId('pending-confirm').textContent).toBe('null');
  });

  it('the provider does NOT self-set pending-confirm on the 409 needs-confirm outcome (call sites own it)', async () => {
    vi.mocked(dryRunDeleteActivity).mockRejectedValue(
      new ApiError(409, 'has_dependencies', undefined, ACTIVITY_DEPS),
    );
    await renderReady();

    act(() => {
      screen.getByTestId('delete-activity').click();
    });
    await waitFor(() => {
      expect(screen.getByTestId('delete-outcome').textContent).toContain('needs-confirm');
    });

    // No auto-set: the dialog opens only when a call site (card/modal) hands
    // the outcome over via setPendingActivityConfirm.
    expect(screen.getByTestId('pending-confirm').textContent).toBe('null');
  });

  // #286 fix round: a pending confirm captured for week N is stale once the
  // user navigates — week N+1's dry-run tree was never fetched. The provider
  // resets the state on weekStart change (covers week AND day navigation,
  // which both move dateFrom/dateTo).
  it('navigating to another week resets the pending-confirm state', async () => {
    await renderReady();

    act(() => {
      screen.getByTestId('set-pending-confirm').click();
    });
    expect(screen.getByTestId('pending-confirm').textContent).not.toBe('null');

    act(() => {
      screen.getByTestId('next-week').click();
    });

    expect(screen.getByTestId('pending-confirm').textContent).toBe('null');
  });
});

// ─── staleAwareOnError — activities branches (#286 D7) ────────────────────────

describe('ScheduleDataProvider — staleAwareOnError(activities) commit branches (#286 D7)', () => {
  beforeEach(() => {
    __resetNavigation();
    vi.clearAllMocks();
    vi.mocked(getAllMasters).mockResolvedValue([] as never);
    vi.mocked(getAllLocations).mockResolvedValue([] as never);
    vi.mocked(getAllServices).mockResolvedValue([] as never);
    vi.mocked(getActivities).mockResolvedValue(wrap([activityA1(0, 600)]) as never);
    vi.mocked(createActivity).mockResolvedValue({} as never);
    vi.mocked(patchActivity).mockResolvedValue({} as never);
    vi.mocked(dryRunDeleteActivity).mockResolvedValue(undefined);
    vi.mocked(deleteActivityWithExpected).mockResolvedValue(undefined);
    seedDictionaries();
  });

  function weekKey(): readonly unknown[] {
    return qk.activityRange(weekStartKey(), weekEndKey());
  }

  async function renderReadyAndEnqueue() {
    const utils = renderDataProvider();
    utils.queryClient.setQueryDefaults(weekKey(), { staleTime: 60_000 });
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    const rowA1 = utils.queryClient
      .getQueryData<{ id: string }[]>(weekKey())!
      .find((a) => a.id === 'a1');

    act(() => {
      screen.getByTestId('delete-activity').click();
    });
    await waitFor(() => {
      expect(mockEnqueuePendingAction).toHaveBeenCalled();
    });
    const action = mockEnqueuePendingAction.mock.calls.at(-1)![0] as PendingAction;
    expect(cacheRowIds(utils.queryClient, weekKey())).not.toContain('a1');
    return { ...utils, action, rowA1 };
  }

  function cacheRowIds(queryClient: QueryClient, key: readonly unknown[]): string[] {
    const cache = queryClient.getQueryData<{ id: string }[]>(key);
    return (cache ?? []).map((a) => a.id);
  }

  it('(а) 409+dependencies → undo restores the row + stale toast with «Обновить» → action invalidates [activities]', async () => {
    const { queryClient, action, rowA1 } = await renderReadyAndEnqueue();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => {
      action.onError!(new ApiError(409, 'stale_dependencies', undefined, ACTIVITY_DEPS));
    });

    // undo ran — the captured row is back in the week cache.
    expect(queryClient.getQueryData<{ id: string }[]>(weekKey())?.[0]).toBe(rowA1);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Не удалось удалить: данные изменились',
      'error',
      undefined,
      undefined,
      { label: 'Обновить', onAction: expect.any(Function) },
    );
    // The «Обновить» action invalidates the ['activities'] family.
    const actionSlot = mockShowToast.mock.calls.at(-1)![4] as { onAction: () => void };
    act(() => {
      actionSlot.onAction();
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['activities'] });
  });

  it('(б) 404 → quiet success: no undo, no toast', async () => {
    const { queryClient, action } = await renderReadyAndEnqueue();

    act(() => {
      action.onError!(new ApiError(404, 'Not found', 'NOT_FOUND'));
    });

    expect(mockShowToast).not.toHaveBeenCalled();
    // The row stays removed — a competitor's DELETE already achieved the goal.
    expect(cacheRowIds(queryClient, weekKey())).not.toContain('a1');
  });

  it('(в) other errors → context-default: undo + red toast, no action slot', async () => {
    const { queryClient, action, rowA1 } = await renderReadyAndEnqueue();

    act(() => {
      action.onError!(new ApiError(500, 'Internal error', 'INTERNAL'));
    });

    expect(queryClient.getQueryData<{ id: string }[]>(weekKey())?.[0]).toBe(rowA1);
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('Не удалось удалить. Изменение отменено', 'error');
  });
});

// ─── week-range key helpers (no ?date → the URL hook defaults to the current week) ─

function weekStartKey(): string {
  return toISODate(mondayOfCurrentWeek());
}
function weekEndKey(): string {
  const monday = mondayOfCurrentWeek();
  monday.setDate(monday.getDate() + 6);
  return toISODate(monday);
}
