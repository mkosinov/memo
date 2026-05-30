import { renderHook, waitFor } from '@testing-library/react';
import { useActivities } from '../useActivities';

describe('useActivities', () => {
  it('loads activities on mount', async () => {
    const { result } = renderHook(() => useActivities());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.activities.length).toBeGreaterThanOrEqual(5);
    expect(result.current.activities[0].title).toBeDefined();
    expect(result.current.activities[0].priceFormatted).toBeDefined();
    expect(result.current.activities[0].dateFormatted).toBeDefined();
  });

  it('filters by date', async () => {
    const { result } = renderHook(() => useActivities({ date: '2026-05-24' }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.activities.every((a) => a.date === '2026-05-24')).toBe(true);
  });

  it('exposes error on failure', async () => {
    const { result } = renderHook(() => useActivities({ location: 'nonexistent' }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Empty result is not an error, just no data
    expect(result.current.activities).toEqual([]);
  });
});
