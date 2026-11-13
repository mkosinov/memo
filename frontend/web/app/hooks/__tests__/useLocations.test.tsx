import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import { useLocations } from '../useLocations';
import { useSchedule } from '../useSchedule';

// ─── Mock @memo/api-client ─────────────────────────────────────────────────
// #601: locations come from the PUBLIC dictionary only — getLocations (the
// staff route) is kept as a spy and must never be called by the web.
vi.mock('@memo/api-client', () => ({
  getPublicLocations: vi.fn(),
  getLocations: vi.fn(),
  getPublicActivities: vi.fn(),
  getServices: vi.fn(),
  getMasters: vi.fn(),
}));

import {
  getPublicLocations,
  getLocations,
  getPublicActivities,
  getServices,
  getMasters,
} from '@memo/api-client';

const mockedGetPublicLocations = getPublicLocations as Mock;
const mockedGetLocations = getLocations as Mock;
const mockedGetPublicActivities = getPublicActivities as Mock;
const mockedGetServices = getServices as Mock;
const mockedGetMasters = getMasters as Mock;

// #601: public dictionary rows — bare 4-field objects, no envelope.
const mockLocationRows = [
  { id: 'u1', title: 'Альпика', address: 'Альпика, 1 этаж', location_hint: '1 этаж' },
  { id: 'u2', title: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби', location_hint: null },
  { id: 'u3', title: 'Поляна 1389', address: null, location_hint: null },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fresh QueryClient with retry: false — error tests must not wait on retries. */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// GH #479: the hook rides the shared ['locations'] react-query cache
// (same key and policy as useSchedule) — one request per page load.
// GH #601: the source is the anonymous public dictionary (bare array).
describe('useLocations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPublicLocations.mockResolvedValue(mockLocationRows);
  });

  it('loads on mount and maps the bare public array to LocationView', async () => {
    const { result } = renderHook(() => useLocations(), {
      wrapper: createWrapper(),
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockedGetPublicLocations).toHaveBeenCalledTimes(1);
    // #601: the staff-guarded paginated list must never be called by the web.
    expect(mockedGetLocations).not.toHaveBeenCalled();
    expect(result.current.locations).toStrictEqual([
      { id: 'u1', title: 'Альпика', address: 'Альпика, 1 этаж' },
      { id: 'u2', title: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби' },
      { id: 'u3', title: 'Поляна 1389', address: '' },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('empty dictionary → empty options (UI falls back to defaults)', async () => {
    mockedGetPublicLocations.mockResolvedValue([]);

    const { result } = renderHook(() => useLocations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.locations).toStrictEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a failed fetch as error with an empty list', async () => {
    mockedGetPublicLocations.mockRejectedValue(new Error('backend down'));

    const { result } = renderHook(() => useLocations(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });

    expect(result.current.error?.message).toBe('backend down');
    expect(result.current.locations).toStrictEqual([]);
  });

  it('shares one request between mounted consumers of the cache', async () => {
    const wrapper = createWrapper();
    const first = renderHook(() => useLocations(), { wrapper });
    const second = renderHook(() => useLocations(), { wrapper });

    await waitFor(() => {
      expect(first.result.current.isLoading).toBe(false);
      expect(second.result.current.isLoading).toBe(false);
    });

    expect(mockedGetPublicLocations).toHaveBeenCalledTimes(1);
    expect(first.result.current.locations).toEqual(second.result.current.locations);
  });

  it('dedupes with useSchedule — same key, single public dictionary request', async () => {
    mockedGetPublicActivities.mockResolvedValue({ items: [], total: 0 });
    mockedGetServices.mockResolvedValue({ items: [], total: 0 });
    mockedGetMasters.mockResolvedValue({ items: [], total: 0 });

    const wrapper = createWrapper();
    const schedule = renderHook(() => useSchedule(), { wrapper });
    const locations = renderHook(() => useLocations(), { wrapper });

    await waitFor(() => {
      expect(schedule.result.current.isLoading).toBe(false);
      expect(locations.result.current.isLoading).toBe(false);
    });

    expect(mockedGetPublicLocations).toHaveBeenCalledTimes(1);
    expect(mockedGetLocations).not.toHaveBeenCalled();
    expect(locations.result.current.locations.length).toBe(mockLocationRows.length);
  });
});
