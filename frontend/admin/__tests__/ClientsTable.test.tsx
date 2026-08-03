import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { ClientsContextType } from '../contexts/ClientsContext';
import type { ClientWithStats } from '@memo/api-client';

// ─── Mock data ──────────────────────────────────────────────────────────────

const mockClientsWithStats: ClientWithStats[] = [
  {
    id: 'c1',
    name: 'Анна Иванова',
    phone: '+7 (900) 123-45-67',
    email: null,
    channel: 'telegram',
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    is_active: true,
    records_count: 5,
    last_record: '2026-05-20T10:00:00',
    total_paid: 17500,
    missed_records: 1,
  },
  {
    id: 'c2',
    name: 'Борис Петров',
    phone: '+7 (900) 987-65-43',
    email: null,
    channel: 'phone',
    created_at: '2026-02-01T00:00:00',
    updated_at: '2026-02-01T00:00:00',
    is_active: true,
    records_count: 2,
    last_record: '2026-04-10T14:00:00',
    total_paid: 5000,
    missed_records: 0,
  },
];

// ─── Mutable mock context ───────────────────────────────────────────────────

let mockContextValue: ClientsContextType = {
  clients: mockClientsWithStats,
  total: 2,
  page: 1,
  perPage: 20,
  filters: {
    search: '',
    status: 'active',
    created_from: '',
    created_to: '',
        updated_from: '',
        updated_to: '',
        min_records: null,
        max_records: null,
        min_paid: null,
        max_paid: null,
        missed_from: null,
        missed_to: null,
      },
      sortBy: 'name',
      sortOrder: 'asc',
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      setPage: vi.fn(),
      setPerPage: vi.fn(),
      setFilters: vi.fn(),
      setSort: vi.fn(),
      resetFilters: vi.fn(),
      createClient: vi.fn(),
      updateClient: vi.fn(),
      patchClient: vi.fn(),
      deleteClient: vi.fn(),
};

vi.mock('@/contexts/ClientsContext', () => ({
  useClients: () => mockContextValue,
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => ({ showToast: vi.fn() })),
}));

import { ClientsTable } from '../app/(main)/clients/components/ClientsTable';

describe('ClientsTable', () => {
  beforeEach(() => {
    localStorage.clear();
    mockContextValue = {
      clients: mockClientsWithStats,
      total: 2,
      page: 1,
      perPage: 20,
      filters: {
        search: '',
        status: 'active',
        created_from: '',
        created_to: '',
        updated_from: '',
        updated_to: '',
        min_records: null,
        max_records: null,
        min_paid: null,
        max_paid: null,
        missed_from: null,
        missed_to: null,
      },
      sortBy: 'name',
      sortOrder: 'asc',
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      setPage: vi.fn(),
      setPerPage: vi.fn(),
      setFilters: vi.fn(),
      setSort: vi.fn(),
      resetFilters: vi.fn(),
      createClient: vi.fn(),
      updateClient: vi.fn(),
      patchClient: vi.fn(),
      deleteClient: vi.fn(),
    };
  });

  it('renders client names', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Анна Иванова')).toBeTruthy();
    expect(screen.getByText('Борис Петров')).toBeTruthy();
  });

  it('renders client phones', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('+7 (900) 123-45-67')).toBeTruthy();
    expect(screen.getByText('+7 (900) 987-65-43')).toBeTruthy();
  });

  it('renders visits count', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('renders last visit formatted in Russian locale', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('20.05.2026')).toBeTruthy();
    expect(screen.getByText('10.04.2026')).toBeTruthy();
  });

  it('renders total paid with ₽ symbol', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('17 500 ₽')).toBeTruthy();
    expect(screen.getByText('5 000 ₽')).toBeTruthy();
  });

  it('calls onClientClick when a row is clicked', () => {
    const onClientClick = vi.fn();
    render(<ClientsTable onClientClick={onClientClick} />);
    fireEvent.click(screen.getByText('Анна Иванова'));
    expect(onClientClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', name: 'Анна Иванова' }),
    );
  });

  it('shows loading skeleton when isLoading is true', () => {
    mockContextValue = { ...mockContextValue, isLoading: true };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // Loading state: animated skeleton placeholders
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no clients', () => {
    mockContextValue = { ...mockContextValue, clients: [] };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Нет клиентов')).toBeTruthy();
  });

  it('shows "Ничего не найдено" with reset link when filters active and no results', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [],
      filters: { ...mockContextValue.filters, search: 'test' },
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
    expect(screen.getByText('Сбросить фильтры')).toBeTruthy();
  });

  it('shows "Нет клиентов" (not "Ничего не найдено") with default status=active and no other filters', () => {
    mockContextValue = { ...mockContextValue, clients: [] };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Нет клиентов')).toBeTruthy();
    expect(screen.queryByText('Ничего не найдено')).not.toBeTruthy();
  });

  it('shows "Ничего не найдено" when status=all and no results (all counts as active filter)', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [],
      filters: { ...mockContextValue.filters, status: 'all' },
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
  });

  it('shows "Ничего не найдено" when status=archived and no results (archived counts as active filter)', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [],
      filters: { ...mockContextValue.filters, status: 'archived' },
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Ничего не найдено')).toBeTruthy();
  });

  it('calls resetFilters when reset link clicked in empty-filtered state', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [],
      filters: { ...mockContextValue.filters, search: 'test' },
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    fireEvent.click(screen.getByText('Сбросить фильтры'));
    expect(mockContextValue.resetFilters).toHaveBeenCalledTimes(1);
  });

  it('delete button calls deleteClient after confirmation', () => {
    const deleteClient = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockContextValue = { ...mockContextValue, deleteClient };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // Find the delete button (has the trash icon SVG inside)
    const deleteButtons = document.querySelectorAll('button');
    const deleteBtn = Array.from(deleteButtons).find(btn => btn.querySelector('svg'));
    expect(deleteBtn).toBeTruthy();
    fireEvent.click(deleteBtn!);
    expect(deleteClient).toHaveBeenCalledWith('c1');
    vi.mocked(window.confirm).mockRestore();
  });

  it('calls setSort when a sortable column header is clicked', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    fireEvent.click(screen.getByText('Имя'));
    expect(mockContextValue.setSort).toHaveBeenCalledWith('name', expect.any(String));
  });

  it('toggles sort direction when clicking the same column', () => {
    mockContextValue = { ...mockContextValue, sortBy: 'name', sortOrder: 'asc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    fireEvent.click(screen.getByText('Имя'));
    expect(mockContextValue.setSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('shows "Дорогой гость" for client with null name', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [
        {
          ...mockClientsWithStats[0],
          name: '',
        },
      ],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Дорогой гость')).toBeTruthy();
  });

  it('shows "Не указан" for client with empty phone', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [
        {
          ...mockClientsWithStats[0],
          phone: '',
        },
      ],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Не указан')).toBeTruthy();
  });

  it('shows "—" for client with null last_record', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [
        {
          ...mockClientsWithStats[0],
          last_record: null,
        },
      ],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('shows sort indicator for active sort column', () => {
    mockContextValue = { ...mockContextValue, sortBy: 'records_count', sortOrder: 'desc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // The column header should contain the arrow indicator
    const header = screen.getByText(/Всего записей/);
    expect(header.textContent).toContain('↓');
  });

  // ─── Additional edge cases ─────────────────────────────────────────────

  it('sort indicator shows ↑ for ascending order', () => {
    mockContextValue = { ...mockContextValue, sortBy: 'name', sortOrder: 'asc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    const header = screen.getByText(/Имя/);
    expect(header.textContent).toContain('↑');
  });

  it('calls setSort with field and reversed direction on column click', () => {
    mockContextValue = { ...mockContextValue, sortBy: 'records_count', sortOrder: 'desc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    fireEvent.click(screen.getByText('Имя'));
    expect(mockContextValue.setSort).toHaveBeenCalledWith('name', 'asc');
  });

  it('calls onClientClick with correct client object for second client', () => {
    const onClientClick = vi.fn();
    render(<ClientsTable onClientClick={onClientClick} />);
    fireEvent.click(screen.getByText('Борис Петров'));
    expect(onClientClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2', name: 'Борис Петров' }),
    );
  });

  it('renders zero visits count correctly', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [{ ...mockClientsWithStats[0], records_count: 0 }],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('renders zero total_paid correctly', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [{ ...mockClientsWithStats[0], total_paid: 0 }],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('0 ₽')).toBeTruthy();
  });

  it('renders multiple clients with different last visit dates', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    // Both clients should have their dates formatted
    expect(screen.getByText('20.05.2026')).toBeTruthy();
    expect(screen.getByText('10.04.2026')).toBeTruthy();
  });

  it('renders all sortable column headers', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Имя')).toBeTruthy();
    expect(screen.getByText('Телефон')).toBeTruthy();
    expect(screen.getByText(/Всего записей/)).toBeTruthy();
    expect(screen.getByText('Последняя запись')).toBeTruthy();
    expect(screen.getByText('Сумма оплат')).toBeTruthy();
  });

  it('handles single client in list', () => {
    mockContextValue = {
      ...mockContextValue,
      clients: [mockClientsWithStats[0]],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Анна Иванова')).toBeTruthy();
    expect(screen.queryByText('Борис Петров')).not.toBeTruthy();
  });

  it('renders loading skeleton with correct number of placeholders', () => {
    mockContextValue = { ...mockContextValue, isLoading: true };
    render(<ClientsTable onClientClick={vi.fn()} />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(10);
  });

  // ─── Column picker ──────────────────────────────────────────────────────

  it('renders column picker gear button', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('shows all default columns', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Имя')).toBeInTheDocument();
    expect(screen.getByText('Телефон')).toBeInTheDocument();
    expect(screen.getByText('Всего записей')).toBeInTheDocument();
    expect(screen.getByText('Последняя запись')).toBeInTheDocument();
    expect(screen.getByText('Сумма оплат')).toBeInTheDocument();
  });

  it('hides column when unchecked via ColumnPicker', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);

    // Open picker
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    // Uncheck "Телефон"
    fireEvent.click(screen.getByLabelText('Телефон'));

    // Column header should be gone from the table
    const thead = document.querySelector('thead');
    expect(thead?.textContent).not.toContain('Телефон');

    // But data should still be in the row (hidden via visibility check, but the td is gone)
    // Since we removed the th, we need to check that the td for phone is also gone
    expect(screen.queryByText('+7 (900) 123-45-67')).not.toBeInTheDocument();
  });

  it('persists column visibility to localStorage', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    fireEvent.click(screen.getByLabelText('Телефон'));

    const stored = JSON.parse(localStorage.getItem('clients-columns')!);
    expect(stored).not.toContain('phone');
    expect(stored).toContain('name');
  });
});
