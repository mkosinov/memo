import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleProvider, useSchedule } from '../contexts/ScheduleContext';
import { NavigationProvider, useNavigation } from '../contexts/NavigationContext';
import { getMonday, toISODate } from '@/lib/datetime';
import { transformService } from '../lib/transformers';

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

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockMasters = [
  { id: 'm1', name: 'Ольга Середа', shortName: 'Ольга', color: '#5B8C7A' },
  { id: 'm2', name: 'Юлия Большакова', shortName: 'Юлия', color: '#6B7E9C' },
];

const mockLocations = [
  { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж' },
  { id: 'grand', name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби' },
];

const mockServices = [
  { id: 's1', name: 'Картина маслом', durationMinutes: 150, minAge: '12', defaultAdultPrice: 3500 },
  { id: 's2', name: 'Картина акрилом', durationMinutes: 120, minAge: '6', defaultAdultPrice: 2800 },
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

// Test component that consumes the context
function ScheduleConsumer() {
  const {
    activities,
    masters,
    services,
    locations,
    currentWeek,
    stamp,
    setCurrentWeek,
    addActivity,
    updateActivity,
    deleteActivity,
    setStamp,
    copyLastWeek,
    loading,
    error,
    viewMode,
    setViewMode,
    selectedDay,
    setSelectedDay,
    gridStartMinutes,
    gridEndMinutes,
  } = useSchedule();

  return (
    <div>
      <span data-testid="activity-count">{activities.length}</span>
      <span data-testid="master-count">{masters.length}</span>
      <span data-testid="service-count">{services.length}</span>
      <span data-testid="location-count">{locations.length}</span>
      <span data-testid="week-start">{currentWeek.toISOString()}</span>
      <span data-testid="stamp-ready">{stamp.ready.toString()}</span>
      <span data-testid="loading">{loading.toString()}</span>
      <span data-testid="error">{error ? error.message : 'null'}</span>
      <span data-testid="view-mode">{viewMode}</span>
      <span data-testid="selected-day">{selectedDay.toISOString()}</span>
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
        onClick={() => updateActivity('a1', { serviceId: 's5', durationMinutes: 120, capacity: null } as any)}
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
      <button
        data-testid="set-week"
        onClick={() => setCurrentWeek(new Date(2026, 4, 18))}
      >
        Set Week
      </button>
      <button
        data-testid="set-stamp"
        onClick={() => setStamp({ ...stamp, ready: true })}
      >
        Set Stamp
      </button>
      <button data-testid="copy-last-week" onClick={copyLastWeek}>
        Copy
      </button>
      <button data-testid="set-view-day" onClick={() => setViewMode('day')}>
        Day
      </button>
      <button data-testid="set-view-week" onClick={() => setViewMode('week')}>
        Week
      </button>
      <button
        data-testid="set-selected-day"
        onClick={() => setSelectedDay(new Date(2026, 5, 15))}
      >
        Set Day
      </button>

    </div>
  );
}

function renderWithContext() {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <ScheduleProvider>
          <ScheduleConsumer />
        </ScheduleProvider>
      </NavigationProvider>
    </QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ScheduleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock returns for API calls
    vi.mocked(getAllMasters).mockResolvedValue([]);
    vi.mocked(getAllLocations).mockResolvedValue([]);
    vi.mocked(getAllServices).mockResolvedValue([]);
    vi.mocked(getActivities).mockResolvedValue(wrap([]));
    vi.mocked(createActivity).mockResolvedValue({} as any);
    vi.mocked(patchActivity).mockResolvedValue({} as any);
    vi.mocked(deleteActivity).mockResolvedValue(undefined);
  });

  it('throws when useSchedule is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenConsumer() {
      useSchedule();
      return null;
    }
    expect(() => render(<BrokenConsumer />)).toThrow(
      'useSchedule must be used within ScheduleProvider'
    );
    spy.mockRestore();
  });

  it('fetches dictionary lookups via getAllX bare-array methods (#205 T12)', async () => {
    vi.mocked(getAllMasters).mockResolvedValue([
      { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]);

    renderWithContext();

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
    vi.mocked(getAllMasters).mockResolvedValue([
      { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
      { id: 'm2', first_name: 'Юлия', last_name: 'Большакова', color: '#6B7E9C', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]);
    vi.mocked(getAllServices).mockResolvedValue([
      { id: 's1', title: 'Картина маслом', description: '', image_url: '', specialty: '', min_age: 12, max_age: 99, duration: 150, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getAllLocations).mockResolvedValue([
      { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, archived: false, created_at: '', updated_at: '' },
      { id: 'grand', name: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      { id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika', start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 3 },
      { id: 'a2', master_id: 'm2', service_id: 's1', location_id: 'grand', start: '2024-12-26T14:00:00Z', duration: 90, capacity: 6, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 4 },
    ]));

    renderWithContext();

    await waitFor(() => {
      expect(screen.getByTestId('master-count').textContent).toBe('2');
    });
    expect(screen.getByTestId('service-count').textContent).toBe('1');
    expect(screen.getByTestId('location-count').textContent).toBe('2');
    expect(screen.getByTestId('activity-count').textContent).toBe('2');
  });

  it('initializes with locations (not studios)', async () => {
    renderWithContext();
    // Wait for queries to settle
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    // Verify activities is an empty array (not failing)
    expect(screen.getByTestId('activity-count').textContent).toBe('0');
    // Verify locations is available (not studios)
    expect(screen.getByTestId('location-count').textContent).toBe('0');
  });

  it('initializes currentWeek to Monday of today', () => {
    renderWithContext();
    const weekStart = new Date(screen.getByTestId('week-start').textContent!);
    expect(weekStart.getDay()).toBe(1); // Monday
  });

  it('initializes stamp with ready=false', () => {
    renderWithContext();
    expect(screen.getByTestId('stamp-ready').textContent).toBe('false');
  });

  it('changes current week', () => {
    renderWithContext();
    const expected = getMonday(new Date(2026, 4, 18));
    act(() => {
      screen.getByTestId('set-week').click();
    });
    const weekStart = new Date(screen.getByTestId('week-start').textContent!);
    expect(weekStart.getDate()).toBe(expected.getDate());
  });

  it('updates stamp state', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-stamp').click();
    });
    expect(screen.getByTestId('stamp-ready').textContent).toBe('true');
  });

  it('calls createActivity mutation when addActivity is called', async () => {
    vi.mocked(createActivity).mockResolvedValue({
      id: 'new-id', master_id: 'm1', service_id: 's1', location_id: 'alpika',
      start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false,
      comment: null, record_info: null, created_at: '', updated_at: '', occupied: 0,
    });

    renderWithContext();

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

  it('maps dayIndex/startMinutes to a floating-local start string and integer duration on PATCH (GH #142)', async () => {
    vi.mocked(getAllMasters).mockResolvedValue([
      { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]);
    vi.mocked(getAllServices).mockResolvedValue([
      { id: 's1', title: 'Картина маслом', description: '', image_url: '', specialty: '', min_age: 12, max_age: 99, duration: 120, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getAllLocations).mockResolvedValue([
      { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, location_hint: null, archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      { id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika', start: `${currentWeekDate(0)}T10:00:00`, duration: 120, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 3 },
    ]));
    vi.mocked(patchActivity).mockResolvedValue({
      id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika',
      start: `${currentWeekDate(1)}T12:00:00`, duration: 150, capacity: 8, is_private: false,
      comment: null, record_info: null, created_at: '', updated_at: '', occupied: 3,
    });

    renderWithContext();
    await waitFor(() => { expect(screen.getByTestId('activity-count').textContent).toBe('1'); });

    // dayIndex: 1 (Tuesday), startMinutes: 720 (12:00), durationMinutes: 150
    act(() => { screen.getByTestId('update-activity-time').click(); });

    await waitFor(() => { expect(patchActivity).toHaveBeenCalled(); });
    expect(patchActivity).toHaveBeenCalledWith('a1', expect.objectContaining({
      start: `${currentWeekDate(1)}T12:00:00`,
      duration: 150,
    }));
  });

  it('calls patchActivity mutation when updateActivity is called', async () => {
    vi.mocked(getAllMasters).mockResolvedValue([
      { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]);
    vi.mocked(getAllServices).mockResolvedValue([
      { id: 's1', title: 'Картина маслом', description: '', image_url: '', specialty: '', min_age: 12, max_age: 99, duration: 120, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getAllLocations).mockResolvedValue([
      { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, location_hint: null, archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      { id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika', start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 3 },
    ]));
    vi.mocked(patchActivity).mockResolvedValue({
      id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika',
      start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false,
      comment: null, record_info: null, created_at: '', updated_at: '', occupied: 5,
    });

    renderWithContext();

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

  // ─── BUG-63 regression tests ──────────────────────────────────────────────

  it('excludes capacity from PATCH payload when capacity is null (BUG-63 regression)', async () => {
    vi.mocked(getAllMasters).mockResolvedValue([
      { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]);
    vi.mocked(getAllServices).mockResolvedValue([
      { id: 's1', title: 'Картина маслом', description: '', image_url: '', specialty: '', min_age: 12, max_age: null, duration: 120, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getAllLocations).mockResolvedValue([
      { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, location_hint: null, archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      { id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika', start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 3 },
    ]));
    vi.mocked(patchActivity).mockResolvedValue({
      id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika',
      start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false,
      comment: null, record_info: null, created_at: '', updated_at: '', occupied: 5,
    });

    renderWithContext();
    await waitFor(() => { expect(screen.getByTestId('activity-count').textContent).toBe('1'); });

    // Simulate updateActivity with null capacity (what happens when service changes and maxCapacity is null)
    act(() => { screen.getByTestId('update-activity-null-capacity').click(); });

    await waitFor(() => { expect(patchActivity).toHaveBeenCalled(); });
    // KEY: payload must NOT contain capacity when it would be null
    const callArgs = (patchActivity as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty('capacity');
  });

  it('includes capacity in PATCH payload when capacity has a defined value (BUG-63 regression)', async () => {
    vi.mocked(getAllMasters).mockResolvedValue([
      { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]);
    vi.mocked(getAllServices).mockResolvedValue([
      { id: 's1', title: 'Картина маслом', description: '', image_url: '', specialty: '', min_age: 12, max_age: null, duration: 120, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getAllLocations).mockResolvedValue([
      { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, location_hint: null, archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      { id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika', start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 3 },
    ]));
    vi.mocked(patchActivity).mockResolvedValue({
      id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika',
      start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false,
      comment: null, record_info: null, created_at: '', updated_at: '', occupied: 5,
    });

    renderWithContext();
    await waitFor(() => { expect(screen.getByTestId('activity-count').textContent).toBe('1'); });

    // Simulate updateActivity with a defined capacity
    act(() => { screen.getByTestId('update-activity-with-capacity').click(); });

    await waitFor(() => { expect(patchActivity).toHaveBeenCalled(); });
    const callArgs = (patchActivity as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[1]).toHaveProperty('capacity', 8);
    expect(callArgs[1]).toHaveProperty('service_id');
  });

  it('transformService does not produce maxCapacity field (BUG-63 regression)', () => {
    const mockRaw = {
      id: 's1', title: 'Картина маслом', duration: 120, min_age: 12, max_age: null,
      tariffs: [], tags: [], description: '', image_url: '', specialty: '', record_info: '',
      archived: false, created_at: '', updated_at: '',
    } as any;
    const result = transformService(mockRaw);
    expect(result).not.toHaveProperty('maxCapacity');
  });

  // ─── end BUG-63 regression tests ──────────────────────────────────────────

  it('calls deleteActivity mutation when deleteActivity is called', async () => {
    vi.mocked(getAllMasters).mockResolvedValue([
      { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]);
    vi.mocked(getAllServices).mockResolvedValue([
      { id: 's1', title: 'Картина маслом', description: '', image_url: '', specialty: '', min_age: 12, max_age: 99, duration: 120, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getAllLocations).mockResolvedValue([
      { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, location_hint: null, archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getActivities).mockResolvedValue(wrap([
      { id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika', start: '2024-12-25T10:00:00Z', duration: 120, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 3 },
    ]));

    renderWithContext();

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
    renderWithContext();
    expect(() => {
      act(() => {
        screen.getByTestId('copy-last-week').click();
      });
    }).not.toThrow();
  });

  it('sets loading to false after data resolves', async () => {
    vi.mocked(getActivities).mockResolvedValue(wrap([]));
    renderWithContext();

    // loading should be false after Query resolves
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
  });

  it('sets error when data fetching fails', async () => {
    vi.mocked(getActivities).mockRejectedValue(new Error('Network error'));
    renderWithContext();

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).not.toBe('null');
    });
  });

  // ─── viewMode tests ────────────────────────────────────────────────────────

  it('defaults viewMode to "week"', () => {
    renderWithContext();
    expect(screen.getByTestId('view-mode').textContent).toBe('week');
  });

  it('provides setViewMode to switch between week and day', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-view-day').click();
    });
    expect(screen.getByTestId('view-mode').textContent).toBe('day');

    act(() => {
      screen.getByTestId('set-view-week').click();
    });
    expect(screen.getByTestId('view-mode').textContent).toBe('week');
  });

  // ─── selectedDay tests ─────────────────────────────────────────────────────

  it('defaults selectedDay to today', () => {
    renderWithContext();
    const today = new Date();
    const selectedDay = new Date(screen.getByTestId('selected-day').textContent!);
    expect(selectedDay.toDateString()).toBe(today.toDateString());
  });

  it('provides setSelectedDay to change the selected day', () => {
    renderWithContext();
    act(() => {
      screen.getByTestId('set-selected-day').click();
    });
    const selectedDay = new Date(screen.getByTestId('selected-day').textContent!);
    expect(selectedDay.getFullYear()).toBe(2026);
    expect(selectedDay.getMonth()).toBe(5); // June
    expect(selectedDay.getDate()).toBe(15);
  });

  // ─── gridStartMinutes / gridEndMinutes tests (GH #142) ────────────────────

  it('defaults grid bounds to working hours (9:00–21:00) when no activities', async () => {
    vi.mocked(getActivities).mockResolvedValue(wrap([]));
    renderWithContext();
    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
    });
    expect(screen.getByTestId('grid-start').textContent).toBe('540');
    expect(screen.getByTestId('grid-end').textContent).toBe('1260');
  });

  it('extends grid bounds to fit activities outside working hours', async () => {
    vi.mocked(getAllMasters).mockResolvedValue([
      { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'мастер', specialty: 'живопись', avatar_url: null, archived: false, sort_order: 0, created_at: '2024-01-01', updated_at: '2024-01-01' },
    ]);
    vi.mocked(getAllServices).mockResolvedValue([
      { id: 's1', title: 'Картина маслом', description: '', image_url: '', specialty: '', min_age: 12, max_age: 99, duration: 150, record_info: '', tariffs: [], tags: [], archived: false, created_at: '', updated_at: '' },
    ]);
    vi.mocked(getAllLocations).mockResolvedValue([
      { id: 'alpika', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 10, yandex_map_url: null, review_url: null, record_info: null, image_url: null, location_hint: null, archived: false, created_at: '', updated_at: '' },
    ]);
    // Early morning (07:00 → 420) and midnight-ending (22:00 + 120 = 1440) activities
    vi.mocked(getActivities).mockResolvedValue(wrap([
      { id: 'a1', master_id: 'm1', service_id: 's1', location_id: 'alpika', start: `${currentWeekDate(0)}T07:00:00`, duration: 60, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 0 },
      { id: 'a2', master_id: 'm1', service_id: 's1', location_id: 'alpika', start: `${currentWeekDate(1)}T22:00:00`, duration: 120, capacity: 8, is_private: false, comment: null, record_info: null, created_at: '', updated_at: '', occupied: 0 },
    ]));

    renderWithContext();

    await waitFor(() => {
      expect(screen.getByTestId('activity-count').textContent).toBe('2');
    });
    // adaptive start: floor(420/60)*60 - 60 = 360; adaptive end: ceil(1440/60)*60 + 60 = 1500 clamped to 1440
    expect(screen.getByTestId('grid-start').textContent).toBe('360');
    expect(screen.getByTestId('grid-end').textContent).toBe('1440');
  });

  // ─── __memo-switch-to-day-view event tests ─────────────────────────────────

  it('switches viewMode to "day" and sets selectedDay when __memo-switch-to-day-view event fires', () => {
    renderWithContext();
    // Verify initial state
    expect(screen.getByTestId('view-mode').textContent).toBe('week');

    const targetDate = new Date(2026, 5, 15); // June 15, 2026

    act(() => {
      document.dispatchEvent(new CustomEvent('__memo-switch-to-day-view', { detail: { date: targetDate } }));
    });

    expect(screen.getByTestId('view-mode').textContent).toBe('day');
    const selectedDay = new Date(screen.getByTestId('selected-day').textContent!);
    expect(selectedDay.toDateString()).toBe(targetDate.toDateString());
  });

  it('navigates week range when __memo-switch-to-day-view event fires', () => {
    renderWithContext();
    // Set initial week far from the target
    act(() => {
      screen.getByTestId('set-week').click(); // sets to 2026-05-18
    });

    const targetDate = new Date(2026, 6, 6); // July 6, 2026 (Monday)

    act(() => {
      document.dispatchEvent(new CustomEvent('__memo-switch-to-day-view', { detail: { date: targetDate } }));
    });

    // The week should now contain July 6
    const weekStart = new Date(screen.getByTestId('week-start').textContent!);
    expect(weekStart.toDateString()).toBe(targetDate.toDateString());
  });

  it('synchronizes currentWeek with NavigationProvider dateFrom', () => {
    // ── Navigation consumer changes NavigationProvider's dateFrom ──
    function NavigationController() {
      const { selectDateRange } = useNavigation();
      return (
        <button
          data-testid="nav-set-week"
          onClick={() => selectDateRange('2026-05-11', '2026-05-17')}
        />
      );
    }

    function renderWithNavController() {
      const queryClient = createTestQueryClient();
      return render(
        <QueryClientProvider client={queryClient}>
          <NavigationProvider>
            <ScheduleProvider>
              <ScheduleConsumer />
              <NavigationController />
            </ScheduleProvider>
          </NavigationProvider>
        </QueryClientProvider>,
      );
    }

    renderWithNavController();

    // Click to set NavigationProvider's dateFrom to Monday 2026-05-11
    act(() => {
      screen.getByTestId('nav-set-week').click();
    });

    const weekStart = new Date(screen.getByTestId('week-start').textContent!);
    // 2026-05-11 is a Monday
    expect(weekStart.getFullYear()).toBe(2026);
    expect(weekStart.getMonth()).toBe(4); // May
    expect(weekStart.getDate()).toBe(11);
    expect(weekStart.getDay()).toBe(1); // Monday
  });
});
