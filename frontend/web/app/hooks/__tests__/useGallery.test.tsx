import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import { useGallery } from '../useGallery';
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

// GH #493: the gallery rides the public route getPublicPhotos({ per_page: 12 })
// on the ['photos', 'public'] react-query cache (ADR-015).
describe('useGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPublicPhotos.mockResolvedValue({
      items: contractPhotos,
      total: contractPhotos.length,
      page: 1,
      per_page: 12,
    });
  });

  it('fetches public photos and maps the paged envelope to view models', async () => {
    const { result } = renderHook(() => useGallery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockedGetPublicPhotos).toHaveBeenCalledTimes(1);
    expect(mockedGetPublicPhotos).toHaveBeenCalledWith({ per_page: 12 });
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
      per_page: 12,
    });

    const { result } = renderHook(() => useGallery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.photos).toStrictEqual([
      { id: 'ok', url: '/images/ok.jpg', caption: '' },
    ]);
  });

  it('empty page → empty photos, no error (section hides)', async () => {
    mockedGetPublicPhotos.mockResolvedValue({ items: [], total: 0, page: 1, per_page: 12 });

    const { result } = renderHook(() => useGallery(), {
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

    const { result } = renderHook(() => useGallery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });

    expect(result.current.error?.message).toBe('backend down');
    expect(result.current.photos).toStrictEqual([]);
  });
});
