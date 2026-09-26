import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import { StrictMode } from 'react';
import { useTableUrlState, type TableUrlConfig } from '../hooks/useTableUrlState';

// #349: useTableUrlState — URL as source of truth for admin table pages.
// Read: silent fallbacks per preset. Write: update() is the single writer —
// atomic batch, coalesced into one navigation, defaults stripped,
// unmanaged params preserved.

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  usePathname: () => '/records',
}));

// Full config: every preset kind + page/per_page + sort linkage.
const CONFIG = {
  status: { kind: 'enum', values: ['all', 'confirmed', 'cancelled'], defaultValue: 'all' },
  search: { kind: 'string', maxLength: 200, defaultValue: '' },
  page: { kind: 'int', min: 1, max: 10000, defaultValue: 1 },
  per_page: { kind: 'enum', values: [10, 20, 50, 100], defaultValue: 20 },
  sort_by: { kind: 'string', maxLength: 200, defaultValue: '' },
  sort_order: { kind: 'enum', values: ['asc', 'desc'], defaultValue: 'asc', requires: 'sort_by' },
  dateRange: {
    kind: 'datePair',
    fromName: 'date_from',
    toName: 'date_to',
    defaults: () => ({ from: null, to: null }), // journal: no range by default
  },
  tag_id: {
    kind: 'arrayOf',
    maxItems: 20,
    defaultValue: [],
    validate: (v: string) => /^\d+$/.test(v),
  },
} satisfies TableUrlConfig;

// Records-style variant: default range = configurable (fixed week for determinism).
const WEEK_CONFIG = {
  dateRange: {
    kind: 'datePair',
    fromName: 'date_from',
    toName: 'date_to',
    defaults: () => ({ from: '2026-09-21', to: '2026-09-27' }),
  },
} satisfies TableUrlConfig;

function renderWithParams(query: string, config: TableUrlConfig = CONFIG) {
  mockSearchParams = new URLSearchParams(query);
  return renderHook(() => useTableUrlState(config));
}

/** Query params of the last navigation written by the mock router. */
function writtenParams(mock: ReturnType<typeof vi.fn>): URLSearchParams {
  const url = mock.mock.calls.at(-1)?.[0] as string;
  return new URLSearchParams(url.split('?')[1] ?? '');
}

function lastUrl(mock: ReturnType<typeof vi.fn>): string {
  return mock.mock.calls.at(-1)?.[0] as string;
}

/** Advance past the ~16ms coalescing window so the scheduled flush fires. */
async function flushFrame(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockSearchParams = new URLSearchParams();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useTableUrlState — enum preset', () => {
  it('reads a whitelisted value', () => {
    const { result } = renderWithParams('?status=cancelled');
    expect(result.current.state.status).toBe('cancelled');
  });

  it.each([
    ['unknown value', '?status=weird'],
    ['empty value', '?status='],
    ['wrong case', '?status=Confirmed'],
  ])('%s → silent default', (_name, query) => {
    const { result } = renderWithParams(query);
    expect(result.current.state.status).toBe('all');
  });

  it('per_page whitelist: allowed value read as number', () => {
    const { result } = renderWithParams('?per_page=50');
    expect(result.current.state.per_page).toBe(50);
    expect(typeof result.current.state.per_page).toBe('number');
  });

  it.each([
    ['not in whitelist', '?per_page=30'],
    ['empty', '?per_page='],
    ['garbage', '?per_page=abc'],
  ])('per_page %s → default 20', (_name, query) => {
    const { result } = renderWithParams(query);
    expect(result.current.state.per_page).toBe(20);
  });
});

describe('useTableUrlState — int preset', () => {
  it('reads a valid page', () => {
    const { result } = renderWithParams('?page=42');
    expect(result.current.state.page).toBe(42);
  });

  it.each([
    ['above max is capped', '?page=99999', 10000],
    ['below min is capped', '?page=0', 1],
    ['negative is capped', '?page=-3', 1],
  ])('%s', (_name, query, expected) => {
    const { result } = renderWithParams(query);
    expect(result.current.state.page).toBe(expected);
  });

  it.each([
    ['garbage', '?page=abc'],
    ['float', '?page=2.5'],
    ['empty', '?page='],
  ])('%s → default 1', (_name, query) => {
    const { result } = renderWithParams(query);
    expect(result.current.state.page).toBe(1);
  });
});

describe('useTableUrlState — string preset', () => {
  it('reads a value within the cap', () => {
    const { result } = renderWithParams('?search=анна');
    expect(result.current.state.search).toBe('анна');
  });

  it('exactly 200 chars is valid', () => {
    const { result } = renderWithParams(`?search=${'x'.repeat(200)}`);
    expect(result.current.state.search).toBe('x'.repeat(200));
  });

  it('over 200 chars → silent default', () => {
    const { result } = renderWithParams(`?search=${'x'.repeat(201)}`);
    expect(result.current.state.search).toBe('');
  });
});

describe('useTableUrlState — arrayOf preset', () => {
  it('collects repeated params, dedups, drops invalid elements', () => {
    const { result } = renderWithParams('?tag_id=1&tag_id=2&tag_id=1&tag_id=bad&tag_id=');
    expect(result.current.state.tag_id).toEqual(['1', '2']);
  });

  it('caps at maxItems=20 keeping first occurrences', () => {
    const query = Array.from({ length: 25 }, (_, i) => `tag_id=${i + 1}`).join('&');
    const { result } = renderWithParams(query);
    expect(result.current.state.tag_id).toEqual(
      Array.from({ length: 20 }, (_, i) => String(i + 1)),
    );
  });

  it('absent → default []', () => {
    const { result } = renderWithParams('');
    expect(result.current.state.tag_id).toEqual([]);
  });
});

describe('useTableUrlState — datePair preset (read)', () => {
  it('both absent → configured defaults (journal: nulls)', () => {
    const { result } = renderWithParams('');
    expect(result.current.state.dateRange).toEqual({ from: null, to: null });
  });

  it('both absent → configured defaults (records: fixed week)', () => {
    const { result } = renderWithParams('', WEEK_CONFIG);
    expect(result.current.state.dateRange).toEqual({ from: '2026-09-21', to: '2026-09-27' });
  });

  it('partial: only from present → to stays null', () => {
    const { result } = renderWithParams('?date_from=2026-09-01');
    expect(result.current.state.dateRange).toEqual({ from: '2026-09-01', to: null });
  });

  it('partial: only to present → from stays null', () => {
    const { result } = renderWithParams('?date_to=2026-09-30');
    expect(result.current.state.dateRange).toEqual({ from: null, to: '2026-09-30' });
  });

  it('valid pair stays as-is', () => {
    const { result } = renderWithParams('?date_from=2026-09-01&date_to=2026-09-30');
    expect(result.current.state.dateRange).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('inverted pair (from > to) → both null', () => {
    const { result } = renderWithParams('?date_from=2026-09-10&date_to=2026-09-05');
    expect(result.current.state.dateRange).toEqual({ from: null, to: null });
  });

  it.each([
    ['garbage', '?date_from=banana'],
    ['impossible date', '?date_from=2026-02-31'],
    ['non-padded', '?date_from=2026-9-9'],
  ])('invalid from (%s) is treated as absent', (_name, query) => {
    const { result } = renderWithParams(`${query}&date_to=2026-09-30`);
    expect(result.current.state.dateRange).toEqual({ from: null, to: '2026-09-30' });
  });
});

describe('useTableUrlState — sort_order requires sort_by', () => {
  it('orphan sort_order (no sort_by) is ignored → default', () => {
    const { result } = renderWithParams('?sort_order=desc');
    expect(result.current.state.sort_order).toBe('asc');
  });

  it('sort_by at its default (empty) still ignores sort_order', () => {
    const { result } = renderWithParams('?sort_by=&sort_order=desc');
    expect(result.current.state.sort_order).toBe('asc');
  });

  it('sort_by set → sort_order honored', () => {
    const { result } = renderWithParams('?sort_by=client_name&sort_order=desc');
    expect(result.current.state.sort_order).toBe('desc');
  });

  it('dirty URL is NOT rewritten on read', () => {
    renderWithParams('?sort_order=desc&page=99999');
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('useTableUrlState — serialization (update writes)', () => {
  it('values equal to defaults are removed from the URL', async () => {
    const { result } = renderWithParams('?status=confirmed&page=7');
    act(() => result.current.update({ status: 'all' }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    const params = writtenParams(mockPush);
    expect(params.has('status')).toBe(false);
    expect(params.has('page')).toBe(false); // filter change resets page → removed
  });

  it('unmanaged params (clientId) are preserved', async () => {
    const { result } = renderWithParams('?clientId=77&status=confirmed');
    act(() => result.current.update({ search: 'анна' }));
    await flushFrame();
    const params = writtenParams(mockPush);
    expect(params.get('clientId')).toBe('77');
    expect(params.get('status')).toBe('confirmed');
    expect(params.get('search')).toBe('анна');
  });

  it('all-default result → clean path without query', async () => {
    const { result } = renderWithParams('?status=confirmed');
    act(() => result.current.update({ status: 'all' }));
    await flushFrame();
    expect(lastUrl(mockPush)).toBe('/records');
  });

  it('navigates with { scroll: false }', async () => {
    const { result } = renderWithParams('');
    act(() => result.current.update({ search: 'анна' }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ scroll: false }),
    );
  });

  it('empty array writes no param', async () => {
    const { result } = renderWithParams('?tag_id=1&tag_id=2');
    act(() => result.current.update({ tag_id: [] }));
    await flushFrame();
    const params = writtenParams(mockPush);
    expect(params.has('tag_id')).toBe(false);
  });

  it('array writes repeated params', async () => {
    const { result } = renderWithParams('');
    act(() => result.current.update({ tag_id: ['2', '1', '2'] }));
    await flushFrame();
    expect(writtenParams(mockPush).getAll('tag_id')).toEqual(['2', '1']);
  });

  it('datePair default range (records week) is not written when current equals default', async () => {
    // URL already carries the exact default week → update of an unrelated
    // param must strip both dates (equal to defaults → removed).
    const { result } = renderWithParams(
      '?date_from=2026-09-21&date_to=2026-09-27',
      WEEK_CONFIG,
    );
    act(() => result.current.update({ search: 'x' }));
    await flushFrame();
    const params = writtenParams(mockPush);
    expect(params.has('date_from')).toBe(false);
    expect(params.has('date_to')).toBe(false);
  });

  it('non-default dateRange writes from/to params', async () => {
    const { result } = renderWithParams('', WEEK_CONFIG);
    act(() => result.current.update({ dateRange: { from: '2026-10-01', to: null } }));
    await flushFrame();
    const params = writtenParams(mockPush);
    expect(params.get('date_from')).toBe('2026-10-01');
    expect(params.has('date_to')).toBe(false); // null side → absent
  });

  it('updating dateRange back to defaults removes both params', async () => {
    const { result } = renderWithParams('?date_from=2026-10-01&date_to=2026-10-02', WEEK_CONFIG);
    act(() => result.current.update({ dateRange: { from: '2026-09-21', to: '2026-09-27' } }));
    await flushFrame();
    const params = writtenParams(mockPush);
    expect(params.has('date_from')).toBe(false);
    expect(params.has('date_to')).toBe(false);
  });

  it('per_page equal to default is removed', async () => {
    const { result } = renderWithParams('?per_page=50');
    act(() => result.current.update({ per_page: 20 }));
    await flushFrame();
    expect(writtenParams(mockPush).has('per_page')).toBe(false);
  });
});

describe('useTableUrlState — atomic batch', () => {
  it('multiple params in one update() → single push with all params', async () => {
    const { result } = renderWithParams('');
    act(() => result.current.update({ search: 'анна', status: 'confirmed', page: 3 }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    const params = writtenParams(mockPush);
    expect(params.get('search')).toBe('анна');
    expect(params.get('status')).toBe('confirmed');
    expect(params.get('page')).toBe('3');
  });

  it('filter change resets page to 1 in the same navigation', async () => {
    const { result } = renderWithParams('?page=7&status=confirmed');
    act(() => result.current.update({ search: 'анна' }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    const params = writtenParams(mockPush);
    expect(params.has('page')).toBe(false); // page reset to default 1 → stripped
    expect(params.get('search')).toBe('анна');
    expect(params.get('status')).toBe('confirmed');
  });

  it('explicit page in the patch wins over the reset', async () => {
    const { result } = renderWithParams('?page=7');
    act(() => result.current.update({ search: 'анна', page: 2 }));
    await flushFrame();
    expect(writtenParams(mockPush).get('page')).toBe('2');
  });

  it('page-only navigation keeps current filters', async () => {
    const { result } = renderWithParams('?search=анна&status=confirmed&page=1');
    act(() => result.current.update({ page: 4 }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    const params = writtenParams(mockPush);
    expect(params.get('search')).toBe('анна');
    expect(params.get('status')).toBe('confirmed');
    expect(params.get('page')).toBe('4');
  });

  it('per_page change resets page to 1 in the same navigation', async () => {
    const { result } = renderWithParams('?page=7&per_page=10');
    act(() => result.current.update({ per_page: 50 }));
    await flushFrame();
    expect(writtenParams(mockPush).has('page')).toBe(false);
    expect(writtenParams(mockPush).get('per_page')).toBe('50');
  });

  it('update(patch, { history: "replace" }) → router.replace (page correction)', async () => {
    const { result } = renderWithParams('?page=7&search=анна');
    act(() => result.current.update({ page: 3 }, { history: 'replace' }));
    await flushFrame();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const params = writtenParams(mockReplace);
    expect(params.get('page')).toBe('3');
    expect(params.get('search')).toBe('анна');
  });

  it('filter change with config lacking `page` → no auto-reset, no crash', async () => {
    // per-page configs that don't manage pagination (journal without page)
    // must not break on the architect-approved page-reset rule.
    const config: TableUrlConfig = {
      status: { kind: 'enum', values: ['all', 'confirmed'], defaultValue: 'all' },
    };
    const { result } = renderWithParams('?status=all', config);
    act(() => result.current.update({ status: 'confirmed' }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(writtenParams(mockPush).get('status')).toBe('confirmed');
  });
});

describe('useTableUrlState — coalescing', () => {
  it('two update() calls in one frame → single push with merged patch', async () => {
    const { result } = renderWithParams('?status=confirmed');
    act(() => {
      result.current.update({ search: 'анна' });
      result.current.update({ status: 'cancelled' });
    });
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    const params = writtenParams(mockPush);
    expect(params.get('search')).toBe('анна');
    expect(params.get('status')).toBe('cancelled');
  });

  it('later patch wins on conflicting keys', async () => {
    const { result } = renderWithParams('');
    act(() => {
      result.current.update({ search: 'a' });
      result.current.update({ search: 'b' });
    });
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(writtenParams(mockPush).get('search')).toBe('b');
  });

  it('coalesced batch: replace wins over push (service correction must not become a history step)', async () => {
    // Same frame: a service correction ({history:'replace'}) races with a
    // user push. The rule: replace wins — the correction must never mutate
    // into a push (an extra history entry) just because of the race.
    const { result } = renderWithParams('?page=7&search=анна');
    act(() => {
      result.current.update({ page: 3 }, { history: 'replace' });
      result.current.update({ status: 'confirmed' });
    });
    await flushFrame();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const params = writtenParams(mockReplace);
    expect(params.get('page')).toBe('3');
    expect(params.get('search')).toBe('анна');
    expect(params.get('status')).toBe('confirmed');
  });

  it('coalesced batch: push after push stays push', async () => {
    const { result } = renderWithParams('');
    act(() => {
      result.current.update({ search: 'a' });
      result.current.update({ status: 'confirmed' });
    });
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('no-op update (patch serializes to the identical URL) skips navigation entirely', async () => {
    // Re-applying the very values already in the URL: the serialized result
    // equals the current base → no router call, no redundant history entry.
    const { result } = renderWithParams('?status=confirmed&search=анна&page=3');
    act(() => result.current.update({ status: 'confirmed', search: 'анна', page: 3 }));
    await flushFrame();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('no-op detection uses the full managed state, not the patch keys', async () => {
    // URL has page=7; patch touches only search with a value equal to the
    // current one → auto page-reset would change page → NOT a no-op.
    const { result } = renderWithParams('?search=анна&page=7');
    act(() => result.current.update({ search: 'анна' }));
    await flushFrame();
    // auto-reset lowers page 7→1 → the URL changes → navigation happens
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(writtenParams(mockPush).has('page')).toBe(false);
  });

  it('writes outside the coalescing window navigate separately', async () => {
    const { result } = renderWithParams('');
    act(() => result.current.update({ search: 'a' }));
    await flushFrame();
    act(() => result.current.update({ status: 'confirmed' }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(writtenParams(mockPush).get('search')).toBe('a');
    expect(writtenParams(mockPush).get('status')).toBe('confirmed');
  });

  it('flush before unmount does not navigate after unmount', async () => {
    const { result, unmount } = renderWithParams('');
    act(() => result.current.update({ search: 'a' }));
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('useTableUrlState — StrictMode double render', () => {
  // Real React.StrictMode semantics: React 18/19 double-invokes render and
  // mounts→unmounts→mounts effects on development StrictMode mounts. The
  // hook must stay a pure reader at render (no navigation) and the
  // scheduled writer must fire exactly once per interaction.

  /** Probe component exposing the hook API through props. */
  function Probe({ api }: { api: { current: ReturnType<typeof useTableUrlState<typeof CONFIG>> | null } }) {
    api.current = useTableUrlState(CONFIG);
    return null;
  }

  it('real StrictMode mount: no navigation on mount, exactly one push per interaction', async () => {
    mockSearchParams = new URLSearchParams('?status=confirmed');
    const api: { current: ReturnType<typeof useTableUrlState<typeof CONFIG>> | null } = { current: null };
    const view = render(
      <StrictMode>
        <Probe api={api} />
      </StrictMode>,
    );
    // StrictMode double-mount settles — reading state must never navigate.
    await act(async () => {});
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();

    act(() => api.current!.update({ search: 'анна' }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
    const params = writtenParams(mockPush);
    expect(params.get('search')).toBe('анна');
    expect(params.get('status')).toBe('confirmed');

    view.unmount();
  });

  it('real StrictMode mount: coalesced updates still navigate exactly once', async () => {
    mockSearchParams = new URLSearchParams('');
    const api: { current: ReturnType<typeof useTableUrlState<typeof CONFIG>> | null } = { current: null };
    render(
      <StrictMode>
        <Probe api={api} />
      </StrictMode>,
    );
    await act(async () => {});
    act(() => {
      api.current!.update({ search: 'a' });
      api.current!.update({ status: 'confirmed' });
    });
    await flushFrame();
    // StrictMode effects run twice; the writer must stay idempotent.
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(writtenParams(mockPush).get('search')).toBe('a');
    expect(writtenParams(mockPush).get('status')).toBe('confirmed');
  });

  it('manual rerender (distinct scenario): re-renders do not trigger writes', async () => {
    mockSearchParams = new URLSearchParams('?status=confirmed');
    const { result, rerender } = renderHook(() => useTableUrlState(CONFIG));
    rerender();
    rerender();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    act(() => result.current.update({ search: 'анна' }));
    await flushFrame();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
