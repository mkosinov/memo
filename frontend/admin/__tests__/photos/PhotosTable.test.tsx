import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PhotoResponse } from '@memo/api-client';

// ─── Mock @tanstack/react-query ──────────────────────────────────────────
// Only useQueryClient is mocked; useQuery/QueryClientProvider stay REAL: the
// table renders inside the real PhotosProvider (server-driven context,
// GH #211 Task 6), and the wiring is asserted through the getPhotos spy
// (TagsTable precedent, #139 T1). The GH #194 status-removal regression
// cases keep their assertions — they now drive data through the real
// provider instead of mocking useQuery directly.

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  };
});

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/hooks/usePhotosMutations', () => ({
  useUpdatePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreatePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeletePhoto: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/(main)/photos/components/PhotoModal', () => ({
  PhotoModal: () => null,
}));

vi.mock('@/app/components/shared/ColumnPicker', () => ({
  ColumnPicker: () => null,
}));

// ─── Mock @memo/api-client — spy on the photos endpoints (keep the rest) ──
// GH #211 Task 6: the photos list is now SERVER-driven, so getPhotos returns a
// PhotoListResponse envelope and the context also loads the /all service/location
// dictionaries — all three are stubbed here so nothing hits fetch.

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getPhotos: vi.fn(),
    getAllServices: vi.fn(),
    getAllLocations: vi.fn(),
  };
});

// ─── Import after mocks ──────────────────────────────────────────────────

import { getPhotos, getAllServices, getAllLocations } from '@memo/api-client';
import type { PhotoListResponse } from '@memo/api-client';
import { PhotosTable } from '@/app/(main)/photos/components/PhotosTable';
import { PhotosProvider } from '@/contexts/PhotosContext';

const mockGetPhotos = vi.mocked(getPhotos);
const mockGetAllServices = vi.mocked(getAllServices);
const mockGetAllLocations = vi.mocked(getAllLocations);

/** Server envelope (GH #211 Task 6) — the paginated GET /api/v1/photos shape. */
function photoList(items: PhotoResponse[]): PhotoListResponse {
  return { items, total: items.length, page: 1, per_page: 10 };
}

// Minimal mock PhotoResponse — 4-owner shape (GH #211: client_id replaces
// visitor_id), NO is_active field (GH #194 dropped it).
const mockPhoto: PhotoResponse = {
  id: 'p-1',
  filename: 'test.jpg',
  client_id: null,
  service_id: 'svc-1',
  activity_id: 'act-1',
  location_id: null,
  is_public: false,
  tags: [],
  client_name: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Real PhotosProvider + real QueryClient; list data flows through the mocked getPhotos. */
function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PhotosProvider>
        <PhotosTable />
      </PhotosProvider>
    </QueryClientProvider>,
  );
}

/** GH #211 Task 6 — the provider also loads the /all dictionaries. */
function stubDictionaries() {
  mockGetAllServices.mockResolvedValue([]);
  mockGetAllLocations.mockResolvedValue([]);
}

describe('PhotosTable status UI removal (GH #194)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDictionaries();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not render a "Статус" column header', async () => {
    mockGetPhotos.mockResolvedValue(photoList([]));
    renderTable();
    await screen.findByText('Нет записей');
    // exact:false → catches "Статус ↕" (sort icon appended to header label).
    expect(screen.queryByText('Статус', { exact: false })).not.toBeInTheDocument();
  });

  it('does not render the status filter <select> ("Все статусы")', async () => {
    mockGetPhotos.mockResolvedValue(photoList([]));
    renderTable();
    await screen.findByText('Нет записей');
    expect(screen.queryByText('Все статусы')).not.toBeInTheDocument();
    expect(screen.queryByText('Активен')).not.toBeInTheDocument();
    expect(screen.queryByText('Архив')).not.toBeInTheDocument();
  });

  it('does not render an "Активен"/"Архив" status badge for a row', async () => {
    mockGetPhotos.mockResolvedValue(photoList([mockPhoto]));
    renderTable();
    // The row should render the filename…
    expect(await screen.findByText('test.jpg')).toBeInTheDocument();
    // …but no dead status badges.
    expect(screen.queryByText('Активен')).not.toBeInTheDocument();
    expect(screen.queryByText('Архив')).not.toBeInTheDocument();
  });
});

describe('PhotosTable unified empty copy (addendum #12)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDictionaries();
  });

  // #139 T7 + Addendum #12 — the photos empty copy changes from the old
  // «Фото не найдены» to «Нет записей» (DataTable default; the wrapper does
  // NOT pass emptyLabel). B2 cat 14 "edit expected".
  it('renders the unified «Нет записей» empty state (not «Фото не найдены»)', async () => {
    mockGetPhotos.mockResolvedValue(photoList([]));
    renderTable();
    expect(await screen.findByText('Нет записей')).toBeInTheDocument();
    expect(screen.queryByText('Фото не найдены')).not.toBeInTheDocument();
  });
});

describe('PhotosTable search (B2 cat 13 — DataTable debounce)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubDictionaries();
  });

  // GH #211 Task 6 — search is now SERVER-side: the ≥2-char debounced draft
  // becomes q and re-fetches (the mock plays the server, filename substring
  // filter). The shared DataTable 300ms debounce is still the trigger.
  it('re-fetches with q and filters by filename after the 300ms debounce', async () => {
    mockGetPhotos.mockImplementation((params) => {
      const all = [
        { ...mockPhoto, id: 'p-1', filename: 'море.jpg' },
        { ...mockPhoto, id: 'p-2', filename: 'горы.png' },
      ];
      const q = params?.q;
      return Promise.resolve(
        photoList(q ? all.filter((p) => p.filename.toLowerCase().includes(q.toLowerCase())) : all),
      );
    });
    renderTable();
    await screen.findByText('море.jpg');

    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText('Поиск фото...'), {
      target: { value: 'гор' },
    });

    // Before the 300ms debounce fires, nothing is filtered yet
    expect(screen.getByText('море.jpg')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Back to real timers BEFORE async assertions — waitFor polling is
    // timer-driven and would hang under fake timers.
    vi.useRealTimers();

    await waitFor(() => {
      expect(screen.getByText('горы.png')).toBeInTheDocument();
      expect(screen.queryByText('море.jpg')).not.toBeInTheDocument();
    });
    // The server received the q param (GH #211 — server search).
    expect(mockGetPhotos).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'гор' }),
    );
  });
});
