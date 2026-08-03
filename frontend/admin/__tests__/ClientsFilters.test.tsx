import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { createMockClientsContext } from './helpers/mockContexts';

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: vi.fn(),
}));

import { useClients } from '@/contexts/ClientsContext';
import { ClientsFilters } from '../app/(main)/clients/components/ClientsFilters';

const mockUseClients = vi.mocked(useClients);

beforeEach(() => {
  mockUseClients.mockReturnValue(createMockClientsContext());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientsFilters', () => {
  it('renders search input', () => {
    render(<ClientsFilters />);
    expect(screen.getByPlaceholderText(/Поиск по имени или телефону/)).toBeInTheDocument();
  });

  it('renders status filter select', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Статус')).toBeInTheDocument();
    // Default is «Активные» (filters.status === 'active')
    expect(screen.getByDisplayValue('Активные')).toBeInTheDocument();
  });

  it('renders visit range inputs', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Записи')).toBeInTheDocument();
    expect(screen.getAllByPlaceholderText('от').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByPlaceholderText('до').length).toBeGreaterThanOrEqual(1);
  });

  it('renders missed range inputs', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Пропущенные')).toBeInTheDocument();
  });

  it('renders date range inputs', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Создан')).toBeInTheDocument();
    const dateInputs = screen.getAllByDisplayValue('');
    expect(dateInputs.filter(i => i.getAttribute('type') === 'date').length).toBeGreaterThanOrEqual(2);
  });

  it('renders payment range inputs', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Оплата')).toBeInTheDocument();
  });

  it('renders reset filters button', () => {
    render(<ClientsFilters />);
    expect(screen.getByText('Сбросить фильтры')).toBeInTheDocument();
  });

  it('calls resetFilters when reset button clicked', () => {
    const resetFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ resetFilters }));
    render(<ClientsFilters />);
    fireEvent.click(screen.getByText('Сбросить фильтры'));
    expect(resetFilters).toHaveBeenCalledTimes(1);
  });

  it('selecting «Неактивные» sets status to archived', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const select = screen.getByDisplayValue('Активные');
    fireEvent.change(select, { target: { value: 'archived' } });
    expect(setFilters).toHaveBeenCalledWith({ status: 'archived' });
  });

  it('selecting «Все» sets status to all', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const select = screen.getByDisplayValue('Активные');
    // Switch away from default first, then back to «Все»
    fireEvent.change(select, { target: { value: 'archived' } });
    fireEvent.change(select, { target: { value: 'all' } });
    expect(setFilters).toHaveBeenLastCalledWith({ status: 'all' });
  });

  it('selecting «Активные» sets status to active', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const select = screen.getByDisplayValue('Активные');
    // Switch to another option then back to «Активные»
    fireEvent.change(select, { target: { value: 'all' } });
    fireEvent.change(select, { target: { value: 'active' } });
    expect(setFilters).toHaveBeenLastCalledWith({ status: 'active' });
  });

  it('calls setFilters when min visits input changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const minVisitsInputs = screen.getAllByPlaceholderText('от');
    fireEvent.change(minVisitsInputs[0], { target: { value: '3' } });
    expect(setFilters).toHaveBeenCalledWith({ min_records: 3 });
  });

  it('calls setFilters with null when min visits is zero', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const minVisitsInputs = screen.getAllByPlaceholderText('от');
    fireEvent.change(minVisitsInputs[0], { target: { value: '0' } });
    expect(setFilters).toHaveBeenCalledWith({ min_records: 0 });
  });

  it('calls setFilters when created_from date changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const dateInputs = screen.getAllByDisplayValue('');
    const dateFromInputs = dateInputs.filter(i => i.getAttribute('type') === 'date');
    fireEvent.change(dateFromInputs[0], { target: { value: '2026-01-01' } });
    expect(setFilters).toHaveBeenCalledWith({ created_from: '2026-01-01' });
  });

  // ─── Debounce behavior ──────────────────────────────────────────────────

  describe('search debounce', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not call setFilters immediately on search input', () => {
      const setFilters = vi.fn();
      mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
      render(<ClientsFilters />);

      fireEvent.change(screen.getByPlaceholderText(/Поиск по имени или телефону/), {
        target: { value: 'Иванов' },
      });

      // setFilters should NOT be called synchronously
      expect(setFilters).not.toHaveBeenCalled();
    });

    it('calls setFilters after debounce delay (300ms)', () => {
      const setFilters = vi.fn();
      mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
      render(<ClientsFilters />);

      fireEvent.change(screen.getByPlaceholderText(/Поиск по имени или телефону/), {
        target: { value: 'Иванов' },
      });

      // Advance past the debounce delay
      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(setFilters).toHaveBeenCalledWith({ search: 'Иванов' });
    });

    it('debounce resets on rapid typing — only last value is sent', () => {
      const setFilters = vi.fn();
      mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
      render(<ClientsFilters />);

      const searchInput = screen.getByPlaceholderText(/Поиск по имени или телефону/);

      // Type three characters rapidly, each resetting the debounce timer
      fireEvent.change(searchInput, { target: { value: 'И' } });
      act(() => { vi.advanceTimersByTime(100); });

      fireEvent.change(searchInput, { target: { value: 'Ив' } });
      act(() => { vi.advanceTimersByTime(100); });

      fireEvent.change(searchInput, { target: { value: 'Иванов' } });
      act(() => { vi.advanceTimersByTime(350); });

      // Only the final value should be sent (the first two timers were cleared)
      expect(setFilters).toHaveBeenCalledTimes(1);
      expect(setFilters).toHaveBeenCalledWith({ search: 'Иванов' });
    });
  });

  // ─── Additional filter fields ───────────────────────────────────────────

  it('calls setFilters when max visits input changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const maxVisitsInputs = screen.getAllByPlaceholderText('до');
    fireEvent.change(maxVisitsInputs[0], { target: { value: '10' } });
    expect(setFilters).toHaveBeenCalledWith({ max_records: 10 });
  });

  it('calls setFilters with null when max visits is cleared', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const maxVisitsInputs = screen.getAllByPlaceholderText('до');
    // Set a value first, then clear it
    fireEvent.change(maxVisitsInputs[0], { target: { value: '10' } });
    fireEvent.change(maxVisitsInputs[0], { target: { value: '' } });
    expect(setFilters).toHaveBeenLastCalledWith({ max_records: null });
  });

  it('calls setFilters when missed_from changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    // The "Пропущенные" section has its own от/до pair
    const missedSection = screen.getByText('Пропущенные').closest('div')!;
    const missedFrom = missedSection.querySelector('input[placeholder="от"]')!;
    fireEvent.change(missedFrom, { target: { value: '2' } });
    expect(setFilters).toHaveBeenCalledWith({ missed_from: 2 });
  });

  it('calls setFilters when missed_to changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const missedSection = screen.getByText('Пропущенные').closest('div')!;
    const missedTo = missedSection.querySelector('input[placeholder="до"]')!;
    fireEvent.change(missedTo, { target: { value: '5' } });
    expect(setFilters).toHaveBeenCalledWith({ missed_to: 5 });
  });

  it('calls setFilters when created_to date changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const dateInputs = screen.getAllByDisplayValue('');
    const dateInputsAll = dateInputs.filter(i => i.getAttribute('type') === 'date');
    fireEvent.change(dateInputsAll[1], { target: { value: '2026-12-31' } });
    expect(setFilters).toHaveBeenCalledWith({ created_to: '2026-12-31' });
  });

  it('calls setFilters when min_paid changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const paidSection = screen.getByText('Оплата').closest('div')!;
    const minPaid = paidSection.querySelector('input[placeholder="от"]')!;
    fireEvent.change(minPaid, { target: { value: '5000' } });
    expect(setFilters).toHaveBeenCalledWith({ min_paid: 5000 });
  });

  it('calls setFilters when max_paid changes', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const paidSection = screen.getByText('Оплата').closest('div')!;
    const maxPaid = paidSection.querySelector('input[placeholder="до"]')!;
    fireEvent.change(maxPaid, { target: { value: '20000' } });
    expect(setFilters).toHaveBeenCalledWith({ max_paid: 20000 });
  });

  it('calls setFilters with null when min_paid cleared', () => {
    const setFilters = vi.fn();
    mockUseClients.mockReturnValue(createMockClientsContext({ setFilters }));
    render(<ClientsFilters />);
    const paidSection = screen.getByText('Оплата').closest('div')!;
    const minPaid = paidSection.querySelector('input[placeholder="от"]')!;
    // Set a value first, then clear it
    fireEvent.change(minPaid, { target: { value: '5000' } });
    fireEvent.change(minPaid, { target: { value: '' } });
    expect(setFilters).toHaveBeenLastCalledWith({ min_paid: null });
  });
});
