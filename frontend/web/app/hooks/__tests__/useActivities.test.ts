import { renderHook } from '@testing-library/react';
import { useActivities } from '../useActivities';

// DEPRECATED: useActivities now returns empty data synchronously.
// Use useSchedule() instead for real data.

describe('useActivities (deprecated)', () => {
  it('returns empty activities array', () => {
    const { result } = renderHook(() => useActivities());

    expect(result.current.isLoading).toBe(false);
    expect(result.current.activities).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('ignores filters and returns empty', () => {
    const { result } = renderHook(() => useActivities({ date: '2026-05-24' }));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.activities).toEqual([]);
  });
});
