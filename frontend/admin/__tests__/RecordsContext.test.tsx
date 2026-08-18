/**
 * Tests for RecordsContext — server-driven page/perPage/filters/sort state
 * plus the seedRecordFromList wiring.
 *
 * The provider fetches a server-driven envelope:
 *   ['records', page, perPage, dateFrom, dateTo, filters, sortBy, sortOrder]
 * When the list resolves, each record must be seeded into the canonical
 * `['record', id]` cache (only if absent — fresher entries are preserved).
 *
 * This avoids a redundant `getRecord(recordId)` call the first time a
 * record is opened from the schedule/records list (spec §2.1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mock api-client ──────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getRecords: vi.fn(),
  getClients: vi.fn(),
  getPaymentTotals: vi.fn(),
  getPayments: vi.fn(),
  getActivities: vi.fn(),
  getMasters: vi.fn(),
  getServices: vi.fn(),
  getLocations: vi.fn(),
  getAllMasters: vi.fn(),
  getAllServices: vi.fn(),
  getAllLocations: vi.fn(),
}));

import {
  getRecords,
  getClients,
  getPaymentTotals,
  getPayments,
  getActivities,
  getMasters,
  getServices,
  getLocations,
  getAllMasters,
  getAllServices,
  getAllLocations,
} from '@memo/api-client';
import type {
  PaginatedResponse,
  RecordResponse,
  VisitResponse,
} from '@memo/api-client';

// ─── Mock NavigationContext (provides dateFrom/dateTo) ────────────────────

vi.mock('@/contexts/NavigationContext', () => ({
  useNavigation: vi.fn(() => ({
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    selectDateRange: vi.fn(),
  })),
}));

import { useNavigation } from '@/contexts/NavigationContext';

const mockUseNavigation = vi.mocked(useNavigation);

import { RecordsProvider, useRecords } from '../contexts/RecordsContext';

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeVisit(id: string, overrides: Partial<VisitResponse> = {}): VisitResponse {
  return {
    id,
    record_id: 'r1',
    visitor_id: null,
    tariff_id: 't1',
    price: 3500,
    custom_price: null,
    status: 'waiting',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function makeRecord(
  id: string,
  overrides: Partial<RecordResponse> = {},
): RecordResponse {
  return {
    id,
    activity_id: 'ev_1',
    client_id: 'c1',
    status: 'confirmed',
    seats: 1,
    anonym_visits: 0,
    comment: null,
    custom_price: null,
    created_at: '2026-01-15T10:00:00',
    updated_at: '2026-01-15T10:00:00',
    visits: [makeVisit('v1', { record_id: id })],
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function envelope<T>(items: T[]) {
  return { items, total: items.length, page: 1, per_page: 10 };
}

const DEFAULT_RECORDS_KEY = [
  'records',
  1,
  10,
  '2026-01-01',
  '2026-01-31',
  { locationId: '', serviceId: '', masterId: '', status: '' },
  'date',
  'asc',
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <RecordsProvider>{children}</RecordsProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper, queryClient };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('RecordsContext — canonical cache seeding', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseNavigation.mockReturnValue({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      selectDateRange: vi.fn(),
    } as unknown as ReturnType<typeof useNavigation>);

    vi.mocked(getRecords).mockResolvedValue(envelope([]));
    vi.mocked(getClients).mockResolvedValue([]);
    vi.mocked(getPaymentTotals).mockResolvedValue({});
    vi.mocked(getActivities).mockResolvedValue(envelope([]));
    vi.mocked(getAllMasters).mockResolvedValue([]);
    vi.mocked(getAllServices).mockResolvedValue([]);
    vi.mocked(getAllLocations).mockResolvedValue([]);
  });

  it('seeds canonical ["record", id] from list response after query resolves', async () => {
    const rec1 = makeRecord('r1');
    vi.mocked(getRecords).mockResolvedValue(envelope([rec1]));

    const { Wrapper, queryClient } = createWrapper();

    renderHook(() => useRecords(), { wrapper: Wrapper });

    // Wait until the records list query has resolved
    await waitFor(() => {
      expect(
        queryClient.getQueryData<PaginatedResponse<RecordResponse>>(DEFAULT_RECORDS_KEY),
      ).toBeDefined();
    });

    // Canonical key must be populated by the seed effect
    expect(queryClient.getQueryData<RecordResponse>(['record', 'r1'])).toEqual(rec1);
  });

  it('does NOT overwrite an already-present ["record", id] entry (fresher data wins)', async () => {
    const rec1 = makeRecord('r1', { status: 'confirmed' });
    vi.mocked(getRecords).mockResolvedValue(envelope([rec1]));

    const { Wrapper, queryClient } = createWrapper();

    // Pre-seed canonical with a fresher entry (e.g. from a getRecord call)
    const fresher = makeRecord('r1', { status: 'visited' });
    queryClient.setQueryData(['record', 'r1'], fresher);

    renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<PaginatedResponse<RecordResponse>>(DEFAULT_RECORDS_KEY),
      ).toBeDefined();
    });

    // Fresher canonical entry must be preserved
    expect(queryClient.getQueryData<RecordResponse>(['record', 'r1'])?.status).toBe(
      'visited',
    );
  });

  it('fetches masters/services/locations lookups via getAllX, not paginated get (#205 T12)', async () => {
    const { Wrapper, queryClient } = createWrapper();

    renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getAllMasters)).toHaveBeenCalled();
      expect(vi.mocked(getAllServices)).toHaveBeenCalled();
      expect(vi.mocked(getAllLocations)).toHaveBeenCalled();
    });

    // Lookup cache keys must be unchanged
    await waitFor(() => {
      expect(queryClient.getQueryData(['masters'])).toBeDefined();
      expect(queryClient.getQueryData(['services'])).toBeDefined();
      expect(queryClient.getQueryData(['locations'])).toBeDefined();
    });

    // Paginated dictionary lookups must not be used
    expect(vi.mocked(getMasters)).not.toHaveBeenCalled();
    expect(vi.mocked(getServices)).not.toHaveBeenCalled();
    expect(vi.mocked(getLocations)).not.toHaveBeenCalled();
  });

  it('seeds multiple records from a multi-item list response', async () => {
    const rec1 = makeRecord('r1');
    const rec2 = makeRecord('r2');
    vi.mocked(getRecords).mockResolvedValue(envelope([rec1, rec2]));

    const { Wrapper, queryClient } = createWrapper();

    renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(
        queryClient.getQueryData<PaginatedResponse<RecordResponse>>(DEFAULT_RECORDS_KEY),
      ).toBeDefined();
    });

    expect(queryClient.getQueryData<RecordResponse>(['record', 'r1'])).toEqual(rec1);
    expect(queryClient.getQueryData<RecordResponse>(['record', 'r2'])).toEqual(rec2);
  });
});

describe('RecordsContext — payment totals aggregate', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseNavigation.mockReturnValue({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      selectDateRange: vi.fn(),
    } as unknown as ReturnType<typeof useNavigation>);

    vi.mocked(getRecords).mockResolvedValue(envelope([]));
    vi.mocked(getClients).mockResolvedValue([]);
    vi.mocked(getPaymentTotals).mockResolvedValue({ 'rec-1': 3000 });
    vi.mocked(getActivities).mockResolvedValue(envelope([]));
    vi.mocked(getAllMasters).mockResolvedValue([]);
    vi.mocked(getAllServices).mockResolvedValue([]);
    vi.mocked(getAllLocations).mockResolvedValue([]);
  });

  it('fetches payment totals for loaded record IDs', async () => {
    const rec1 = makeRecord('rec-1');
    const rec2 = makeRecord('rec-2');
    vi.mocked(getRecords).mockResolvedValue(envelope([rec2, rec1]));

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getPaymentTotals)).toHaveBeenCalled();
    });

    // IDs must be sorted
    expect(vi.mocked(getPaymentTotals)).toHaveBeenCalledWith(['rec-1', 'rec-2']);

    await waitFor(() => {
      expect(result.current.payments.get('rec-1')).toBe(3000);
    });
  });

  it('does not fetch totals when no records loaded', async () => {
    const { Wrapper } = createWrapper();
    renderHook(() => useRecords(), { wrapper: Wrapper });

    // Give queries a chance to settle
    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenCalled();
    });

    expect(vi.mocked(getPaymentTotals)).not.toHaveBeenCalled();
  });

  it('record without payments has no entry in the map', async () => {
    const rec1 = makeRecord('rec-1');
    const recWithout = makeRecord('rec-without');
    vi.mocked(getRecords).mockResolvedValue(envelope([rec1, recWithout]));

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.payments.get('rec-1')).toBe(3000);
    });

    expect(result.current.payments.get('rec-without')).toBeUndefined();
  });

  it('never calls unfiltered getPayments for payment status (uses getPaymentTotals only)', async () => {
    const rec1 = makeRecord('rec-1');
    vi.mocked(getRecords).mockResolvedValue(envelope([rec1]));

    const { Wrapper } = createWrapper();
    renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getPaymentTotals)).toHaveBeenCalled();
    });

    // Regression #186: context must use the aggregate endpoint, not the per_page-capped list
    expect(vi.mocked(getPayments)).not.toHaveBeenCalled();
  });
});

describe('RecordsContext — server-driven page/filters/sort state (#191)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUseNavigation.mockReturnValue({
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      selectDateRange: vi.fn(),
    } as unknown as ReturnType<typeof useNavigation>);

    vi.mocked(getRecords).mockResolvedValue(envelope([]));
    vi.mocked(getClients).mockResolvedValue([]);
    vi.mocked(getPaymentTotals).mockResolvedValue({});
    vi.mocked(getActivities).mockResolvedValue(envelope([]));
    vi.mocked(getAllMasters).mockResolvedValue([]);
    vi.mocked(getAllServices).mockResolvedValue([]);
    vi.mocked(getAllLocations).mockResolvedValue([]);
  });

  it('passes all server params with snake_case mapping', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenCalled();
    });

    act(() => {
      result.current.setFilters({ locationId: 'loc-1' });
    });

    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          per_page: 10,
          date_from: '2026-01-01',
          date_to: '2026-01-31',
          location_id: 'loc-1',
          sort_by: 'date',
          sort_order: 'asc',
        }),
      );
    });
  });

  it('setFilters resets page to 1', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenCalled();
    });

    act(() => {
      result.current.setPage(3);
    });

    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3 }),
      );
    });

    act(() => {
      result.current.setFilters({ status: 'waiting' });
    });

    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, status: 'waiting' }),
      );
    });
    expect(result.current.page).toBe(1);
  });

  it('date-range change resets page to 1', async () => {
    const { Wrapper } = createWrapper();
    const { result, rerender } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenCalled();
    });

    act(() => {
      result.current.setPage(3);
    });

    await waitFor(() => {
      expect(result.current.page).toBe(3);
    });

    mockUseNavigation.mockReturnValue({
      dateFrom: '2026-02-01',
      dateTo: '2026-02-28',
      selectDateRange: vi.fn(),
    } as unknown as ReturnType<typeof useNavigation>);

    rerender();

    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });
  });

  it('setPerPage resets page to 1', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenCalled();
    });

    act(() => {
      result.current.setPage(3);
    });

    await waitFor(() => {
      expect(result.current.page).toBe(3);
    });

    act(() => {
      result.current.setPerPage(50);
    });

    expect(result.current.page).toBe(1);
    expect(result.current.perPage).toBe(50);
  });

  it('setSort toggles order on same field, resets to asc on new field', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getRecords)).toHaveBeenCalled();
    });

    act(() => {
      result.current.setSort('status');
    });
    expect(result.current.sortBy).toBe('status');
    expect(result.current.sortOrder).toBe('asc');

    act(() => {
      result.current.setSort('status');
    });
    expect(result.current.sortBy).toBe('status');
    expect(result.current.sortOrder).toBe('desc');

    act(() => {
      result.current.setSort('date');
    });
    expect(result.current.sortBy).toBe('date');
    expect(result.current.sortOrder).toBe('asc');
  });

  it('exposes server total', async () => {
    const rec1 = makeRecord('r1');
    vi.mocked(getRecords).mockResolvedValue({
      items: [rec1],
      total: 42,
      page: 1,
      per_page: 10,
    });

    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(result.current.total).toBe(42);
    });
  });
});
