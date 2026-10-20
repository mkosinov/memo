import { renderHook, waitFor } from '@testing-library/react';
import { useLocations } from '../useLocations';
import type { Mock } from 'vitest';

// ─── Mock @memo/api-client ─────────────────────────────────────────────────
vi.mock('@memo/api-client', () => ({
  getLocations: vi.fn(),
}));

import { getLocations } from '@memo/api-client';

const mockedGetLocations = getLocations as Mock;

// GH #491: the hook consumes the real api-client (the former in-repo mock
// hardcoded the pre-UUID seed ids) — the test pins the api-client contract:
// paged envelope → items → LocationView mapping.
describe('useLocations', () => {
  it('loads locations on mount and maps the paged envelope', async () => {
    mockedGetLocations.mockResolvedValue({
      items: [
        { id: 'u1', title: 'Альпика', address: 'Альпика, 1 этаж', image_url: null },
        { id: 'u2', title: 'Гранд Отель Поляна', address: 'Гранд Отель, лобби', image_url: '/images/grand.jpg' },
        { id: 'u3', title: 'Поляна 1389', address: null, image_url: null },
      ],
    });

    const { result } = renderHook(() => useLocations());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.locations.length).toBe(3);
    expect(result.current.locations[0]).toMatchObject({
      id: 'u1',
      title: 'Альпика',
      address: 'Альпика, 1 этаж',
    });
    expect(result.current.locations[1].photoUrl).toBe('/images/grand.jpg');
    expect(result.current.locations[2].address).toBe('');
    expect(result.current.error).toBeNull();
  });

  it('surfaces a failed fetch as error with an empty list', async () => {
    mockedGetLocations.mockRejectedValue(new Error('backend down'));

    const { result } = renderHook(() => useLocations());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.locations).toEqual([]);
    expect(result.current.error).toBeTruthy();
  });
});
