import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useColumnReorder } from '../hooks/useColumnReorder';

// #584 §5: the masters-column persistence rides the whoami-computed branch —
// patchUserSettings(branch, { column_order_staff }). The api boundary and the
// auth hook are mocked (repo pattern).
const apiMocks = vi.hoisted(() => ({
  patchUserSettings: vi.fn().mockResolvedValue(undefined),
  reorderLocations: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@memo/api-client', () => ({
  patchUserSettings: (...args: unknown[]) => apiMocks.patchUserSettings(...args),
  reorderLocations: (...args: unknown[]) => apiMocks.reorderLocations(...args),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ branch: 'master' }),
}));

// #301 (react-hooks/exhaustive-deps): adding `initialOrder` to the reconcile
// effect's deps must NOT change the initialize-once contract. These tests pin
// that contract so the dep addition is provably behavior-neutral:
//   1. initialOrder seeds the order on first initialization;
//   2. a LATER initialOrder change (settings arriving after columns) must not
//      re-seed / reorder — the user's (or sorted) order stands;
//   3. columns added later reconcile into their correct positions.

type Column = { id: string; name: string; sortOrder?: number };

const COLS: Column[] = [
  { id: 'a', name: 'A', sortOrder: 3 },
  { id: 'b', name: 'B', sortOrder: 1 },
  { id: 'c', name: 'C', sortOrder: 2 },
];

beforeEach(() => {
  apiMocks.patchUserSettings.mockClear();
  apiMocks.reorderLocations.mockClear();
});

describe('useColumnReorder — initialize-once contract with initialOrder in deps', () => {
  it('seeds columnOrder from initialOrder on first initialization', () => {
    const { result } = renderHook(() =>
      useColumnReorder({ columns: COLS, columnMode: 'locations', initialOrder: ['b', 'c', 'a'] }),
    );
    expect(result.current.columnOrder).toEqual(['b', 'c', 'a']);
    expect(result.current.orderedColumns.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('a later initialOrder change does NOT re-seed the order (initialize-once)', () => {
    const initialProps = { columns: COLS, columnMode: 'locations' as const, initialOrder: ['b', 'c', 'a'] };
    const { result, rerender } = renderHook((props) => useColumnReorder(props), {
      initialProps,
    });
    expect(result.current.columnOrder).toEqual(['b', 'c', 'a']);

    // Settings arrive late with a different persisted order — ignored.
    rerender({ ...initialProps, initialOrder: ['c', 'a', 'b'] });
    expect(result.current.columnOrder).toEqual(['b', 'c', 'a']);

    // User drags afterwards — works on the established order.
    act(() => result.current.onColumnDrop('a', 'b'));
    expect(result.current.columnOrder).toEqual(['a', 'b', 'c']);
  });

  it('empty columns first, then columns + initialOrder arriving later still seeds from initialOrder', () => {
    const initialProps = { columns: [] as Column[], columnMode: 'locations' as const, initialOrder: [] as string[] };
    const { result, rerender } = renderHook((props) => useColumnReorder(props), {
      initialProps,
    });
    // Not initialized yet: early return keeps columnOrder empty.
    expect(result.current.columnOrder).toEqual([]);

    // Both resolve in a later commit → initialOrder seeds the order.
    rerender({ columns: COLS, columnMode: 'locations', initialOrder: ['c', 'b', 'a'] });
    expect(result.current.columnOrder).toEqual(['c', 'b', 'a']);
  });

  it('new columns reconcile into position without resetting user order', () => {
    const initialProps = { columns: COLS, columnMode: 'locations' as const, initialOrder: ['b', 'c', 'a'] };
    const { result, rerender } = renderHook((props) => useColumnReorder(props), {
      initialProps,
    });
    act(() => result.current.onColumnDrop('a', 'b')); // [a, b, c]

    // New column d (sortOrder between existing) arrives via same effect run.
    rerender({ ...initialProps, columns: [...COLS, { id: 'd', name: 'D', sortOrder: 2 }] });    expect(result.current.columnOrder).toContain('d');
    expect(result.current.columnOrder.slice(0, 3)).toEqual(['a', 'b', 'c']);
    expect(result.current.orderedColumns.map((c) => c.id)).toContain('d');
  });

  it('masters mode persists column_order_staff via patchUserSettings(branch, …)', async () => {
    const { result } = renderHook(() =>
      useColumnReorder({ columns: COLS, columnMode: 'masters', initialOrder: ['b', 'c', 'a'] }),
    );

    act(() => result.current.onColumnDrop('a', 'b'));

    expect(result.current.columnOrder).toEqual(['a', 'b', 'c']);
    await waitFor(() => {
      expect(apiMocks.patchUserSettings).toHaveBeenCalledWith('master', {
        column_order_staff: ['a', 'b', 'c'],
      });
    });
    // The locations corridor stays untouched in masters mode.
    expect(apiMocks.reorderLocations).not.toHaveBeenCalled();
  });
});
