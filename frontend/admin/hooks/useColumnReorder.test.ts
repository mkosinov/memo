import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useColumnReorder } from './useColumnReorder';

const mockReorderMasters = vi.fn().mockResolvedValue(undefined);
const mockReorderLocations = vi.fn().mockResolvedValue(undefined);

vi.mock('@memo/api-client', () => ({
  reorderMasters: (...args: unknown[]) => mockReorderMasters(...args),
  reorderLocations: (...args: unknown[]) => mockReorderLocations(...args),
}));

describe('useColumnReorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const columns = [
    { id: 'm1', name: 'Ольга', sortOrder: 0 },
    { id: 'm2', name: 'Юлия', sortOrder: 1 },
    { id: 'm3', name: 'Анастасия', sortOrder: 2 },
  ];

  it('initializes column order sorted by sortOrder', () => {
    const unsorted = [
      { id: 'm3', name: 'Анастасия', sortOrder: 2 },
      { id: 'm1', name: 'Ольга', sortOrder: 0 },
      { id: 'm2', name: 'Юлия', sortOrder: 1 },
    ];
    const { result } = renderHook(() =>
      useColumnReorder({ columns: unsorted, columnMode: 'masters' }),
    );
    expect(result.current.columnOrder).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns ordered columns matching columnOrder', () => {
    const { result } = renderHook(() =>
      useColumnReorder({ columns, columnMode: 'masters' }),
    );
    expect(result.current.orderedColumns.map((c) => c.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('tracks modifier key state', () => {
    const { result } = renderHook(() =>
      useColumnReorder({ columns, columnMode: 'masters' }),
    );
    expect(result.current.modifierHeld).toBe(false);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { metaKey: true }));
    });
    expect(result.current.modifierHeld).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { metaKey: false, altKey: false }));
    });
    expect(result.current.modifierHeld).toBe(false);
  });

  it('reorders columns on drop', () => {
    const { result } = renderHook(() =>
      useColumnReorder({ columns, columnMode: 'masters' }),
    );

    act(() => {
      result.current.onColumnDrop('m1', 'm3');
    });

    // m1 moves before m3 → [m2, m1, m3]
    expect(result.current.columnOrder).toEqual(['m2', 'm1', 'm3']);
    expect(result.current.orderedColumns.map((c) => c.id)).toEqual(['m2', 'm1', 'm3']);
  });

  it('calls reorderMasters API on drop in masters mode', async () => {
    const { result } = renderHook(() =>
      useColumnReorder({ columns, columnMode: 'masters' }),
    );

    act(() => {
      result.current.onColumnDrop('m1', 'm3');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockReorderMasters).toHaveBeenCalledWith(['m2', 'm1', 'm3']);
  });

  it('calls reorderLocations API on drop in locations mode', async () => {
    const { result } = renderHook(() =>
      useColumnReorder({
        columns: [
          { id: 'loc1', name: 'Alpika', sortOrder: 0 },
          { id: 'loc2', name: 'Grand', sortOrder: 1 },
        ],
        columnMode: 'locations',
      }),
    );

    act(() => {
      result.current.onColumnDrop('loc2', 'loc1');
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockReorderLocations).toHaveBeenCalledWith(['loc2', 'loc1']);
  });

  it('does nothing when dropping on the same column', () => {
    const { result } = renderHook(() =>
      useColumnReorder({ columns, columnMode: 'masters' }),
    );

    act(() => {
      result.current.onColumnDrop('m1', 'm1');
    });

    expect(result.current.columnOrder).toEqual(['m1', 'm2', 'm3']);
    expect(mockReorderMasters).not.toHaveBeenCalled();
  });

  // --- initialOrder / onOrderChange tests ---

  it('uses initialOrder when provided instead of sortOrder', () => {
    // Initial order is custom: m3, m1, m2 (not sorted by sortOrder)
    const { result } = renderHook(() =>
      useColumnReorder({
        columns,
        columnMode: 'masters',
        initialOrder: ['m3', 'm1', 'm2'],
      }),
    );
    expect(result.current.columnOrder).toEqual(['m3', 'm1', 'm2']);
    expect(result.current.orderedColumns.map((c) => c.id)).toEqual(['m3', 'm1', 'm2']);
  });

  it('falls back to sortOrder when initialOrder is undefined', () => {
    const unsorted = [
      { id: 'm3', name: 'Анастасия', sortOrder: 2 },
      { id: 'm1', name: 'Ольга', sortOrder: 0 },
      { id: 'm2', name: 'Юлия', sortOrder: 1 },
    ];
    const { result } = renderHook(() =>
      useColumnReorder({ columns: unsorted, columnMode: 'masters' }),
    );
    expect(result.current.columnOrder).toEqual(['m1', 'm2', 'm3']);
  });

  it('falls back to sortOrder when initialOrder is empty array', () => {
    const { result } = renderHook(() =>
      useColumnReorder({
        columns,
        columnMode: 'masters',
        initialOrder: [],
      }),
    );
    // Empty array means no persisted order, so should fall back to sortOrder
    expect(result.current.columnOrder).toEqual(['m1', 'm2', 'm3']);
  });

  it('calls onOrderChange after drop with new order', () => {
    const onOrderChange = vi.fn();
    const { result } = renderHook(() =>
      useColumnReorder({
        columns,
        columnMode: 'masters',
        onOrderChange,
      }),
    );

    act(() => {
      result.current.onColumnDrop('m1', 'm3');
    });

    // onOrderChange called on initial render + after drop = 2 calls
    expect(onOrderChange).toHaveBeenCalledTimes(2);
    // The second call (last) should be the new order after drop
    const lastCall = onOrderChange.mock.calls[onOrderChange.mock.calls.length - 1][0];
    expect(lastCall).toEqual(['m2', 'm1', 'm3']);
  });

  it('calls onOrderChange on initial sync when initialOrder is provided', async () => {
    const onOrderChange = vi.fn();
    renderHook(() =>
      useColumnReorder({
        columns,
        columnMode: 'masters',
        initialOrder: ['m3', 'm1', 'm2'],
        onOrderChange,
      }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // After initial sync, columns may be re-ordered to match actual columns.
    // Since initialOrder=['m3','m1','m2'] is a valid subset of columns,
    // the sync effect should call onOrderChange with the merged result.
    expect(onOrderChange).toHaveBeenCalled();
    const lastCall = onOrderChange.mock.calls[onOrderChange.mock.calls.length - 1][0];
    expect(lastCall).toEqual(['m3', 'm1', 'm2']);
  });

  it('preserves user order when new column is added and calls onOrderChange', async () => {
    const onOrderChange = vi.fn();
    const { result, rerender } = renderHook(
      (opts: Parameters<typeof useColumnReorder>[0]) => useColumnReorder(opts),
      {
        initialProps: {
          columns: columns.slice(0, 2), // only m1, m2
          columnMode: 'masters' as const,
          initialOrder: ['m2', 'm1'],
          onOrderChange,
        },
      },
    );

    expect(result.current.columnOrder).toEqual(['m2', 'm1']);

    // Simulate a new column being added
    rerender({
      columns: [...columns], // now m1, m2, m3
      columnMode: 'masters',
      initialOrder: ['m2', 'm1'],
      onOrderChange,
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // User order [m2, m1] should be preserved, m3 inserted at end
    const lastCall = onOrderChange.mock.calls[onOrderChange.mock.calls.length - 1][0];
    expect(lastCall).toEqual(['m2', 'm1', 'm3']);
  });
});
