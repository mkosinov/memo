import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSchedule, computeDateRange } from '../useSchedule';
import type { ReactNode } from 'react';
import type { ScheduleFiltersView } from '@/app/lib/model/view/schedule';
import type { Mock } from 'vitest';

// ─── Mock @memo/api-client ─────────────────────────────────────────────────
vi.mock('@memo/api-client', () => ({
  getPublicActivities: vi.fn(),
  // #600: staff route must no longer be called by the web schedule — kept as a spy.
  getActivities: vi.fn(),
  getServices: vi.fn(),
  getMasters: vi.fn(),
  getLocations: vi.fn(),
}));

import {
  getPublicActivities,
  getActivities,
  getServices,
  getMasters,
  getLocations,
} from '@memo/api-client';

const mockedGetPublicActivities = getPublicActivities as Mock;
const mockedGetActivities = getActivities as Mock;
const mockedGetServices = getServices as Mock;
const mockedGetMasters = getMasters as Mock;
const mockedGetLocations = getLocations as Mock;

// ─── Sample data ────────────────────────────────────────────────────────────

const mockServices = [
  {
    id: 'svc-1',
    title: 'Морской пейзаж',
    description: 'Рисуем море',
    image_url: '/img.jpg',
    specialty: 'painting',
    min_age: 6,
    max_age: 99,
    duration: 120,
    record_info: 'Запись обязательна',
    materials: [
      { id: 'mat-1', title: 'Акварель', description: 'Акварельные краски — бумага 300 г/м²', note: null },
      { id: 'mat-2', title: 'Масло', description: 'Масляные краски — классика', note: 'Густые, сохнут долго' },
    ],
    tariffs: [{ id: 't-1', service_id: 'svc-1', title: 'Стандарт', description: null, price: 3500 }],
    tags: [{ id: 'tag-1', title: 'взрослым' }],
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  },
  {
    id: 'svc-2',
    title: 'Акварельный скетчинг',
    description: 'Рисуем акварелью',
    image_url: '/img2.jpg',
    specialty: 'painting',
    min_age: 6,
    max_age: 99,
    duration: 90,
    record_info: '',
    materials: [],
    tariffs: [{ id: 't-2', service_id: 'svc-2', title: 'Стандарт', description: null, price: 2800 }],
    tags: [],
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  },
];

const mockMasters = [
  {
    id: 'm-1',
    first_name: 'Ольга',
    last_name: 'Середа',
    color: '#E8D5B7',
    position: 'Ведущий мастер',
    specialty: 'Живопись',
    avatar_url: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  },
];

const mockLocations = [
  {
    id: 'loc-1',
    title: 'Альпика',
    address: 'ул. Альпика, 1',
    description: null,
    capacity: 20,
    yandex_map_url: null,
    review_url: null,
    record_info: null,
    image_url: null,
    location_hint: '2 этаж',
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  },
  {
    id: 'loc-2',
    title: 'Гранд Отель Поляна',
    address: 'ул. Просвещения, 60',
    description: null,
    capacity: 15,
    yandex_map_url: null,
    review_url: null,
    record_info: null,
    image_url: null,
    location_hint: null,
    is_active: true,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
  },
];

// #600: public route payload — exactly the 8 ADR-015 fields; the unchanged
// mapper must consume only these (no is_private/comment/timestamps).
const mockActivities = [
  {
    id: 'act-1',
    service_id: 'svc-1',
    master_id: 'm-1',
    location_id: 'loc-1',
    start: '2026-06-01T10:00:00',
    duration: 120,
    capacity: 10,
    occupied: 2,
  },
  {
    id: 'act-2',
    service_id: 'svc-2',
    master_id: 'm-1',
    location_id: 'loc-1',
    start: '2026-06-01T14:00:00',
    duration: 90,
    capacity: 10,
    occupied: 0,
  },
  {
    id: 'act-3',
    service_id: 'svc-1',
    master_id: 'm-1',
    location_id: 'loc-2',
    start: '2026-06-02T10:00:00',
    duration: 120,
    capacity: 10,
    occupied: 5,
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function createWrapperWithClient() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: 0,
        gcTime: 0,
      },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return { wrapper, queryClient };
}

function createWrapper() {
  return createWrapperWithClient().wrapper;
}

function mockDefaultResolve(): void {
  mockedGetPublicActivities.mockResolvedValue({ items: mockActivities, total: mockActivities.length });
  mockedGetServices.mockResolvedValue({ items: mockServices, total: mockServices.length });
  mockedGetMasters.mockResolvedValue({ items: mockMasters, total: mockMasters.length });
  mockedGetLocations.mockResolvedValue({ items: mockLocations, total: mockLocations.length });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('computeDateRange', () => {
  it('uses dateStart and dateEnd from filters when provided', () => {
    const filters: ScheduleFiltersView = {
      dateStart: '2026-06-01',
      dateEnd: '2026-06-15',
    };
    const result = computeDateRange(filters);
    expect(result.date_from).toBe('2026-06-01');
    expect(result.date_to).toBe('2026-06-15');
  });

  it('uses dateStart as both from and to when dateEnd is missing', () => {
    const filters: ScheduleFiltersView = {
      dateStart: '2026-06-01',
    };
    const result = computeDateRange(filters);
    expect(result.date_from).toBe('2026-06-01');
    // date_to should default to today + 30 days
    expect(result.date_to).toBeDefined();
    expect(result.date_to.length).toBe(10);
  });

  it('returns date strings in YYYY-MM-DD format', () => {
    const filters: ScheduleFiltersView = {};
    const result = computeDateRange(filters);
    expect(result.date_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.date_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('date_from is before or equal to date_to', () => {
    const filters: ScheduleFiltersView = {};
    const result = computeDateRange(filters);
    expect(result.date_from <= result.date_to).toBe(true);
  });
});

describe('useSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty schedules and loading=true initially', () => {
    mockDefaultResolve();
    const { result } = renderHook(() => useSchedule(), {
      wrapper: createWrapper(),
    });

    expect(result.current.schedules).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('returns schedules after data is loaded', async () => {
    mockDefaultResolve();
    const { result } = renderHook(() => useSchedule(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.schedules.length).toBeGreaterThan(0);
    expect(result.current.schedules[0].title).toBeDefined();
    expect(result.current.schedules[0].priceFormatted).toBeDefined();
    expect(result.current.schedules[0].dateFormatted).toBeDefined();
    expect(result.current.error).toBeNull();
  });

  it('derives materials from service links: first title + note ?? description details', async () => {
    mockDefaultResolve();
    const { result } = renderHook(() => useSchedule(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const linked = result.current.schedules.find((s) => s.id === 'act-1');
    expect(linked?.material).toBe('Акварель');
    expect(linked?.materialDetails).toBe('Акварельные краски — бумага 300 г/м²\nГустые, сохнут долго');

    const unlinked = result.current.schedules.find((s) => s.id === 'act-2');
    expect(unlinked?.material).toBe('');
    expect(unlinked?.materialDetails).toBeUndefined();
  });

  it('calls the public activities API with date range and per_page=100', async () => {
    mockDefaultResolve();
    const filters: ScheduleFiltersView = {
      dateStart: '2026-07-01',
      dateEnd: '2026-07-10',
    };

    renderHook(() => useSchedule(filters), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(mockedGetPublicActivities).toHaveBeenCalledTimes(1);
    });

    expect(mockedGetPublicActivities).toHaveBeenCalledWith({
      date_from: '2026-07-01',
      date_to: '2026-07-10',
      per_page: 100,
    });
    // #600: staff-guarded /api/v1/activities must no longer be hit by the web schedule
    expect(mockedGetActivities).not.toHaveBeenCalled();
    expect(mockedGetServices).toHaveBeenCalledTimes(1);
    expect(mockedGetMasters).toHaveBeenCalledTimes(1);
    expect(mockedGetLocations).toHaveBeenCalledTimes(1);
  });

  it('caches the public list under the ["activities","public",from,to] key', async () => {
    mockDefaultResolve();
    const filters: ScheduleFiltersView = {
      dateStart: '2026-07-01',
      dateEnd: '2026-07-10',
    };
    const { wrapper, queryClient } = createWrapperWithClient();
    const { result } = renderHook(() => useSchedule(filters), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(
      queryClient.getQueryData(['activities', 'public', '2026-07-01', '2026-07-10']),
    ).toEqual({ items: mockActivities, total: mockActivities.length });
    // legacy staff-route cache key must stay empty
    expect(queryClient.getQueryData(['activities', '2026-07-01', '2026-07-10'])).toBeUndefined();
  });

  it('filters by date with getByDate', async () => {
    mockDefaultResolve();
    const { result } = renderHook(() => useSchedule(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // act-1 and act-2 are on 2026-06-01, act-3 is on 2026-06-02 at loc-2
    const dayOne = result.current.getByDate('2026-06-01');
    expect(dayOne.length).toBe(2);
    expect(dayOne.every((s) => s.date === '2026-06-01')).toBe(true);

    const dayTwo = result.current.getByDate('2026-06-02');
    expect(dayTwo.length).toBe(1);
  });

  it('getByDate filters by location when specified', async () => {
    mockDefaultResolve();
    const { result } = renderHook(() => useSchedule(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // act-1 and act-2 are at loc-1 (Альпика)
    const atLocation = result.current.getByDate('2026-06-01', 'loc-1');
    expect(atLocation.length).toBe(2);
    expect(atLocation.every((s) => s.location.id === 'loc-1')).toBe(true);
  });

  it('getByDate returns empty array for date with no activities', async () => {
    mockDefaultResolve();
    const { result } = renderHook(() => useSchedule(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    const noActivities = result.current.getByDate('2099-12-25');
    expect(noActivities).toEqual([]);
  });

  it('returns error when API fails', async () => {
    mockedGetPublicActivities.mockRejectedValue(new Error('Network error'));
    mockedGetServices.mockResolvedValue({ items: mockServices, total: mockServices.length });
    mockedGetMasters.mockResolvedValue({ items: mockMasters, total: mockMasters.length });
    mockedGetLocations.mockResolvedValue({ items: mockLocations, total: mockLocations.length });

    const { result } = renderHook(() => useSchedule(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });

    expect(result.current.error?.message).toBe('Network error');
  });

  it('returns empty schedules when data is empty', async () => {
    mockedGetPublicActivities.mockResolvedValue({ items: [], total: 0 });
    mockedGetServices.mockResolvedValue({ items: mockServices, total: mockServices.length });
    mockedGetMasters.mockResolvedValue({ items: mockMasters, total: mockMasters.length });
    mockedGetLocations.mockResolvedValue({ items: mockLocations, total: mockLocations.length });

    const { result } = renderHook(() => useSchedule(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.schedules).toEqual([]);
    expect(result.current.schedules.length).toBe(0);
    expect(result.current.error).toBeNull();
  });
});
