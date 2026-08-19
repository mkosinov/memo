import { vi } from 'vitest';
import type { PagedListState } from '@/app/components/shared/tableTypes';

/**
 * Fixture factory for the DataTable unit suite (#139 T1, spec §8 "new layer").
 *
 * Returns a complete `PagedListState<T>` with `vi.fn()` setters/refetch. Pass
 * `items` plus any overrides via `Partial<PagedListState<T>>` (e.g.
 * `isPending: true`, `error: new Error('boom')`).
 *
 * Defaults: total = items.length, page 1, perPage 10, sortBy null,
 * sortOrder 'asc', all load flags false, error null.
 */
export function makeTableState<T>(
  overrides: Partial<PagedListState<T>> & { items: T[] },
): PagedListState<T> {
  const { items, ...rest } = overrides;
  return {
    items,
    total: items.length,
    page: 1,
    perPage: 10,
    sortBy: null,
    sortOrder: 'asc',
    isPending: false,
    isLoading: false,
    isFetching: false,
    error: null,
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setSort: vi.fn(),
    refetch: vi.fn(),
    ...rest,
  };
}
