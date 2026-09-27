import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { createMockClientsTableState } from './helpers/mockContexts';

// importOriginal keeps the real `defaultFilters` export available — the
// shared mockContexts fixture imports it for createMockClientsTableState.
vi.mock('@/contexts/ClientsContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/ClientsContext')>();
  return {
    ...actual,
    useClientsTable: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/clients',
}));

import { useClientsTable } from '@/contexts/ClientsContext';
import { ClientsFilters } from '../app/(main)/clients/components/ClientsFilters';

const mockUseClientsTable = vi.mocked(useClientsTable);

beforeEach(() => {
  mockUseClientsTable.mockReturnValue(createMockClientsTableState());
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
    // Default is «Активные» (canonical ctx.status === 'active')
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
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ resetFilters }));
    render(<ClientsFilters />);
    fireEvent.click(screen.getByText('Сбросить фильтры'));
    expect(resetFilters).toHaveBeenCalledTimes(1);
  });

  // #349 Task 4: the status select binds to the CANONICAL status member
  // (URL-backed) — the setter is setStatus, not setFilters.
  it('selecting «Неактивные» calls setStatus(archived)', () => {
    const setStatus = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setStatus }));
    render(<ClientsFilters />);
    const select = screen.getByDisplayValue('Активные');
    fireEvent.change(select, { target: { value: 'archived' } });
    expect(setStatus).toHaveBeenCalledWith('archived');
  });

  it('selecting «Все» calls setStatus(all)', () => {
    const setStatus = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setStatus }));
    render(<ClientsFilters />);
    const select = screen.getByDisplayValue('Активные');
    // Switch away from default first, then to «Все»
    fireEvent.change(select, { target: { value: 'archived' } });
    fireEvent.change(select, { target: { value: 'all' } });
    expect(setStatus).toHaveBeenLastCalledWith('all');
  });

  it('selecting «Активные» calls setStatus(active)', () => {
    const setStatus = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setStatus }));
    render(<ClientsFilters />);
    const select = screen.getByDisplayValue('Активные');
    // Switch to another option then back to «Активные»
    fireEvent.change(select, { target: { value: 'all' } });
    fireEvent.change(select, { target: { value: 'active' } });
    expect(setStatus).toHaveBeenLastCalledWith('active');
  });

  it('calls setFilters when min visits input changes', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const minVisitsInputs = screen.getAllByPlaceholderText('от');
    fireEvent.change(minVisitsInputs[0], { target: { value: '3' } });
    expect(setFilters).toHaveBeenCalledWith({ min_records: 3 });
  });

  it('calls setFilters with null when min visits is zero', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const minVisitsInputs = screen.getAllByPlaceholderText('от');
    fireEvent.change(minVisitsInputs[0], { target: { value: '0' } });
    expect(setFilters).toHaveBeenCalledWith({ min_records: 0 });
  });

  it('calls setFilters when created_from date changes', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
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

    it('does not call setSearch immediately on search input', () => {
      const setSearch = vi.fn();
      mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setSearch }));
      render(<ClientsFilters />);

      fireEvent.change(screen.getByPlaceholderText(/Поиск по имени или телефону/), {
        target: { value: 'Иванов' },
      });

      // setSearch should NOT be called synchronously
      expect(setSearch).not.toHaveBeenCalled();
    });

    it('calls setSearch after debounce delay (300ms)', () => {
      const setSearch = vi.fn();
      mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setSearch }));
      render(<ClientsFilters />);

      fireEvent.change(screen.getByPlaceholderText(/Поиск по имени или телефону/), {
        target: { value: 'Иванов' },
      });

      // Advance past the debounce delay
      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(setSearch).toHaveBeenCalledWith('Иванов');
    });

    it('debounce resets on rapid typing — only last value is sent', () => {
      const setSearch = vi.fn();
      mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setSearch }));
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
      expect(setSearch).toHaveBeenCalledTimes(1);
      expect(setSearch).toHaveBeenCalledWith('Иванов');
    });
  });

  // ─── Additional filter fields ───────────────────────────────────────────

  it('calls setFilters when max visits input changes', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const maxVisitsInputs = screen.getAllByPlaceholderText('до');
    fireEvent.change(maxVisitsInputs[0], { target: { value: '10' } });
    expect(setFilters).toHaveBeenCalledWith({ max_records: 10 });
  });

  it('calls setFilters with null when max visits is cleared', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const maxVisitsInputs = screen.getAllByPlaceholderText('до');
    // Set a value first, then clear it
    fireEvent.change(maxVisitsInputs[0], { target: { value: '10' } });
    fireEvent.change(maxVisitsInputs[0], { target: { value: '' } });
    expect(setFilters).toHaveBeenLastCalledWith({ max_records: null });
  });

  it('calls setFilters when missed_from changes', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    // The "Пропущенные" section has its own от/до pair
    const missedSection = screen.getByText('Пропущенные').closest('div')!;
    const missedFrom = missedSection.querySelector('input[placeholder="от"]')!;
    fireEvent.change(missedFrom, { target: { value: '2' } });
    expect(setFilters).toHaveBeenCalledWith({ missed_from: 2 });
  });

  it('calls setFilters when missed_to changes', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const missedSection = screen.getByText('Пропущенные').closest('div')!;
    const missedTo = missedSection.querySelector('input[placeholder="до"]')!;
    fireEvent.change(missedTo, { target: { value: '5' } });
    expect(setFilters).toHaveBeenCalledWith({ missed_to: 5 });
  });

  it('calls setFilters when created_to date changes', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const dateInputs = screen.getAllByDisplayValue('');
    const dateInputsAll = dateInputs.filter(i => i.getAttribute('type') === 'date');
    fireEvent.change(dateInputsAll[1], { target: { value: '2026-12-31' } });
    expect(setFilters).toHaveBeenCalledWith({ created_to: '2026-12-31' });
  });

  it('calls setFilters when min_paid changes', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const paidSection = screen.getByText('Оплата').closest('div')!;
    const minPaid = paidSection.querySelector('input[placeholder="от"]')!;
    fireEvent.change(minPaid, { target: { value: '5000' } });
    expect(setFilters).toHaveBeenCalledWith({ min_paid: 5000 });
  });

  it('calls setFilters when max_paid changes', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const paidSection = screen.getByText('Оплата').closest('div')!;
    const maxPaid = paidSection.querySelector('input[placeholder="до"]')!;
    fireEvent.change(maxPaid, { target: { value: '20000' } });
    expect(setFilters).toHaveBeenCalledWith({ max_paid: 20000 });
  });

  it('calls setFilters with null when min_paid cleared', () => {
    const setFilters = vi.fn();
    mockUseClientsTable.mockReturnValue(createMockClientsTableState({ setFilters }));
    render(<ClientsFilters />);
    const paidSection = screen.getByText('Оплата').closest('div')!;
    const minPaid = paidSection.querySelector('input[placeholder="от"]')!;
    // Set a value first, then clear it
    fireEvent.change(minPaid, { target: { value: '5000' } });
    fireEvent.change(minPaid, { target: { value: '' } });
    expect(setFilters).toHaveBeenLastCalledWith({ min_paid: null });
  });
});

describe('ClientsFilters — controlled search input (GH #216 / #349 canonical q)', () => {
  /** ctx.search / ctx.status override against the shared fixture. */
  function mockCtx(overrides: { search?: string; status?: string } = {}) {
    const ctx = createMockClientsTableState({
      search: overrides.search ?? '',
      status: (overrides.status ?? 'active') as ReturnType<typeof createMockClientsTableState>['status'],
    });
    mockUseClientsTable.mockReturnValue(ctx);
    return ctx;
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const searchInput = () => screen.getByPlaceholderText(/Поиск по имени или телефону/);

  it('displays an externally committed search value (URL ?q=)', () => {
    mockCtx({ search: 'анна' });
    render(<ClientsFilters />);
    expect(searchInput()).toHaveValue('анна');
  });

  it('typing updates the draft immediately and commits once after 300ms', () => {
    const ctx = mockCtx();
    render(<ClientsFilters />);
    fireEvent.change(searchInput(), { target: { value: 'иван' } });
    expect(searchInput()).toHaveValue('иван');
    expect(ctx.setSearch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(ctx.setSearch).toHaveBeenCalledWith('иван');
  });

  it('each keystroke restarts the timer (debounce), single commit with final value', () => {
    const ctx = mockCtx();
    render(<ClientsFilters />);
    fireEvent.change(searchInput(), { target: { value: 'ив' } });
    act(() => { vi.advanceTimersByTime(250); });
    fireEvent.change(searchInput(), { target: { value: 'иван' } });
    act(() => { vi.advanceTimersByTime(100); });
    expect(ctx.setSearch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(250); });
    expect(ctx.setSearch).toHaveBeenCalledTimes(1);
    expect(ctx.setSearch).toHaveBeenCalledWith('иван');
  });

  it('type → «Сбросить фильтры» within 300ms: reset wins, timer cancelled, box cleared', () => {
    const ctx = mockCtx();
    render(<ClientsFilters />);
    fireEvent.change(searchInput(), { target: { value: 'а' } });
    fireEvent.click(screen.getByText('Сбросить фильтры'));
    expect(ctx.resetFilters).toHaveBeenCalled();
    expect(searchInput()).toHaveValue('');
    act(() => { vi.advanceTimersByTime(400); });
    expect(ctx.setSearch).not.toHaveBeenCalledWith('а');
  });

  it('mid-life external commit syncs the box when not dirty, nothing resurrects', () => {
    const ctx = mockCtx();
    const { rerender } = render(<ClientsFilters />);
    // no typing → not dirty; an external commit lands post-mount (back/forward)
    mockCtx({ search: 'мария' });
    rerender(<ClientsFilters />);
    expect(searchInput()).toHaveValue('мария');
    // the sync branch cancelled any armed timer — nothing may resurrect the old value
    act(() => { vi.advanceTimersByTime(400); });
    expect(ctx.setSearch).not.toHaveBeenCalled();
  });

  it('external commit while user typed ahead keeps the draft (no clobber)', () => {
    const ctx = mockCtx();
    const { rerender } = render(<ClientsFilters />);
    fireEvent.change(searchInput(), { target: { value: 'ив' } });
    // an older commit lands (e.g. previous debounce fired) — draft must survive
    mockCtx({ search: 'чужое' });
    rerender(<ClientsFilters />);
    expect(searchInput()).toHaveValue('ив');
    act(() => { vi.advanceTimersByTime(300); });
    expect(ctx.setSearch).toHaveBeenCalledWith('ив');
  });

  it('status select is controlled by the canonical ctx.status', () => {
    mockCtx({ status: 'all' });
    render(<ClientsFilters />);
    expect(screen.getByDisplayValue('Все')).toBeInTheDocument();
  });
});
