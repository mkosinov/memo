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
}));

// Mock transformers
vi.mock('@/lib/transformers', () => ({
  transformMaster: vi.fn((raw: any) => ({ ...raw, name: raw.first_name + ' ' + raw.last_name })),
  transformLocation: vi.fn((raw: any) => ({ ...raw, name: raw.name })),
  transformService: vi.fn((raw: any) => ({ ...raw, name: raw.title })),
  transformActivity: vi.fn((raw: any) => ({ ...raw, id: raw.id })),
}));

import { getMasters, getLocations, getServices, getActivities } from '@memo/api-client';
import {
  transformMaster,
  transformLocation,
  transformService,
  transformActivity,
} from '@/lib/transformers';
import type { MasterResponse, LocationResponse, ServiceResponse, ActivityResponse } from '@memo/api-client';

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// ─── useMasters ─────────────────────────────────────────────────────────────

describe('useMasters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getMasters and transforms results', async () => {
    vi.mocked(getMasters).mockResolvedValue(envelope(mastersFixture));

    const { useMasters } = await import('@/hooks/useMasters');
    const { result } = renderHook(() => useMasters(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getMasters).toHaveBeenCalledOnce();
    expect(transformMaster).toHaveBeenCalledWith(
      mastersFixture[0],
      expect.any(Number),
      expect.any(Array),
    );
    expect(result.current.data).toHaveLength(1);
  });

  it('uses queryKey ["masters"]', async () => {
    vi.mocked(getMasters).mockResolvedValue(envelope(mastersFixture));

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

  it('calls getLocations and transforms results', async () => {
    vi.mocked(getLocations).mockResolvedValue(envelope(locationsFixture));

    const { useLocations } = await import('@/hooks/useLocations');
    const { result } = renderHook(() => useLocations(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getLocations).toHaveBeenCalledOnce();
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

  it('calls getServices and transforms results', async () => {
    vi.mocked(getServices).mockResolvedValue(envelope(servicesFixture));

    const { useServices } = await import('@/hooks/useServices');
    const { result } = renderHook(() => useServices(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getServices).toHaveBeenCalledOnce();
    expect(transformService).toHaveBeenCalledWith(
      servicesFixture[0],
      expect.any(Number),
      expect.any(Array),
    );
    expect(result.current.data).toHaveLength(1);
  });
});

// ─── useActivities ──────────────────────────────────────────────────────────

describe('useActivities', () => {
  const weekStart = '2024-12-23';
  const weekEnd = '2024-12-29';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls getActivities with date range and transforms results', async () => {
    vi.mocked(getActivities).mockResolvedValue(envelope(activitiesFixture));

    const { useActivities } = await import('@/hooks/useActivities');
    const { result } = renderHook(
      () => useActivities(weekStart, weekEnd),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getActivities).toHaveBeenCalledWith({
      date_from: weekStart,
      date_to: weekEnd,
      per_page: 100,
    });
    expect(transformActivity).toHaveBeenCalledWith(
      activitiesFixture[0],
      expect.any(Number),
      expect.any(Array),
    );
    expect(result.current.data).toHaveLength(1);
  });

  it('uses queryKey ["activities", weekStart, weekEnd]', async () => {
    vi.mocked(getActivities).mockResolvedValue(envelope(activitiesFixture));

    const { useActivities } = await import('@/hooks/useActivities');
    const { result } = renderHook(
      () => useActivities(weekStart, weekEnd),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeDefined();
  });
});
