import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Mock api-client endpoints
vi.mock('@memo/api-client', () => ({
  getMasters: vi.fn(),
  getLocations: vi.fn(),
  getServices: vi.fn(),
  getActivities: vi.fn(),
  getAllMasters: vi.fn(),
  getAllLocations: vi.fn(),
  getAllServices: vi.fn(),
  getClientById: vi.fn(),
  getRecords: vi.fn(),
  getActivity: vi.fn(),
  getPaymentTotals: vi.fn(),
  getAllTags: vi.fn(),
}));

// Mock transformers — shapes mirror the real transformers' domain output
// (transformService now emits durationMinutes + tariffs per #142 spec §6/§9.8).
vi.mock('@/lib/transformers', () => ({
  transformMaster: vi.fn((raw: any) => ({ ...raw, name: raw.first_name + ' ' + raw.last_name })),
  transformLocation: vi.fn((raw: any) => ({ ...raw, name: raw.name })),
  transformService: vi.fn((raw: any) => ({
    ...raw,
    name: raw.title,
    durationMinutes: raw.duration,
    tariffs: raw.tariffs ?? [],
  })),
}));

import {
  getMasters,
  getLocations,
  getServices,
  getAllMasters,
  getAllLocations,
  getAllServices,
  getClientById,
  getRecords,
  getActivity,
  getPaymentTotals,
  getAllTags,
} from '@memo/api-client';
import {
  transformMaster,
  transformLocation,
  transformService,
} from '@/lib/transformers';
import type {
  MasterResponse,
  LocationResponse,
  ServiceResponse,
  ActivityResponse,
  ClientResponse,
  RecordResponse,
  TagResponse,
} from '@memo/api-client';

// ─── Helpers ────────────────────────────────────────────────────────────────

function envelope<T>(items: T[]) {
  return { items, total: items.length, page: 1, per_page: 100 };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function createWrapperWithClient(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// ─── Fixtures ───────────────────────────────────────────────────────────────

const mastersFixture: MasterResponse[] = [
  {
    id: 'm1',
    first_name: 'Анна',
    last_name: 'Иванова',
    color: '#FF6B6B',
    position: 'мастер',
    specialty: 'живопись',
    avatar_url: null,
    archived: false,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
  },
];

const locationsFixture: LocationResponse[] = [
  {
    id: 'l1',
    name: 'Студия на Невском',
    address: 'Невский пр. 28',
    description: null,
    capacity: 10,
    yandex_map_url: null,
    review_url: null,
    record_info: null,
    image_url: null,
    archived: false,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
  },
];

const servicesFixture: ServiceResponse[] = [
  {
    id: 's1',
    title: 'Мастер-класс по живописи',
    description: 'Научитесь писать маслом',
    image_url: 'https://example.com/painting.jpg',
    specialty: 'живопись',
    min_age: 6,
    max_age: 99,
    duration: 180,
    record_info: 'Запись за 24 часа',
    tariffs: [],
    tags: [],
    archived: false,
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
  },
];

const activitiesFixture: ActivityResponse[] = [
  {
    id: 'a1',
    master_id: 'm1',
    service_id: 's1',
    location_id: 'l1',
    start: '2024-12-25T14:00:00Z',
    duration: 180,
    capacity: 10,
    is_private: false,
    comment: null,
    record_info: null,
    created_at: '2024-06-01T12:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
    occupied: 3,
  },
];

const clientFixture: ClientResponse = {
  id: 'c1',
  name: 'Иван Петров',
  phone: '+79001234567',
  email: null,
  channel: 'telegram',
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-06-01T12:00:00Z',
  archived: false,
};

const recordsFixture: RecordResponse[] = [
  {
    id: 'r1',
    activity_id: 'a1',
    client_id: 'c1',
    status: 'confirmed',
    seats: 2,
    anonym_visits: 0,
    comment: null,
    custom_price: null,
    created_at: '2024-06-01T12:00:00Z',
    updated_at: '2024-06-01T12:00:00Z',
    visits: [],
  },
];

const tagsFixture: TagResponse[] = [
  { id: 't1', tag: 'живопись' },
  { id: 't2', tag: 'керамика' },
];

// ─── useMasters ─────────────────────────────────────────────────────────────

describe('useMasters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getAllMasters (bare array) and transforms results', async () => {
    vi.mocked(getAllMasters).mockResolvedValue(mastersFixture);

    const { useMasters } = await import('@/hooks/useMasters');
    const { result } = renderHook(() => useMasters(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getAllMasters).toHaveBeenCalledOnce();
    expect(getMasters).not.toHaveBeenCalled();
    expect(transformMaster).toHaveBeenCalledWith(
      mastersFixture[0],
      expect.any(Number),
      expect.any(Array),
    );
    expect(result.current.data).toHaveLength(1);
  });

  it('uses queryKey ["masters"]', async () => {
    vi.mocked(getAllMasters).mockResolvedValue(mastersFixture);

    const { useMasters } = await import('@/hooks/useMasters');
    const { result } = renderHook(() => useMasters(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Verify the query was cached under ["masters"]
    expect(result.current.data).toBeDefined();
  });
});

// ─── useLocations ───────────────────────────────────────────────────────────

describe('useLocations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getAllLocations (bare array) and transforms results', async () => {
    vi.mocked(getAllLocations).mockResolvedValue(locationsFixture);

    const { useLocations } = await import('@/hooks/useLocations');
    const { result } = renderHook(() => useLocations(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getAllLocations).toHaveBeenCalledOnce();
    expect(getLocations).not.toHaveBeenCalled();
    expect(transformLocation).toHaveBeenCalledWith(
      locationsFixture[0],
      expect.any(Number),
      expect.any(Array),
    );
    expect(result.current.data).toHaveLength(1);
  });
});

// ─── useServices ────────────────────────────────────────────────────────────

describe('useServices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getAllServices (bare array) and transforms results', async () => {
    vi.mocked(getAllServices).mockResolvedValue(servicesFixture);

    const { useServices } = await import('@/hooks/useServices');
    const { result } = renderHook(() => useServices(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getAllServices).toHaveBeenCalledOnce();
    expect(getServices).not.toHaveBeenCalled();
    expect(transformService).toHaveBeenCalledWith(
      servicesFixture[0],
      expect.any(Number),
      expect.any(Array),
    );
    expect(result.current.data).toHaveLength(1);
  });

  // #142 spec §9.8 — domain Service carries tariffs + integer-minute durationMinutes.
  it('select output carries tariffs and integer durationMinutes', async () => {
    const twoTariffService: ServiceResponse = {
      ...servicesFixture[0],
      duration: 180,
      tariffs: [
        { id: 't1', service_id: 's1', title: 'Взрослый', description: null, price: 2500 },
        { id: 't2', service_id: 's1', title: 'Детский', description: null, price: 1500 },
      ],
    };
    vi.mocked(getAllServices).mockResolvedValue([twoTariffService]);

    const { useServices } = await import('@/hooks/useServices');
    const { result } = renderHook(() => useServices(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data![0].tariffs).toHaveLength(2);
    expect(result.current.data![0].durationMinutes).toBe(180);
  });
});

// ─── useClient / useClientRecords (#140 point hooks) ───────────────────────

describe('useClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns client data on success', async () => {
    vi.mocked(getClientById).mockResolvedValue(clientFixture);

    const { useClient } = await import('@/hooks/useClient');
    const { result } = renderHook(() => useClient('c1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getClientById).toHaveBeenCalledWith('c1');
    expect(result.current.data).toEqual(clientFixture);
  });

  it('does not fetch when id is undefined', async () => {
    const { useClient } = await import('@/hooks/useClient');
    const { result } = renderHook(() => useClient(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getClientById).not.toHaveBeenCalled();
  });

  it('uses queryKey ["client", "c1"]', async () => {
    vi.mocked(getClientById).mockResolvedValue(clientFixture);
    const queryClient = createTestQueryClient();

    const { useClient } = await import('@/hooks/useClient');
    const { result } = renderHook(() => useClient('c1'), {
      wrapper: createWrapperWithClient(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      queryClient.getQueryCache().find({ queryKey: ['client', 'c1'] }),
    ).toBeDefined();
  });
});

describe('useClientRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps envelope items to a plain array', async () => {
    vi.mocked(getRecords).mockResolvedValue(envelope(recordsFixture));

    const { useClientRecords } = await import('@/hooks/useClient');
    const { result } = renderHook(() => useClientRecords('c1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getRecords).toHaveBeenCalledWith({ client_id: 'c1', per_page: 100 });
    expect(result.current.data).toEqual(recordsFixture);
  });

  it('does not fetch when id is undefined', async () => {
    const { useClientRecords } = await import('@/hooks/useClient');
    const { result } = renderHook(() => useClientRecords(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getRecords).not.toHaveBeenCalled();
  });

  it('does not fetch when enabled=false', async () => {
    const { useClientRecords } = await import('@/hooks/useClient');
    const { result } = renderHook(() => useClientRecords('c1', false), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getRecords).not.toHaveBeenCalled();
  });
});

// ─── usePaymentTotals (#140) ────────────────────────────────────────────────

describe('usePaymentTotals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled for an empty ids array', async () => {
    const { usePaymentTotals } = await import('@/hooks/usePayments');
    const { result } = renderHook(() => usePaymentTotals([]), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getPaymentTotals).not.toHaveBeenCalled();
  });

  it('fetches totals for the given record ids', async () => {
    vi.mocked(getPaymentTotals).mockResolvedValue({ r1: 500 });

    const { usePaymentTotals } = await import('@/hooks/usePayments');
    const { result } = renderHook(() => usePaymentTotals(['r1']), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getPaymentTotals).toHaveBeenCalledWith(['r1']);
    expect(result.current.data).toEqual({ r1: 500 });
  });
});

// ─── useTagsRaw (#140) ──────────────────────────────────────────────────────

describe('useTagsRaw', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches all tags under the ["tags"] key', async () => {
    vi.mocked(getAllTags).mockResolvedValue(tagsFixture);
    const queryClient = createTestQueryClient();

    const { useTagsRaw } = await import('@/hooks/useTags');
    const { result } = renderHook(() => useTagsRaw(), {
      wrapper: createWrapperWithClient(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getAllTags).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual(tagsFixture);
    expect(queryClient.getQueryCache().find({ queryKey: ['tags'] })).toBeDefined();
  });
});

// ─── useActivity / useActivityRecords / useActivitiesForRecords (#140) ─────

describe('useActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches a single activity when id is set', async () => {
    vi.mocked(getActivity).mockResolvedValue(activitiesFixture[0]);

    const { useActivity } = await import('@/hooks/useActivities');
    const { result } = renderHook(() => useActivity('a1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getActivity).toHaveBeenCalledWith('a1');
    expect(result.current.data).toEqual(activitiesFixture[0]);
  });

  it('does not fetch when id is undefined', async () => {
    const { useActivity } = await import('@/hooks/useActivities');
    const { result } = renderHook(() => useActivity(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getActivity).not.toHaveBeenCalled();
  });
});

describe('useActivityRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps envelope items to a plain array', async () => {
    vi.mocked(getRecords).mockResolvedValue(envelope(recordsFixture));

    const { useActivityRecords } = await import('@/hooks/useActivities');
    const { result } = renderHook(() => useActivityRecords('a1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getRecords).toHaveBeenCalledWith({ activity_id: 'a1', per_page: 100 });
    expect(result.current.data).toEqual(recordsFixture);
  });

  it('does not fetch when activityId is undefined', async () => {
    const { useActivityRecords } = await import('@/hooks/useActivities');
    const { result } = renderHook(() => useActivityRecords(undefined), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getRecords).not.toHaveBeenCalled();
  });
});

describe('useActivitiesForRecords', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('is disabled for an empty ids array', async () => {
    const { useActivitiesForRecords } = await import('@/hooks/useActivities');
    const { result } = renderHook(() => useActivitiesForRecords([]), { wrapper: createWrapper() });

    expect(result.current.fetchStatus).toBe('idle');
    expect(getActivity).not.toHaveBeenCalled();
  });

  it('calls getActivity once per id', async () => {
    vi.mocked(getActivity).mockResolvedValue(activitiesFixture[0]);

    const { useActivitiesForRecords } = await import('@/hooks/useActivities');
    const { result } = renderHook(() => useActivitiesForRecords(['a1', 'a2']), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getActivity).toHaveBeenCalledTimes(2);
    expect(getActivity).toHaveBeenCalledWith('a1');
    expect(getActivity).toHaveBeenCalledWith('a2');
    expect(result.current.data).toHaveLength(2);
  });
});

// ─── Raw/lookup dedupe pins (#140): shared keys MUST dedupe ────────────────

describe('raw/lookup hooks share a cache key (dedupe pins)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useMasters + useMastersRaw share ["masters"]', async () => {
    vi.mocked(getAllMasters).mockResolvedValue(mastersFixture);
    const queryClient = createTestQueryClient();

    const { useMasters, useMastersRaw } = await import('@/hooks/useMasters');
    const { result } = renderHook(
      () => ({ lookup: useMasters(), raw: useMastersRaw() }),
      { wrapper: createWrapperWithClient(queryClient) },
    );

    await waitFor(() => expect(result.current.lookup.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.raw.isSuccess).toBe(true));

    expect(queryClient.getQueryCache().find({ queryKey: ['masters'] })).toBeDefined();
    // Dedupe: one shared key ⇒ one fetch for both observers.
    expect(getAllMasters).toHaveBeenCalledOnce();
    expect(result.current.raw.data).toEqual(mastersFixture);
  });

  it('useServices + useServicesRaw share ["services"]', async () => {
    vi.mocked(getAllServices).mockResolvedValue(servicesFixture);
    const queryClient = createTestQueryClient();

    const { useServices, useServicesRaw } = await import('@/hooks/useServices');
    const { result } = renderHook(
      () => ({ lookup: useServices(), raw: useServicesRaw() }),
      { wrapper: createWrapperWithClient(queryClient) },
    );

    await waitFor(() => expect(result.current.lookup.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.raw.isSuccess).toBe(true));

    expect(queryClient.getQueryCache().find({ queryKey: ['services'] })).toBeDefined();
    expect(getAllServices).toHaveBeenCalledOnce();
    expect(result.current.raw.data).toEqual(servicesFixture);
  });

  it('useLocations + useLocationsRaw share ["locations"]', async () => {
    vi.mocked(getAllLocations).mockResolvedValue(locationsFixture);
    const queryClient = createTestQueryClient();

    const { useLocations, useLocationsRaw } = await import('@/hooks/useLocations');
    const { result } = renderHook(
      () => ({ lookup: useLocations(), raw: useLocationsRaw() }),
      { wrapper: createWrapperWithClient(queryClient) },
    );

    await waitFor(() => expect(result.current.lookup.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.raw.isSuccess).toBe(true));

    expect(queryClient.getQueryCache().find({ queryKey: ['locations'] })).toBeDefined();
    expect(getAllLocations).toHaveBeenCalledOnce();
    expect(result.current.raw.data).toEqual(locationsFixture);
  });
});
