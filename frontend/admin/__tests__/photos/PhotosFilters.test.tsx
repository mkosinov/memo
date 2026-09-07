/**
 * Tests for PhotosFilters — the photos filter bar (GH #211 Task 8).
 *
 * Five controls + reset, consuming the server-driven PhotosContext via
 * usePhotosTable (mocked — ClientsFilters.test precedent):
 *   Клиент     — RemoteSearchSelect over getClientsPaged({ q, per_page, status: 'active' })
 *   Активность — RemoteSearchSelect over getActivities({ q, per_page }); options render
 *                the canonical label (spec §7.7) via formatActivityLabel + locationsMap
 *   Услуга     — Combobox over servicesMap («Все услуги» pinned clear option)
 *   Локация    — Combobox over locationsMap («Все локации»)
 *   Теги       — chips + add-typeahead over getAllTags() (PhotoModal multi pattern)
 *   Сбросить   — resetFilters() + visually clears the typeaheads
 *
 * The tags dictionary loads through the REAL useQuery (only useQueryClient is
 * left alone — the component is wrapped in a real QueryClientProvider,
 * PhotosTable.test precedent).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMockPhotosContext } from '../helpers/mockContexts';
import { createMockLocationResponse, mockClientWithStats } from '../helpers/mockData';

vi.mock('@/contexts/PhotosContext', () => ({
  usePhotosTable: vi.fn(),
}));

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getClientsPaged: vi.fn(),
    getActivities: vi.fn(),
    getAllTags: vi.fn(),
  };
});

import { getClientsPaged, getActivities, getAllTags } from '@memo/api-client';
import type { ServiceResponse, ActivityResponse, TagResponse } from '@memo/api-client';
import { usePhotosTable } from '@/contexts/PhotosContext';
import { PhotosFilters } from '../../app/(main)/photos/components/PhotosFilters';
import type { PhotosContextType } from '@/contexts/PhotosContext';

const mockUsePhotosTable = vi.mocked(usePhotosTable);
const mockGetClientsPaged = vi.mocked(getClientsPaged);
const mockGetActivities = vi.mocked(getActivities);
const mockGetAllTags = vi.mocked(getAllTags);

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** PaginatedResponse envelope (list endpoints return envelopes). */
function envelope<T>(items: T[]): { items: T[]; total: number; page: number; per_page: number } {
  return { items, total: items.length, page: 1, per_page: 10 };
}

function makeService(id: string, overrides: Partial<ServiceResponse> = {}): ServiceResponse {
  return {
    id,
    title: `Service ${id}`,
    description: '',
    image_url: '',
    specialty: '',
    min_age: 0,
    max_age: null,
    duration: 60,
    record_info: '',
    tariffs: [],
    tags: [],
    materials: [],
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Canonical-label fixture: start without a timezone suffix → local-time
// semantics (utils.test.ts precedent). location_id matches
// createMockLocationResponse's id ('loc-1', name 'Студия на Невском').
const ACTIVITY_FIXTURE: ActivityResponse = {
  id: 'a1',
  master_id: 'm1',
  service_id: 's1',
  location_id: 'loc-1',
  start: '2026-06-07T14:05:00',
  duration: 90,
  capacity: 10,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  occupied: 0,
  service_title: 'День рождения',
};

const TAG_FIXTURES: TagResponse[] = [
  { id: 't-1', tag: 'Гуашь' },
  { id: 't-2', tag: 'Керамика' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────

function setup(overrides: Partial<PhotosContextType> = {}) {
  mockUsePhotosTable.mockReturnValue(createMockPhotosContext(overrides));
}

/** Real QueryClientProvider — the tags dictionary flows through real useQuery. */
function renderFilters() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <PhotosFilters />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

/**
 * Type into a RemoteSearchSelect input and let its 300ms debounce fire
 * (PhotosTable.test timer-switch pattern: fake timers only around the
 * debounce, real timers for the async assertions that follow).
 */
function typeAndDebounce(input: HTMLElement, value: string) {
  vi.useFakeTimers();
  try {
    fireEvent.change(input, { target: { value } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
  } finally {
    vi.useRealTimers();
  }
}

/** Wait until the tags dictionary query has settled in the cache. */
async function waitForTagsLoaded(queryClient: QueryClient) {
  await waitFor(() => {
    expect(queryClient.getQueryData(['tags'])).toEqual(TAG_FIXTURES);
  });
  // Flush the observer → component state propagation.
  await act(async () => {});
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetClientsPaged.mockResolvedValue(envelope([mockClientWithStats]));
  mockGetActivities.mockResolvedValue(envelope([ACTIVITY_FIXTURE]));
  mockGetAllTags.mockResolvedValue(TAG_FIXTURES);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('PhotosFilters — controls render (GH #211 Task 8)', () => {
  it('renders the 5 filter controls and the reset button', () => {
    setup();
    renderFilters();

    // Two typeaheads (RemoteSearchSelect renders its label text)…
    expect(screen.getByText('Клиент')).toBeInTheDocument();
    expect(screen.getByText('Активность')).toBeInTheDocument();
    // …two plain selects with labels + «Все …» empty options…
    expect(screen.getByText('Услуга')).toBeInTheDocument();
    expect(screen.getByText('Все услуги')).toBeInTheDocument();
    expect(screen.getByText('Локация')).toBeInTheDocument();
    expect(screen.getByText('Все локации')).toBeInTheDocument();
    // …the tags control…
    expect(screen.getByText('Теги')).toBeInTheDocument();
    // …and the reset button.
    expect(screen.getByText('Сбросить')).toBeInTheDocument();
  });

  it('loads the tags dictionary via getAllTags', async () => {
    setup();
    const { queryClient } = renderFilters();
    await waitForTagsLoaded(queryClient);
    expect(mockGetAllTags).toHaveBeenCalledTimes(1);
  });
});

describe('PhotosFilters — change → setFilters payloads', () => {
  // GH #214 Task 9 (§6 rows 13-14): the two native selects are Combobox —
  // options exist in the DOM only while their dropdown is open, so each flow
  // is open-trigger (aria-label carries getByLabelText) → option interaction.

  it('selecting a service calls setFilters({ service_id })', async () => {
    const setFilters = vi.fn();
    setup({ setFilters, servicesMap: new Map([['s-1', makeService('s-1', { title: 'Гончарный МК' })]]) });
    renderFilters();

    fireEvent.click(screen.getByLabelText('Фильтр по услуге'));
    await screen.findByRole('option', { name: 'Гончарный МК' });
    fireEvent.click(screen.getByTestId('combobox-option-s-1'));

    expect(setFilters).toHaveBeenCalledWith({ service_id: 's-1' });
  });

  it('selecting «Все услуги» clears service_id', async () => {
    const setFilters = vi.fn();
    setup({ setFilters, servicesMap: new Map([['s-1', makeService('s-1')]]) });
    renderFilters();

    fireEvent.click(screen.getByLabelText('Фильтр по услуге'));
    expect(screen.getByTestId('combobox-option-clear')).toHaveTextContent('Все услуги');
    fireEvent.click(screen.getByTestId('combobox-option-clear'));

    expect(setFilters).toHaveBeenCalledWith({ service_id: undefined });
  });

  it('selecting a location calls setFilters({ location_id })', async () => {
    const setFilters = vi.fn();
    setup({ setFilters, locationsMap: new Map([['loc-1', createMockLocationResponse()]]) });
    renderFilters();

    fireEvent.click(screen.getByLabelText('Фильтр по локации'));
    await screen.findByRole('option', { name: 'Студия на Невском' });
    // Type filters the options — haystack is `${l.name} ${l.short_title ?? ''}` (§6.2).
    fireEvent.change(screen.getByTestId('combobox-search'), { target: { value: 'невск' } });
    expect(screen.getByRole('option', { name: 'Студия на Невском' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('combobox-option-loc-1'));

    expect(setFilters).toHaveBeenCalledWith({ location_id: 'loc-1' });
  });

  it('clicking Сбросить calls resetFilters', () => {
    const resetFilters = vi.fn();
    setup({ resetFilters });
    renderFilters();

    fireEvent.click(screen.getByText('Сбросить'));

    expect(resetFilters).toHaveBeenCalledTimes(1);
  });
});

describe('PhotosFilters — client typeahead', () => {
  it('searches active clients and selects the client_id', async () => {
    const setFilters = vi.fn();
    setup({ setFilters });
    renderFilters();

    typeAndDebounce(screen.getByRole('textbox', { name: 'Клиент' }), 'Ан');

    await waitFor(() => {
      expect(mockGetClientsPaged).toHaveBeenCalledWith({ q: 'Ан', per_page: 10, status: 'active' });
    });
    const option = await screen.findByText('Анна Иванова');
    fireEvent.click(option);

    expect(setFilters).toHaveBeenCalledWith({ client_id: 'c1' });
  });
});

describe('PhotosFilters — activity typeahead canonical label (spec §7.7)', () => {
  it('renders options via formatActivityLabel + locationsMap and selects the activity_id', async () => {
    const setFilters = vi.fn();
    setup({
      setFilters,
      locationsMap: new Map([['loc-1', createMockLocationResponse()]]),
    });
    renderFilters();

    typeAndDebounce(screen.getByRole('textbox', { name: 'Активность' }), 'Де');

    await waitFor(() => {
      expect(mockGetActivities).toHaveBeenCalledWith({ q: 'Де', per_page: 10 });
    });
    // «dd.mm.yyyy HH:mm — Локация — Услуга» (date-first, location resolved
    // from the context map).
    const option = await screen.findByText('07.06.2026 14:05 — Студия на Невском — День рождения');
    fireEvent.click(option);

    expect(setFilters).toHaveBeenCalledWith({ activity_id: 'a1' });
  });
});

describe('PhotosFilters — tag chips (PhotoModal multi pattern)', () => {
  it('adds a tag chip via the typeahead', async () => {
    const setFilters = vi.fn();
    setup({ setFilters });
    const { queryClient } = renderFilters();
    await waitForTagsLoaded(queryClient);

    typeAndDebounce(screen.getByPlaceholderText('Добавить тег...'), 'Гу');

    const option = await screen.findByText('Гуашь');
    fireEvent.click(option);

    expect(setFilters).toHaveBeenCalledWith({ tag_id: ['t-1'] });
  });

  it('removes a tag chip via its ✕ button', async () => {
    const setFilters = vi.fn();
    setup({ setFilters, filters: { tag_id: ['t-1'] } });
    renderFilters();

    // The chip label resolves from the tags dictionary once it loads.
    const removeButton = await screen.findByLabelText('Удалить тег Гуашь');
    fireEvent.click(removeButton);

    expect(setFilters).toHaveBeenCalledWith({ tag_id: [] });
  });
});

describe('PhotosFilters — reset clears the typeaheads visually', () => {
  it('Сбросить clears the selected client label (remount)', async () => {
    const setFilters = vi.fn();
    setup({ setFilters });
    renderFilters();

    const input = screen.getByRole('textbox', { name: 'Клиент' });
    typeAndDebounce(input, 'Ан');
    const option = await screen.findByText('Анна Иванова');
    fireEvent.click(option);

    // Selected value is displayed…
    expect(screen.getByRole('textbox', { name: 'Клиент' })).toHaveValue('Анна Иванова');

    fireEvent.click(screen.getByText('Сбросить'));

    // …and after reset the typeahead shows no stale selection.
    expect(screen.getByRole('textbox', { name: 'Клиент' })).toHaveValue('');
  });
});
