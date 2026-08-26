import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, TagResponse } from '@memo/api-client';

// ─── Mock @tanstack/react-query ──────────────────────────────────────────
// Only useQueryClient is mocked; useQuery/QueryClientProvider stay REAL: the
// table renders inside the real TagsProvider, and the server-pagination wiring
// is asserted through the getTags spy (MastersTable precedent). The error-state
// and status-column regression cases keep their assertions — they now drive
// data through the real provider instead of mocking useQuery directly.

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

vi.mock('@/hooks/useTagsMutations', () => ({
  useUpdateTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/(main)/tags/components/TagModal', () => ({
  TagModal: () => null,
}));

vi.mock('@/app/components/shared/ColumnPicker', () => ({
  ColumnPicker: () => null,
}));

// ─── Mock @memo/api-client — spy on getTags (preserve other exports) ─────

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getTags: vi.fn() };
});

// ─── Import after mocks ──────────────────────────────────────────────────

import { getTags } from '@memo/api-client';
import { TagsTable } from '@/app/(main)/tags/components/TagsTable';
import { TagsProvider } from '@/contexts/TagsContext';

const mockGetTags = vi.mocked(getTags);

// ─── Test data ───────────────────────────────────────────────────────────

// Minimal mock tags — TagResponse only has { id, tag }
const TEST_TAGS: TagResponse[] = [
  { id: 't-1', tag: 'Живопись' },
  { id: 't-2', tag: 'Керамика' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────

function setupEnvelope(overrides: Partial<PaginatedResponse<TagResponse>> = {}) {
  mockGetTags.mockResolvedValue({
    items: TEST_TAGS,
    total: TEST_TAGS.length,
    page: 1,
    per_page: 10,
    ...overrides,
  });
}

/** Real TagsProvider + real QueryClient; list data flows through the mocked getTags. */
function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TagsProvider>
        <TagsTable />
      </TagsProvider>
    </QueryClientProvider>,
  );
}

/** Render and wait for the server page to load. */
async function renderLoaded() {
  const view = renderTable();
  await screen.findByText('Живопись');
  return view;
}

describe('TagsTable error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows ErrorState when the tags fetch fails', async () => {
    mockGetTags.mockRejectedValue(new Error('boom'));
    renderTable();
    expect(await screen.findByTestId('error-state')).toBeInTheDocument();
  });

  it('does not show ErrorState when no error', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();
    await screen.findByText('Нет записей');
    expect(screen.queryByTestId('error-state')).not.toBeInTheDocument();
  });
});

describe('TagsTable status column removal (GH #194)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render a "Статус" column header', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();
    await screen.findByText('Нет записей');
    // exact:false → catches "Статус ↕" (sort icon appended to header label).
    expect(screen.queryByText('Статус', { exact: false })).not.toBeInTheDocument();
  });

  it('does not render an "Активен" status badge for a row', async () => {
    setupEnvelope({ items: [{ id: 't-1', tag: 'Живопись' }], total: 1 });
    renderTable();
    // The row itself should render the tag name…
    expect(await screen.findByText('Живопись')).toBeInTheDocument();
    // …but no "Активен" badge (tags have no archive status at all).
    expect(screen.queryByText('Активен')).not.toBeInTheDocument();
  });
});

describe('TagsTable server pagination/sort (#205 §5.2/§5.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Server fetch params — no status anywhere (tags have none) ─────────

  it('initial fetch sends page/per_page only — NO status, NO sort params', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(mockGetTags).toHaveBeenCalledTimes(1);
    expect(mockGetTags).toHaveBeenCalledWith({ page: 1, per_page: 10 });
    // sortBy starts null → sort params omitted → server default tag ASC, id ASC.
    expect(mockGetTags.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(mockGetTags.mock.calls[0][0]).not.toHaveProperty('sort_order');
    // withStatus: false → no status key in query/fetcher params at all.
    expect(mockGetTags.mock.calls[0][0]).not.toHaveProperty('status');
  });

  // ─── Search (GH #212 T11 — server-side via ?q=; #205 degradation ends) ──
  // The DataTable input debounces 300ms before setSearch; the factory clamps
  // q to ≥2 chars and sends it to getTags. Rows render exactly what the
  // server returned — no client filtering (#139 predicate removed).

  it('searches server-side via ?q= (fetch carries q, rows stay server-returned)', async () => {
    setupEnvelope();
    await renderLoaded();

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByPlaceholderText('Поиск тегов...'), {
        target: { value: 'жив' },
      });

      // Before the 300ms debounce fires, no refetch yet
      expect(mockGetTags).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => {
      expect(mockGetTags).toHaveBeenCalledWith(expect.objectContaining({ q: 'жив' }));
    });
    // No client filtering — setupEnvelope's items stay visible regardless of match
    expect(screen.getByText('Живопись')).toBeInTheDocument();
    expect(screen.getByText('Керамика')).toBeInTheDocument();
  });

  it('✕ clears search and refetches without q', async () => {
    setupEnvelope();
    await renderLoaded();

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByPlaceholderText('Поиск тегов...'), {
        target: { value: 'жив' },
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => {
      expect(mockGetTags).toHaveBeenCalledWith(expect.objectContaining({ q: 'жив' }));
    });

    // ✕ submits '' immediately (no debounce) → refetch without q
    fireEvent.click(screen.getByLabelText('Очистить поиск'));

    await waitFor(() => {
      expect(mockGetTags).toHaveBeenLastCalledWith({ page: 1, per_page: 10 });
    });
  });

  it('does not fire q on 1 char (≥2 clamp — treated as unset)', async () => {
    setupEnvelope();
    await renderLoaded();

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByPlaceholderText('Поиск тегов...'), {
        target: { value: 'ж' },
      });
      act(() => {
        vi.advanceTimersByTime(300);
      });
    } finally {
      vi.useRealTimers();
    }

    // Raw input state reflects the char, but no q fetch fires
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Поиск тегов...')).toHaveValue('ж');
    });
    expect(mockGetTags).toHaveBeenCalledTimes(1);
    expect(mockGetTags.mock.calls[0][0]).not.toHaveProperty('q');
  });

  // ─── Server-driven pagination wiring ───────────────────────────────────

  it('pager renders 5 numbered pages from server total 42 and page click refetches', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    expect(screen.getByText('42 всего')).toBeInTheDocument();
    for (let i = 1; i <= 5; i += 1) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(mockGetTags).toHaveBeenCalledWith({ page: 2, per_page: 10 });
    });
  });

  it('page-size select refetches page 1 with the new per_page', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '20' } });

    await waitFor(() => {
      expect(mockGetTags).toHaveBeenCalledWith({ page: 1, per_page: 20 });
    });
  });

  // ─── Sort header → server sort (single sortable key: tag) ──────────────

  it('first header click sorts asc, second click toggles desc (server sort)', async () => {
    setupEnvelope();
    await renderLoaded();

    const tagHeader = screen.getByText(/Тег/);
    // No sort picked yet → neutral indicator
    expect(tagHeader.textContent).toContain('↕');

    fireEvent.click(tagHeader);
    await waitFor(() => {
      expect(mockGetTags).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        sort_by: 'tag',
        sort_order: 'asc',
      });
    });
    expect(screen.getByText(/Тег/).textContent).toContain('↑');

    fireEvent.click(tagHeader);
    await waitFor(() => {
      expect(mockGetTags).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        sort_by: 'tag',
        sort_order: 'desc',
      });
    });
    expect(screen.getByText(/Тег/).textContent).toContain('↓');
  });
});

describe('TagsTable row parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Review follow-up (#139 T1): rowClassName restores the pre-#139 Tags row
  // hover style (old TagsTable <tr> classes: border-b cursor-pointer
  // transition-colors hover:opacity-80). Prevents silent hover-parity drift.
  it('rows keep the pre-#139 hover:opacity-80 style', async () => {
    setupEnvelope();
    await renderLoaded();

    const row = screen.getByTestId('tag-row-t-1');
    expect(row.className).toContain('hover:opacity-80');
  });
});
