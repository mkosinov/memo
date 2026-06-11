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
});
