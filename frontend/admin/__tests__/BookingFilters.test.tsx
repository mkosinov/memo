/**
 * Tests for BookingFilters — the records filter bar (GH #212 Task 12).
 *
 * The bar gains a LEADING search field: a controlled input whose typing is
 * debounced 300ms (ClientsFilters' local useDebouncedCallback pattern) before
 * reaching onSearchChange → context setFilters({ search }) → server ?q=.
 * The reset button clears search via the page's resetFilters wiring.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/contexts/NavigationContext', () => ({ useNavigation: vi.fn() }));
vi.mock('@/contexts/RecordsContext', () => ({ useRecords: vi.fn() }));

import { useNavigation } from '@/contexts/NavigationContext';
import { useRecords } from '@/contexts/RecordsContext';
import { BookingFilters } from '../app/(main)/records/components/BookingFilters';

const mockUseNavigation = vi.mocked(useNavigation);
const mockUseRecords = vi.mocked(useRecords);

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

beforeEach(() => {
  mockUseNavigation.mockReturnValue({
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    selectDateRange: vi.fn(),
  } as unknown as ReturnType<typeof useNavigation>);
  mockUseRecords.mockReturnValue({
    locations: new Map(),
    services: new Map(),
    masters: new Map(),
  } as unknown as ReturnType<typeof useRecords>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('BookingFilters — search field (GH #212 Task 12)', () => {
  it('renders the search input with label, placeholder and aria-label', () => {
    render(<BookingFilters {...defaultProps()} />);
    const input = screen.getByLabelText('Поиск по клиенту или услуге');
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('placeholder', 'Клиент или услуга...');
    expect(screen.getByText('Поиск')).toBeInTheDocument();
  });

  it('the search field is the LEADING (first) field of the bar', () => {
    const { container } = render(<BookingFilters {...defaultProps()} />);
    const bar = container.querySelector('.flex.flex-wrap')!;
    const firstField = bar.firstElementChild as HTMLElement;
    expect(
      within(firstField).getByLabelText('Поиск по клиенту или услуге'),
    ).toBeInTheDocument();
  });

  it('input displays the search prop value (controlled)', () => {
    render(<BookingFilters {...defaultProps({ search: 'анна' })} />);
    expect(screen.getByLabelText('Поиск по клиенту или услуге')).toHaveValue('анна');
  });

  it('clears the input when the search prop resets to empty', () => {
    const { rerender } = render(<BookingFilters {...defaultProps({ search: 'анна' })} />);
    rerender(<BookingFilters {...defaultProps({ search: '' })} />);
    expect(screen.getByLabelText('Поиск по клиенту или услуге')).toHaveValue('');
  });

  it('reset button calls onReset (the page resets search with the other filters)', () => {
    const onReset = vi.fn();
    render(<BookingFilters {...defaultProps({ onReset })} />);
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
      render(<BookingFilters {...defaultProps({ onSearchChange })} />);

      fireEvent.change(screen.getByLabelText('Поиск по клиенту или услуге'), {
        target: { value: 'анна' },
      });

      expect(onSearchChange).not.toHaveBeenCalled();
    });

    it('calls onSearchChange after the 300ms debounce', () => {
      const onSearchChange = vi.fn();
      render(<BookingFilters {...defaultProps({ onSearchChange })} />);

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
      render(<BookingFilters {...defaultProps({ onSearchChange })} />);

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
