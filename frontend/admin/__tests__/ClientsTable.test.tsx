import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { createMockClientsTableState } from './helpers/mockContexts';
import type { ClientWithStats, DependencyNode } from '@memo/api-client';
import { ApiError } from '@memo/api-client';

// ─── Dependency tree fixtures (mirror backend src/domain/deletion.py) ─────

// Client with choice deps (records nullify, visitors cascade) + auto tags →
// Mode A; resolutions = { records:'nullify', visitors:'cascade' }.
const DEPS_CHOICE: DependencyNode[] = [
  { entity: 'records', relation: 'Запись', count: 47, allowed_actions: ['nullify'], message: null },
  {
    entity: 'visitors',
    relation: 'Посетитель',
    count: 12,
    allowed_actions: ['cascade'],
    message: null,
    cascade_preview: { visits: 45 },
  },
  { entity: 'client_tags', relation: 'Тег', count: 5, allowed_actions: ['cascade'], message: null },
];

// Client with activities → delete blocked → Mode B (archive only).
const DEPS_BLOCKED: DependencyNode[] = [
  {
    entity: 'activities',
    relation: 'Активность',
    count: 2,
    allowed_actions: [],
    message: 'Удалите активности вручную или архивируйте',
  },
];

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
    archived: false,
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
    archived: false,
    records_count: 2,
    last_record: '2026-04-10T14:00:00',
    total_paid: 5000,
    missed_records: 0,
  },
];

// ─── Mutable mock table state (GH #140: useClientsTable) ────────────────────

let mockTableState = createMockClientsTableState({
  items: mockClientsWithStats,
  total: 2,
  perPage: 20,
  sortBy: 'name',
  sortOrder: 'asc',
});

vi.mock('@/contexts/ClientsContext', () => ({
  useClientsTable: () => mockTableState,
}));

// ─── Mutable mutation hook mocks (GH #140: hooks/useClientsMutations) ───────

const deleteHook = { mutateAsync: vi.fn(), dependencies: null as DependencyNode[] | null };
const archiveHook = { mutateAsync: vi.fn() };
const restoreHook = { mutateAsync: vi.fn() };
const resolveDeleteHook = { mutateAsync: vi.fn() };

vi.mock('@/hooks/useClientsMutations', () => ({
  useDeleteClient: () => deleteHook,
  useArchiveClient: () => archiveHook,
  useRestoreClient: () => restoreHook,
  useResolveDeleteClient: () => resolveDeleteHook,
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => ({ showToast: vi.fn() })),
}));

import { ClientsTable } from '../app/(main)/clients/components/ClientsTable';

describe('ClientsTable', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    deleteHook.dependencies = null;
    deleteHook.mutateAsync.mockResolvedValue(undefined);
    archiveHook.mutateAsync.mockResolvedValue({});
    restoreHook.mutateAsync.mockResolvedValue({});
    resolveDeleteHook.mutateAsync.mockResolvedValue(undefined);
    mockTableState = createMockClientsTableState({
      items: mockClientsWithStats,
      total: 2,
      perPage: 20,
      sortBy: 'name',
      sortOrder: 'asc',
    });
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

  it('shows loading skeleton when isPending is true', () => {
    mockTableState = { ...mockTableState, isPending: true };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // Loading state: animated skeleton placeholders
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows empty state when no clients (#12 unified copy)', () => {
    mockTableState = { ...mockTableState, items: [] };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // Addendum #12 (user ruling): empty state = "Нет записей" for ALL 8
    // tables; the dual variant (Ничего не найдено + reset link + SVG) is
    // dropped — the reset button stays in the page-level ClientsFilters bar.
    expect(screen.getByText('Нет записей')).toBeTruthy();
  });

  it('empty state is unified even when filters active (#12)', () => {
    mockTableState = {
      ...mockTableState,
      items: [],
      filters: { ...mockTableState.filters, search: 'test' },
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // No "Ничего не найдено" + reset link inside the table — both dropped.
    expect(screen.getByText('Нет записей')).toBeTruthy();
    expect(screen.queryByText('Ничего не найдено')).not.toBeInTheDocument();
  });

  it('does not render reset link in the empty table — reset lives in the filters bar (#12)', () => {
    mockTableState = {
      ...mockTableState,
      items: [],
      filters: { ...mockTableState.filters, search: 'test' },
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // The legacy "Сбросить фильтры" inside the table is gone.
    expect(screen.queryByText('Сбросить фильтры')).not.toBeInTheDocument();
  });

  it('clicking "Удалить" runs the delete dry-run; 409 opens the DeleteDialog', async () => {
    deleteHook.mutateAsync.mockRejectedValue(
      new ApiError(409, 'Удаление невозможно', 'CONFLICT', DEPS_CHOICE),
    );
    deleteHook.dependencies = DEPS_CHOICE;
    render(<ClientsTable onClientClick={vi.fn()} />);

    // Open the row-1 actions dropdown and click "Удалить"
    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(deleteHook.mutateAsync).toHaveBeenCalledWith('c1'));
    // window.confirm is gone — the dialog takes over (§7.3 fetch flow)
    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-title').textContent).toContain('Анна Иванова');
  });

  it('Mode A confirm sends resolveDelete with the picked resolutions', async () => {
    deleteHook.mutateAsync.mockRejectedValue(
      new ApiError(409, 'Удаление невозможно', 'CONFLICT', DEPS_CHOICE),
    );
    deleteHook.dependencies = DEPS_CHOICE;
    render(<ClientsTable onClientClick={vi.fn()} />);

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-confirm-input')).toBeInTheDocument());
    // Pick the choice deps (nullify records, cascade visitors) + type-to-confirm
    fireEvent.click(screen.getByText(/Записи: 47/));
    fireEvent.click(screen.getByText(/Посетители: 12/));
    fireEvent.change(screen.getByTestId('delete-dialog-confirm-input'), {
      target: { value: 'Анна Иванова' },
    });
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() =>
      expect(resolveDeleteHook.mutateAsync).toHaveBeenCalledWith({
        id: 'c1',
        resolutions: { records: 'nullify', visitors: 'cascade' },
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('Mode B (activities present) offers "Архивировать" via the archive hook', async () => {
    deleteHook.mutateAsync.mockRejectedValue(
      new ApiError(409, 'Удаление невозможно', 'CONFLICT', DEPS_BLOCKED),
    );
    deleteHook.dependencies = DEPS_BLOCKED;
    archiveHook.mutateAsync.mockResolvedValue({ ...mockClientsWithStats[0], archived: true });
    render(<ClientsTable onClientClick={vi.fn()} />);

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument());
    expect(screen.queryByTestId('delete-dialog-confirm-btn')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('delete-dialog-archive-btn'));

    await waitFor(() => expect(archiveHook.mutateAsync).toHaveBeenCalledWith('c1'));
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('204 dry-run success → instant delete, no dialog opens', async () => {
    deleteHook.mutateAsync.mockResolvedValue(undefined);
    render(<ClientsTable onClientClick={vi.fn()} />);

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(deleteHook.mutateAsync).toHaveBeenCalledWith('c1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });

  it('calls the archive hook when "В архив" clicked on an active client (#198 parity)', async () => {
    archiveHook.mutateAsync.mockResolvedValue({ ...mockClientsWithStats[0], archived: true });
    render(<ClientsTable onClientClick={vi.fn()} />);

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('В архив'));

    await waitFor(() => expect(archiveHook.mutateAsync).toHaveBeenCalledWith('c1'));
  });

  it('calls the restore hook when "Восстановить" clicked on an archived client (#198 parity)', async () => {
    restoreHook.mutateAsync.mockResolvedValue({ ...mockClientsWithStats[0], archived: false });
    mockTableState = {
      ...mockTableState,
      items: [{ ...mockClientsWithStats[0], archived: true }],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(restoreHook.mutateAsync).toHaveBeenCalledWith('c1'));
  });

  it('calls setSort when a sortable column header is clicked', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Имя/ }));
    expect(mockTableState.setSort).toHaveBeenCalledWith('name', expect.any(String));
  });

  it('toggles sort direction when clicking the same column', () => {
    mockTableState = { ...mockTableState, sortBy: 'name', sortOrder: 'asc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Имя/ }));
    expect(mockTableState.setSort).toHaveBeenCalledWith('name', 'desc');
  });

  it('shows "Дорогой гость" for client with null name', () => {
    mockTableState = {
      ...mockTableState,
      items: [
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
    mockTableState = {
      ...mockTableState,
      items: [
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
    mockTableState = {
      ...mockTableState,
      items: [
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
    mockTableState = { ...mockTableState, sortBy: 'records_count', sortOrder: 'desc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // The column header (a <th>) should contain the active arrow indicator.
    const header = screen.getByRole('columnheader', { name: /Всего записей/ });
    expect(header.textContent).toContain('↓');
  });

  // ─── Additional edge cases ─────────────────────────────────────────────

  it('sort indicator shows ↑ for ascending order', () => {
    mockTableState = { ...mockTableState, sortBy: 'name', sortOrder: 'asc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    const header = screen.getByRole('columnheader', { name: /Имя/ });
    expect(header.textContent).toContain('↑');
  });

  it('inactive sortable header shows ↕ (B2 cat 3 — post-migration)', () => {
    mockTableState = { ...mockTableState, sortBy: 'name', sortOrder: 'asc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // Телефон is NOT the active sort column — it should show the neutral ↕.
    const header = screen.getByRole('columnheader', { name: /Телефон/ });
    expect(header.textContent).toContain('↕');
  });

  it('calls setSort with field and reversed direction on column click', () => {
    mockTableState = { ...mockTableState, sortBy: 'records_count', sortOrder: 'desc' };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // DataTable renders a <button> inside the <th>; click that to fire setSort.
    fireEvent.click(screen.getByRole('button', { name: /Имя/ }));
    expect(mockTableState.setSort).toHaveBeenCalledWith('name', 'asc');
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
    mockTableState = {
      ...mockTableState,
      items: [{ ...mockClientsWithStats[0], records_count: 0 }],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('0')).toBeTruthy();
  });

  it('renders zero total_paid correctly', () => {
    mockTableState = {
      ...mockTableState,
      items: [{ ...mockClientsWithStats[0], total_paid: 0 }],
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
    // DataTable wraps each label inside a <button> (sortable header). Scope
    // to the table head to skip duplicates (e.g. cell values matching
    // labels). The header IS the label container.
    const thead = document.querySelector('thead')!;
    expect(thead.textContent).toContain('Имя');
    expect(thead.textContent).toContain('Телефон');
    expect(thead.textContent).toContain('Всего записей');
    expect(thead.textContent).toContain('Последняя запись');
    expect(thead.textContent).toContain('Сумма оплат');
  });

  it('handles single client in list', () => {
    mockTableState = {
      ...mockTableState,
      items: [mockClientsWithStats[0]],
    };
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByText('Анна Иванова')).toBeTruthy();
    expect(screen.queryByText('Борис Петров')).not.toBeTruthy();
  });

  it('renders loading skeleton with correct number of placeholders', () => {
    mockTableState = { ...mockTableState, isPending: true };
    render(<ClientsTable onClientClick={vi.fn()} />);
    // Spec §6.8 — DataTable skeleton: 10 rows × visible columns only.
    // Each row contributes N .animate-pulse elements (1 per visible column).
    // 5 default columns × 10 rows = 50 placeholders.
    const rows = document.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(10);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(50);
  });

  // ─── Column picker ──────────────────────────────────────────────────────

  it('renders column picker gear button', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('shows all default columns', () => {
    render(<ClientsTable onClientClick={vi.fn()} />);
    const thead = document.querySelector('thead')!;
    expect(thead.textContent).toContain('Имя');
    expect(thead.textContent).toContain('Телефон');
    expect(thead.textContent).toContain('Всего записей');
    expect(thead.textContent).toContain('Последняя запись');
    expect(thead.textContent).toContain('Сумма оплат');
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
