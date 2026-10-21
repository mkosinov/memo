import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Mock } from 'vitest';
import { useGallery } from '../useGallery';
import type { PhotoResponse } from '@memo/api-client';

// ─── Mock @memo/api-client ─────────────────────────────────────────────────
vi.mock('@memo/api-client', () => ({
  getPhotos: vi.fn(),
}));

import { getPhotos } from '@memo/api-client';

const mockedGetPhotos = getPhotos as Mock;

/** Contract row factory — full PhotoResponse shape (GH #479 gallery migration). */
function photoResponse(overrides: Partial<PhotoResponse> = {}): PhotoResponse {
  return {
    id: 'p1',
    filename: '/images/gallery/p1.jpg',
    client_id: null,
    service_id: null,
    activity_id: null,
    location_id: null,
    is_public: true,
    tags: [],
    client_name: null,
    created_at: '2026-10-19T10:00:00Z',
    updated_at: '2026-10-19T10:00:00Z',
    ...overrides,
  };
}

const contractPhotos: PhotoResponse[] = [
  photoResponse({
    id: 'p1',
    filename: '/images/gallery/p1.jpg',
    tags: [
      { id: 't1', title: 'масло' },
      { id: 't2', title: 'акварель' },
    ],
  }),
  photoResponse({ id: 'p2', filename: 'images/gallery/p2.jpg' }),
  photoResponse({ id: 'p3', filename: 'https://cdn.example.com/p3.jpg', tags: [{ id: 't1', title: 'масло' }] }),
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

// GH #479: public gallery rides getPhotos({ is_public: true, per_page: 12 })
// on the ['photos', 'public'] react-query cache.
describe('useGallery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetPhotos.mockResolvedValue({ items: contractPhotos, total: contractPhotos.length });
  });

  it('fetches public photos and maps the paged envelope to view models', async () => {
    const { result } = renderHook(() => useGallery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockedGetPhotos).toHaveBeenCalledTimes(1);
    expect(mockedGetPhotos).toHaveBeenCalledWith({ is_public: true, per_page: 12 });
    expect(result.current.photos).toStrictEqual([
      { id: 'p1', url: '/images/gallery/p1.jpg', caption: 'масло · акварель' },
      { id: 'p2', url: 'images/gallery/p2.jpg', caption: '' },
      { id: 'p3', url: 'https://cdn.example.com/p3.jpg', caption: 'масло' },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('drops photos whose filename fails the url allowlist', async () => {
    mockedGetPhotos.mockResolvedValue({
      items: [
        photoResponse({ id: 'ok', filename: '/images/ok.jpg' }),
        photoResponse({ id: 'evil', filename: 'javascript:alert(1)' }),
        photoResponse({ id: 'evil2', filename: '//evil.example.com/x.jpg' }),
      ],
      total: 3,
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
    mockedGetPhotos.mockResolvedValue({ items: [], total: 0 });

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
    mockedGetPhotos.mockRejectedValue(new Error('backend down'));

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
