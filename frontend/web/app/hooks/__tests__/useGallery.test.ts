import { renderHook, waitFor } from '@testing-library/react';
import { useGallery } from '../useGallery';

describe('useGallery', () => {
  it('loads gallery photos on mount', async () => {
    const { result } = renderHook(() => useGallery());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.photos.length).toBeGreaterThanOrEqual(6);
    expect(result.current.photos[0].url).toBeDefined();
    expect(result.current.photos[0].technique).toBeDefined();
  });

  it('respects limit parameter', async () => {
    const { result } = renderHook(() => useGallery(3));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.photos.length).toBeLessThanOrEqual(3);
  });
});
