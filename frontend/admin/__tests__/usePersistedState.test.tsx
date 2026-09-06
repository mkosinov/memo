import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePersistedState, readPersisted } from '@/hooks/usePersistedState';

const decodeNumber = (raw: string): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

describe('usePersistedState', () => {
  beforeEach(() => localStorage.clear());

  it('returns fallback when key absent', () => {
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    expect(result.current[0]).toBe(7);
  });

  it('returns decoded stored value', () => {
    localStorage.setItem('k', '42');
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    expect(result.current[0]).toBe(42);
  });

  it('returns fallback on garbage / decode-null', () => {
    localStorage.setItem('k', 'not-a-number');
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    expect(result.current[0]).toBe(7);
    localStorage.setItem('k2', '99');
    const strict = (raw: string) => (raw === '1' ? 1 : null);
    const r2 = renderHook(() => usePersistedState('k2', 0, strict));
    expect(r2.result.current[0]).toBe(0);
  });

  it('setter updates value and persists JSON', () => {
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    act(() => result.current[1](50));
    expect(result.current[0]).toBe(50);
    expect(localStorage.getItem('k')).toBe('50');
  });

  it('setter keeps in-memory value when storage write throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const { result } = renderHook(() => usePersistedState('k', 7, decodeNumber));
    act(() => result.current[1](9));
    expect(result.current[0]).toBe(9);
    spy.mockRestore();
  });

  it('SSR: initializer returns fallback when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    expect(readPersisted('k', 7, decodeNumber)).toBe(7);
    vi.unstubAllGlobals();
  });
});
