import { renderHook, waitFor } from '@testing-library/react';
import { useLocations } from '../useLocations';

describe('useLocations', () => {
  it('loads locations on mount', async () => {
    const { result } = renderHook(() => useLocations());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.locations.length).toBeGreaterThanOrEqual(3);
    expect(result.current.locations[0].name).toBeDefined();
    expect(result.current.locations[0].address).toBeDefined();
  });
});
