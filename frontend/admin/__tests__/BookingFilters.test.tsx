/**
 * Tests for BookingFilters — the records filter bar.
 *
 * GH #212 Task 12: LEADING search field — a controlled input whose typing is
 * debounced 300ms (ClientsFilters' local useDebouncedCallback pattern) before
 * reaching onSearchChange → context setFilters({ search }) → server ?q=.
 * The reset button clears search via the page's resetFilters wiring.
 *
 * GH #213 Task 8 (spec §6.4): selection dropdowns own their data — three
 * DIRECT useQuery calls on the CANONICAL keys (['locations']/['services']/
 * ['masters']) with the RAW getAll* fetchers (TanStack dedupe with all other
 * consumers). Active-only via the client-side `!archived` filter; labels
 * l.name / s.title / m.first_name verbatim (NOT the transformed hooks).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/contexts/NavigationContext', () => ({ useNavigation: vi.fn() }));
vi.mock('@memo/api-client', () => ({
  getAllLocations: vi.fn(),
  getAllServices: vi.fn(),
  getAllMasters: vi.fn(),
}));

import { useNavigation } from '@/contexts/NavigationContext';
import { getAllLocations, getAllServices, getAllMasters } from '@memo/api-client';
import { BookingFilters } from '../app/(main)/records/components/BookingFilters';
import {
  mockLocationResponse,
  mockLocationResponseArchived,
  mockMasterResponse,
  mockMasterResponseArchived,
} from './helpers/mockData';
import type { ServiceResponse } from '@memo/api-client';

const mockUseNavigation = vi.mocked(useNavigation);

type BookingFiltersProps = React.ComponentProps<typeof BookingFilters>;

function defaultProps(overrides: Partial<BookingFiltersProps> = {}): BookingFiltersProps {
  return {
    locationId: '',
    serviceId: '',
    masterId: '',
    status: '',
    search: '',
    onLocationChange: vi.fn(),
    onServiceChange: vi.fn(),
    onMasterChange: vi.fn(),
    onStatusChange: vi.fn(),
    onSearchChange: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
}

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

/** Render the bar inside a QueryClientProvider (its own canonical-key queries). */
function renderFilters(overrides: Partial<BookingFiltersProps> = {}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BookingFilters {...defaultProps(overrides)} />
    </QueryClientProvider>,
  );
}

// findBy wait window: the default 1s findByRole timeout is too tight for the
// query-resolve → re-render cycle under parallel-suite CPU contention — the
// fetchers DO fire but the option render lands after the window (load-flake).
// 10s headroom mirrors the vitest.config testTimeout rationale.
const OPTION_WAIT = { timeout: 10_000 };

// Raw ServiceResponse fixtures — the bar consumes the RAW /all shapes
// (PhotoModal.test precedent: inline service fixture).
const ACTIVE_SERVICE: ServiceResponse = {
  id: 's1',
  title: 'Картина маслом',
  description: 'Живопись маслом',
  image_url: '',
  specialty: 'живопись',
  min_age: 12,
  max_age: 99,
  duration: 150,
  record_info: '',
  tariffs: [],
  tags: [],
  archived: false,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
};

const ARCHIVED_SERVICE: ServiceResponse = {
  ...ACTIVE_SERVICE,
  id: 's2',
  title: 'Акварель',
  archived: true,
};

beforeEach(() => {
  mockUseNavigation.mockReturnValue({
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    selectDateRange: vi.fn(),
  } as unknown as ReturnType<typeof useNavigation>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BookingFilters — search field (GH #212 Task 12)', () => {
  it('renders the search input with label, placeholder and aria-label', () => {
    renderFilters();
    const input = screen.getByLabelText('Поиск по клиенту или услуге');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Клиент или услуга...');
    expect(screen.getByText('Поиск')).toBeInTheDocument();
  });

  it('the search field is the LEADING (first) field of the bar', () => {
    const { container } = renderFilters();
    const bar = container.querySelector('.flex.flex-wrap')!;
    const firstField = bar.firstElementChild as HTMLElement;
    expect(
      within(firstField).getByLabelText('Поиск по клиенту или услуге'),
    ).toBeInTheDocument();
  });

  it('input displays the search prop value (controlled)', () => {
    renderFilters({ search: 'анна' });
    expect(screen.getByLabelText('Поиск по клиенту или услуге')).toHaveValue('анна');
  });

  it('clears the input when the search prop resets to empty', () => {
    const queryClient = createTestQueryClient();
    const utils = render(
      <QueryClientProvider client={queryClient}>
        <BookingFilters {...defaultProps({ search: 'анна' })} />
      </QueryClientProvider>,
    );
    utils.rerender(
      <QueryClientProvider client={queryClient}>
        <BookingFilters {...defaultProps({ search: '' })} />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText('Поиск по клиенту или услуге')).toHaveValue('');
  });

  it('reset button calls onReset (the page resets search with the other filters)', () => {
    const onReset = vi.fn();
    renderFilters({ onReset });
    fireEvent.click(screen.getByText('Сбросить'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  // ─── Debounce behavior (ClientsFilters convention — 300ms) ───────────────

  describe('search debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not call onSearchChange immediately on typing', () => {
      const onSearchChange = vi.fn();
      renderFilters({ onSearchChange });

      fireEvent.change(screen.getByLabelText('Поиск по клиенту или услуге'), {
        target: { value: 'анна' },
      });

      expect(onSearchChange).not.toHaveBeenCalled();
    });

    it('calls onSearchChange after the 300ms debounce', () => {
      const onSearchChange = vi.fn();
      renderFilters({ onSearchChange });

      fireEvent.change(screen.getByLabelText('Поиск по клиенту или услуге'), {
        target: { value: 'анна' },
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(onSearchChange).toHaveBeenCalledWith('анна');
    });

    it('debounce resets on rapid typing — only the last value is sent', () => {
      const onSearchChange = vi.fn();
      renderFilters({ onSearchChange });

      const input = screen.getByLabelText('Поиск по клиенту или услуге');

      fireEvent.change(input, { target: { value: 'а' } });
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.change(input, { target: { value: 'ан' } });
      act(() => { vi.advanceTimersByTime(100); });
      fireEvent.change(input, { target: { value: 'анна' } });
      act(() => { vi.advanceTimersByTime(350); });

      expect(onSearchChange).toHaveBeenCalledTimes(1);
      expect(onSearchChange).toHaveBeenCalledWith('анна');
    });
  });
});

describe('BookingFilters — selection data via canonical-key queries (GH #213 Task 8)', () => {
  beforeEach(() => {
    vi.mocked(getAllLocations).mockResolvedValue([
      mockLocationResponse,
      mockLocationResponseArchived,
    ]);
    vi.mocked(getAllServices).mockResolvedValue([ACTIVE_SERVICE, ARCHIVED_SERVICE]);
    vi.mocked(getAllMasters).mockResolvedValue([
      mockMasterResponse,
      mockMasterResponseArchived,
    ]);
  });

  it('populates dropdowns from its own raw getAll* queries', async () => {
    renderFilters();

    expect(getAllLocations).toHaveBeenCalled();
    expect(getAllServices).toHaveBeenCalled();
    expect(getAllMasters).toHaveBeenCalled();

    // Raw-shape labels: l.name / s.title / m.first_name — verbatim.
    await screen.findByRole('option', { name: 'Студия на Невском' }, OPTION_WAIT);
    await screen.findByRole('option', { name: 'Картина маслом' }, OPTION_WAIT);
    await screen.findByRole('option', { name: 'Ольга' }, OPTION_WAIT);
  });

  it('keeps active-only filtering — archived entities stay out of the dropdowns', async () => {
    renderFilters();

    await screen.findByRole('option', { name: 'Студия на Невском' }, OPTION_WAIT);
    await screen.findByRole('option', { name: 'Картина маслом' }, OPTION_WAIT);
    await screen.findByRole('option', { name: 'Ольга' }, OPTION_WAIT);

    expect(screen.queryByRole('option', { name: 'Гранд Отель Поляна' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Акварель' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Юлия' })).not.toBeInTheDocument();
  });

  it('does not read selection maps from RecordsContext anymore', async () => {
    // BookingFilters imports no RecordsContext at all (GH #213 Task 8) — the
    // dropdowns populate purely from the component's own canonical-key
    // queries. The «Все локации» placeholder + one active location remain.
    renderFilters();
    await screen.findByRole('option', { name: 'Студия на Невском' }, OPTION_WAIT);
    expect(
      within(screen.getByRole('combobox', { name: 'Фильтр по локации' })).getAllByRole('option'),
    ).toHaveLength(2); // «Все локации» + the one active location
  });
});
