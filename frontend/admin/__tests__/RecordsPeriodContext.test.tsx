/**
 * Tests for RecordsContext — #138 Task 5: the records period comes from the
 * URL (?from=&to=) via useRecordsPeriod, NOT NavigationContext.
 *
 * Invariants:
 *  - no params → the query key carries monday..sunday of the current week
 *    (SAME 'YYYY-MM-DD' string format as the legacy NavigationContext keys —
 *    cache keys must stay byte-identical)
 *  - explicit ?from&to → the key carries those strings verbatim
 *  - setPeriod writes ?from=&to= via router.replace
 *  - the date-range change resets page to 1 (kept from NavigationContext era)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
vi.mock('@memo/api-client', () => ({
  getRecordsView: vi.fn(),
}));

import { getRecordsView } from '@memo/api-client';
import { __resetNavigation, __currentQuery } from './helpers/nextNavigationMock';
import { getMonday, toISODate } from '@/lib/datetime';
import { RecordsProvider, useRecords } from '../contexts/RecordsContext';

function envelope<T>(items: T[]) {
  return { items, total: items.length, page: 1, per_page: 10 };
}

/** Current week's monday..sunday in ISO — the no-params default key range. */
function expectedDefaultRange(): { from: string; to: string } {
  const monday = getMonday(new Date());
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { from: toISODate(monday), to: toISODate(sunday) };
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRecordsView).mockResolvedValue(envelope([]));
  __resetNavigation('', '/records');
});

describe('RecordsContext — URL period (?from=&to=, #138 Task 5)', () => {
  it('invariant: no params → key range = monday..sunday of the current week', async () => {
    const { queryClient, Wrapper } = createWrapper();
    renderHook(() => useRecords(), { wrapper: Wrapper });

    const def = expectedDefaultRange();
    await waitFor(() => {
      expect(queryClient.getQueryData(['records', 1, 10, def.from, def.to,
        { locationId: '', serviceId: '', masterId: '', status: '', search: '' },
        'date', 'asc'])).toBeDefined();
    });
  });

  it('explicit ?from&to → the key carries those strings verbatim', async () => {
    __resetNavigation('?from=2026-02-01&to=2026-02-28', '/records');
    const { queryClient, Wrapper } = createWrapper();
    renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(queryClient.getQueryData(['records', 1, 10, '2026-02-01', '2026-02-28',
        { locationId: '', serviceId: '', masterId: '', status: '', search: '' },
        'date', 'asc'])).toBeDefined();
    });
    // and the fetcher got them
    await waitFor(() => {
      expect(vi.mocked(getRecordsView)).toHaveBeenCalledWith(
        expect.objectContaining({ date_from: '2026-02-01', date_to: '2026-02-28' }),
      );
    });
  });

  it('from > to in the URL → BOTH sides fall back to the default week', async () => {
    __resetNavigation('?from=2026-03-10&to=2026-03-01', '/records');
    const { queryClient, Wrapper } = createWrapper();
    renderHook(() => useRecords(), { wrapper: Wrapper });

    const def = expectedDefaultRange();
    await waitFor(() => {
      expect(queryClient.getQueryData(['records', 1, 10, def.from, def.to,
        { locationId: '', serviceId: '', masterId: '', status: '', search: '' },
        'date', 'asc'])).toBeDefined();
    });
  });

  it('exposes setPeriod writing ?from=&to= (replace)', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getRecordsView)).toHaveBeenCalled();
    });

    act(() => result.current.setPeriod('2026-02-01', '2026-02-28'));

    expect(__currentQuery()).toBe('?from=2026-02-01&to=2026-02-28');
  });

  it('a period change (setPeriod → new URL) resets page to 1', async () => {
    const { Wrapper } = createWrapper();
    const { result } = renderHook(() => useRecords(), { wrapper: Wrapper });

    await waitFor(() => {
      expect(vi.mocked(getRecordsView)).toHaveBeenCalled();
    });

    act(() => result.current.setPage(3));
    await waitFor(() => {
      expect(result.current.page).toBe(3);
    });

    // Commit the navigation: the mocked router updates searchParams → the
    // context re-renders with the new period.
    act(() => result.current.setPeriod('2026-02-01', '2026-02-28'));
    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });
  });
});
