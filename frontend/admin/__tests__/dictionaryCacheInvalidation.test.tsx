/**
 * Cross-granularity cache invalidation for dictionaries (#205 §5.5).
 *
 * After the table migrations (#205 T7–T11), each dictionary has TWO cache
 * granularities under the same key prefix:
 *  - the `/all` lookup cache:        ['masters']
 *  - the paged table cache:          ['masters', page, perPage, status, sortBy, sortOrder]
 *
 * Mutations invalidate via `invalidateQueries({ queryKey: ['masters'] })`.
 * react-query's array-prefix matching must refetch BOTH the lookup cache and
 * the table cache in one call — this test pins that behaviour.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const TABLE_KEY = ['masters', 1, 10, 'active', 'name', 'asc'] as const;

describe('dictionary cache invalidation — cross-granularity prefix matching (#205 T12)', () => {
  it('invalidateQueries({ queryKey: ["masters"] }) refetches both lookup and table caches', async () => {
    const lookupFetcher = vi.fn().mockResolvedValue([{ id: 'm1' }]);
    const tableFetcher = vi
      .fn()
      .mockResolvedValue({ items: [{ id: 'm1' }], total: 1, page: 1, per_page: 10 });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 5 * 60 * 1000 },
      },
    });

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
    }

    renderHook(
      () => {
        const lookup = useQuery({ queryKey: ['masters'], queryFn: lookupFetcher });
        const table = useQuery({ queryKey: TABLE_KEY, queryFn: tableFetcher });
        return { lookup, table };
      },
      { wrapper: Wrapper },
    );

    // Wait for the initial fetch of both granularities (lookup map + table page)
    await waitFor(() => {
      expect(lookupFetcher).toHaveBeenCalledTimes(1);
      expect(tableFetcher).toHaveBeenCalledTimes(1);
    });

    // Mutation-style invalidation by prefix
    await queryClient.invalidateQueries({ queryKey: ['masters'] });

    // Both granularities must have refetched (array-prefix matching)
    await waitFor(() => {
      expect(lookupFetcher).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(tableFetcher).toHaveBeenCalledTimes(2);
    });

    // Both cache entries stay correct (keys unchanged)
    expect(queryClient.getQueryData(['masters'])).toEqual([{ id: 'm1' }]);
    expect(queryClient.getQueryData(TABLE_KEY)).toMatchObject({ items: [{ id: 'm1' }] });
  });
});
