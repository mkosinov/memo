import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import { useServicePhotos } from '../useServicePhotos';
import type { PhotoPublicResponse } from '@memo/api-client';

// ─── Mock @memo/api-client ─────────────────────────────────────────────────
vi.mock('@memo/api-client', () => ({
  getPublicPhotos: vi.fn(),
}));

import { getPublicPhotos } from '@memo/api-client';

const mockedGetPublicPhotos = getPublicPhotos as Mock;

const contractPhotos: PhotoPublicResponse[] = [
  { id: 'p1', filename: '/images/gallery/p1.jpg', tags: ['масло', 'акварель'] },
  { id: 'p2', filename: 'images/gallery/p2.jpg', tags: [] },
  { id: 'p3', filename: 'https://cdn.example.com/p3.jpg', tags: ['масло'] },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Fresh QueryClient with retry: false — error tests must not wait on retries. */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Wrapper around ONE shared client — remount tests must ride the same cache. */
function sharedWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// GH #576: service photo strip rides the SAME public route and mapper as the
// gallery (useGallery canon), scoped by service_id on the
// ['photos', 'public', 'service', serviceId] cache key (spec §6.4).
describe('useServicePhotos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPublicPhotos.mockResolvedValue({
      items: contractPhotos,
      total: contractPhotos.length,
      page: 1,
      per_page: 20,
    });
  });

  it('fetches once with service_id and per_page 20, mapping in API order', async () => {
    const { result } = renderHook(() => useServicePhotos('svc-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockedGetPublicPhotos).toHaveBeenCalledTimes(1);
    expect(mockedGetPublicPhotos).toHaveBeenCalledWith({ service_id: 'svc-1', per_page: 20 });
    expect(result.current.photos).toStrictEqual([
      { id: 'p1', url: '/images/gallery/p1.jpg', caption: 'масло · акварель' },
      { id: 'p2', url: 'images/gallery/p2.jpg', caption: '' },
      { id: 'p3', url: 'https://cdn.example.com/p3.jpg', caption: 'масло' },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('drops photos whose filename fails the url allowlist', async () => {
    mockedGetPublicPhotos.mockResolvedValue({
      items: [
        { id: 'ok', filename: '/images/ok.jpg', tags: [] },
        { id: 'evil', filename: 'javascript:alert(1)', tags: [] },
        { id: 'evil2', filename: '//evil.example.com/x.jpg', tags: [] },
      ],
      total: 3,
      page: 1,
      per_page: 20,
    });

    const { result } = renderHook(() => useServicePhotos('svc-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.photos).toStrictEqual([
      { id: 'ok', url: '/images/ok.jpg', caption: '' },
    ]);
  });

  it('empty page → empty photos, no error', async () => {
    mockedGetPublicPhotos.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 20 });

    const { result } = renderHook(() => useServicePhotos('svc-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.photos).toStrictEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a failed fetch as error with an empty list', async () => {
    mockedGetPublicPhotos.mockRejectedValue(new Error('backend down'));

    const { result } = renderHook(() => useServicePhotos('svc-1'), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });

    expect(result.current.error?.message).toBe('backend down');
    expect(result.current.photos).toStrictEqual([]);
  });

  it('remounts within staleTime do not refetch; key nests under photos/public', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = sharedWrapper(queryClient);

    const first = renderHook(() => useServicePhotos('svc-9'), { wrapper });
    await waitFor(() => expect(first.result.current.isLoading).toBe(false));
    first.unmount();

    const second = renderHook(() => useServicePhotos('svc-9'), { wrapper });
    await waitFor(() => expect(second.result.current.isLoading).toBe(false));
    await waitFor(() => expect(second.result.current.photos.length).toBe(3));

    // One network call across both mounts — staleTime keeps the entry fresh.
    expect(mockedGetPublicPhotos).toHaveBeenCalledTimes(1);
    // Key structure is a spec'd contract (§6.4): ['photos','public','service',id].
    expect(
      queryClient.getQueryState(['photos', 'public', 'service', 'svc-9'])?.data,
    ).toBeDefined();
  });
});
