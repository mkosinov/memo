import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// ─── Mock api-client ───────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getRecord: vi.fn(),
  getClientVisitors: vi.fn(),
  getActivity: vi.fn(),
  getServices: vi.fn(),
  getMasters: vi.fn(),
  getLocations: vi.fn(),
  getPayments: vi.fn(),
}));

import {
  getRecord,
  getClientVisitors,
  getActivity,
  getServices,
  getMasters,
  getLocations,
  getPayments,
} from '@memo/api-client';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const mockRecord = {
  id: 'r1',
  activity_id: 'ev_1',
  client_id: 'c1',
  status: 'confirmed',
  seats: 1,
  comment: null,
  custom_price: null,
  created_at: '2026-05-10T10:00:00',
  updated_at: '2026-05-10T10:00:00',
  is_active: true,
  visits: [
    {
      id: 'v1',
      record_id: 'r1',
      visitor_id: 'vis1',
      price: 3500,
      custom_price: null,
      status: 'waiting',
      created_at: '',
      updated_at: '',
      is_active: true,
    },
  ],
};

const mockVisitors = [
  { id: 'vis1', client_id: 'c1', name: 'Анна Иванова', age: 30, created_at: '', updated_at: '', is_active: true },
  { id: 'vis2', client_id: 'c1', name: 'Мария Петрова', age: 25, created_at: '', updated_at: '', is_active: true },
];

const mockActivity = {
  id: 'ev_1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'loc1',
  start: '2026-05-15T14:00:00',
  duration: 150,
  capacity: 8,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2026-05-01T00:00:00',
  updated_at: '2026-05-01T00:00:00',
  is_active: true,
  occupied: 3,
};

const mockServices = [
  {
    id: 's1',
    title: 'Картина маслом',
    description: 'Рисуем картину маслом',
    image_url: '',
    specialty: 'живопись',
    min_age: 6,
    max_age: 99,
    duration: 150,
    record_info: '',
    tariffs: [
      { id: 't1', service_id: 's1', title: 'Взрослый', price: 3500, description: null },
      { id: 't2', service_id: 's1', title: 'Детский', price: 2500, description: null },
    ],
    tags: [],
    is_active: true,
    created_at: '',
    updated_at: '',
  },
];

const mockMasters = [
  { id: 'm1', first_name: 'Ольга', last_name: 'Середа', color: '#5B8C7A', position: 'artist', specialty: 'живопись', avatar_url: null, is_active: true, created_at: '', updated_at: '' },
];

const mockLocations = [
  { id: 'loc1', name: 'Альпика', address: 'Альпика, 1 этаж', description: null, capacity: 20, yandex_map_url: null, review_url: null, record_info: null, image_url: null, is_active: true, created_at: '', updated_at: '' },
];

const mockPayments = [
  { id: 'p1', record_id: 'r1', amount: 1500, method: 'card', created_at: '', updated_at: '' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function envelope<T>(items: T[]) {
  return { items, total: items.length, page: 1, per_page: 100 };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('useRecordData', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getRecord).mockResolvedValue(mockRecord as any);
    vi.mocked(getClientVisitors).mockResolvedValue(mockVisitors as any);
    vi.mocked(getActivity).mockResolvedValue(mockActivity as any);
    vi.mocked(getServices).mockResolvedValue(envelope(mockServices) as any);
    vi.mocked(getMasters).mockResolvedValue(envelope(mockMasters) as any);
    vi.mocked(getLocations).mockResolvedValue(envelope(mockLocations) as any);
    vi.mocked(getPayments).mockResolvedValue(envelope(mockPayments) as any);
  });

  it('exports useRecordData function', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    expect(typeof useRecordData).toBe('function');
  });

  it('returns record data after loading', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.record).toBeDefined();
    expect(result.current.record?.id).toBe('r1');
  });

  it('calls getRecord with recordId', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(getRecord).toHaveBeenCalledWith('r1'));
  });

  it('calls getClientVisitors with clientId', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(getClientVisitors).toHaveBeenCalledWith('c1'));
  });

  it('calls getActivity with activity_id from record', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(getActivity).toHaveBeenCalledWith('ev_1'));
  });

  it('calls getServices', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(getServices).toHaveBeenCalled());
  });

  it('calls getMasters', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(getMasters).toHaveBeenCalled());
  });

  it('calls getLocations', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(getLocations).toHaveBeenCalled());
  });

  it('calls getPayments with record_id', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(getPayments).toHaveBeenCalledWith({ record_id: 'r1', per_page: 100 }));
  });

  it('returns visitors array', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.visitors).toHaveLength(2);
  });

  it('returns visitorsMap keyed by visitor id', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.visitorsMap.get('vis1')).toEqual({ name: 'Анна Иванова', age: 30 });
    expect(result.current.visitorsMap.get('vis2')).toEqual({ name: 'Мария Петрова', age: 25 });
  });

  it('returns tariffs from the matching service', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tariffs).toHaveLength(2);
    expect(result.current.tariffs[0].title).toBe('Взрослый');
  });

  it('returns masters array', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.masters).toHaveLength(1);
    expect(result.current.masters[0].first_name).toBe('Ольга');
  });

  it('returns locations array', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.locations).toHaveLength(1);
    expect(result.current.locations[0].name).toBe('Альпика');
  });

  it('returns payments array', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.payments).toHaveLength(1);
    expect(result.current.payments[0].amount).toBe(1500);
  });

  it('returns activity data', async () => {
    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.activity).toBeDefined();
    expect(result.current.activity?.id).toBe('ev_1');
  });

  it('returns empty tariffs when no service matches', async () => {
    vi.mocked(getActivity).mockResolvedValue({
      ...mockActivity,
      service_id: 'nonexistent',
    } as any);

    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.tariffs).toEqual([]);
  });

  it('returns empty visitorsMap when visitors is empty', async () => {
    vi.mocked(getClientVisitors).mockResolvedValue([] as any);

    const { useRecordData } = await import('@/hooks/useRecordData');
    const { result } = renderHook(
      () => useRecordData('r1', 'c1'),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.visitorsMap.size).toBe(0);
  });
});
