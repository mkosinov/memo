/**
 * Tests for RecordsContext — specifically the seedRecordFromList wiring.
 *
 * The provider fetches a date-bounded list `['records', dateFrom, dateTo]`.
 * When the list resolves, each record must be seeded into the canonical
 * `['record', id]` cache (only if absent — fresher entries are preserved).
 *
 * This avoids a redundant `getRecord(recordId)` call the first time a
 * record is opened from the schedule/records list (spec §2.1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ─── Mock api-client ──────────────────────────────────────────────────────

vi.mock('@memo/api-client', () => ({
  getRecords: vi.fn(),
  getClients: vi.fn(),
  getPayments: vi.fn(),
  getActivities: vi.fn(),
  getMasters: vi.fn(),
  getServices: vi.fn(),
  getLocations: vi.fn(),
}));

import {
  getRecords,
  getClients,
  getPayments,
  getActivities,
  getMasters,
  getServices,
  getLocations,
} from '@memo/api-client';
import type {
  RecordResponse,
  VisitResponse,
} from '@memo/api-client';

// ─── Mock NavigationContext (provides dateFrom/dateTo) ────────────────────

vi.mock('@/contexts/NavigationContext', () => ({
  useNavigation: () => ({
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    selectDateRange: vi.fn(),
  }),
}));

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
    is_active: true,
    visits: [makeVisit('v1', { record_id: id })],
    ...overrides,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function envelope<T>(items: T[]) {
  return { items, total: items.length, page: 1, per_page: 100 };
}

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

    vi.mocked(getRecords).mockResolvedValue(envelope([]));
    vi.mocked(getClients).mockResolvedValue([]);
    vi.mocked(getPayments).mockResolvedValue(envelope([]));
    vi.mocked(getActivities).mockResolvedValue(envelope([]));
    vi.mocked(getMasters).mockResolvedValue(envelope([]));
    vi.mocked(getServices).mockResolvedValue(envelope([]));
    vi.mocked(getLocations).mockResolvedValue(envelope([]));
  });

  it('seeds canonical ["record", id] from list response after query resolves', async () => {
    const rec1 = makeRecord('r1');
    vi.mocked(getRecords).mockResolvedValue(envelope([rec1]));

    const { Wrapper, queryClient } = createWrapper();

    renderHook(() => useRecords(), { wrapper: Wrapper });

    // Wait until the records list query has resolved
    await waitFor(() => {
      expect(queryClient.getQueryData<RecordResponse[]>(['records', '2026-01-01', '2026-01-31'])).toBeDefined();
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
      expect(queryClient.getQueryData<RecordResponse[]>(['records', '2026-01-01', '2026-01-31'])).toBeDefined();
    });

    // Fresher canonical entry must be preserved
    expect(queryClient.getQueryData<RecordResponse>(['record', 'r1'])?.status).toBe(
      'visited',
    );
  });

  it('seeds multiple records from a multi-item list response', async () => {
    const rec1 = makeRecord('r1');
    const rec2 = makeRecord('r2');
    vi.mocked(getRecords).mockResolvedValue(envelope([rec1, rec2]));

    const { Wrapper, queryClient } = createWrapper();

    renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(queryClient.getQueryData<RecordResponse[]>(['records', '2026-01-01', '2026-01-31'])).toBeDefined();
    });

    expect(queryClient.getQueryData<RecordResponse>(['record', 'r1'])).toEqual(rec1);
    expect(queryClient.getQueryData<RecordResponse>(['record', 'r2'])).toEqual(rec2);
  });
});
