import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import type { RecordsContextType } from '../contexts/RecordsContext';
import type {
  RecordView,
  PaymentResponse,
  DependencyNode,
} from '@memo/api-client';
import { mockPayment } from './helpers/mockData';
import { createMockRecordsContext } from './helpers/mockContexts';

// ─── Mock data ──────────────────────────────────────────────────────────────

// GH #213 Task 7: the table + detail panel read ONLY the denormalized row
// fields (RecordView). The lookup maps stay EMPTY on purpose — any accidental
// map read would render «—» and fail these tests.
const mockRecord: RecordView = {
  id: 'rec-1',
  activity_id: 'act-1',
  client_id: 'client-1',
  status: 'waiting',
  seats: 2,
  anonym_visits: 0,
  comment: null,
  custom_price: null,
  created_at: '2024-06-15T10:00:00Z',
  updated_at: '2024-06-15T10:00:00Z',
  visits: [
    {
      id: 'vis-1',
      record_id: 'rec-1',
      visitor_id: 'v-1',
      price: 2500,
      custom_price: null,
      status: 'active',
      created_at: '2024-06-15T10:00:00Z',
      updated_at: '2024-06-15T10:00:00Z',
    },
  ],
  client_name: 'Анна Смирнова',
  activity_start: '2024-06-15T10:00:00Z',
  service_title: 'Рисование акварелью',
  master_name: 'Иванова Мария',
  location_name: 'Студия на Арбате',
  master_color: '#E74C3C',
  is_private: false,
  paid: 2500,
};

// ─── Records delete dry-run dependency tree (mirrors backend FK_MATRIX
// Record root — Addendum 13): visits/payments user-visible cascade +
// record_tags auto-handled. ─────────────────────────────────────────────────

const DEPS_RECORD: DependencyNode[] = [
  { entity: 'visits', relation: 'Посетитель', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'payments', relation: 'Оплата', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'record_tags', relation: 'Тег', count: 1, allowed_actions: ['cascade'], message: null },
];

// ─── Mutable mock context ───────────────────────────────────────────────────

const baseOverrides: Partial<RecordsContextType> = {
  records: [mockRecord],
};

let mockContextValue: RecordsContextType;

vi.mock('@/contexts/RecordsContext', () => ({
  useRecords: () => mockContextValue,
}));

// ─── Mock useRecordData (per-record payments in detail panel) ───────────────

let mockRecordPayments: PaymentResponse[] = [mockPayment];

vi.mock('@/hooks/useRecordData', () => ({
  useRecordData: () => ({
    recordData: null,
    record: null,
    visitors: [],
    activity: undefined,
    services: [],
    masters: [],
    locations: [],
    payments: mockRecordPayments,
    visitorsMap: new Map(),
    tariffs: [],
    isLoading: false,
    status: 'waiting' as const,
  }),
}));

// ─── Mock the shared record-delete hook (Addendum 13) + UI toasts ───────────

const mockDeleteMutation = {
  mutateAsync: vi.fn(),
  dependencies: null as DependencyNode[] | null,
  resolveDelete: { mutateAsync: vi.fn() },
};

vi.mock('@/hooks/useDeleteRecord', () => ({
  useDeleteRecord: () => mockDeleteMutation,
}));

const mockShowToast = vi.fn();
vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({ showToast: mockShowToast }),
}));

import { RecordsTable } from '../app/(main)/records/components/RecordsTable';
import { ApiError } from '@memo/api-client';

function renderTable(overrides: Partial<RecordsContextType> = {}) {
  mockContextValue = createMockRecordsContext({ ...baseOverrides, ...overrides });
  return render(<RecordsTable />);
}

/** Delete hook whose dry-run rejects with a 409 carrying the records tree. */
function setupDeleteConflict() {
  mockDeleteMutation.mutateAsync = vi
    .fn()
    .mockRejectedValue(new ApiError(409, 'has_dependencies', 'has_dependencies', DEPS_RECORD));
  mockDeleteMutation.dependencies = DEPS_RECORD;
}

describe('RecordsTable', () => {
  beforeEach(() => {
    localStorage.clear();
    mockRecordPayments = [mockPayment];
    mockDeleteMutation.mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockDeleteMutation.dependencies = null;
    mockDeleteMutation.resolveDelete.mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockShowToast.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Row-field cell rendering (GH #213 Task 7 — no lookup maps) ─────────

  it('renders client name from the row client_name', () => {
    renderTable();
    expect(screen.getByText('Анна Смирнова')).toBeTruthy();
  });

  it('renders service title from the row service_title', () => {
    renderTable();
    expect(screen.getByText('Рисование акварелью')).toBeTruthy();
  });

  it('renders master color dot with the row master_name tooltip', () => {
    const { container } = renderTable();
    const dot = container.querySelector('[title="Иванова Мария"]') as HTMLElement;
    expect(dot).toBeTruthy();
    expect(dot.style.backgroundColor).toBe('rgb(231, 76, 60)');
  });

  it('renders location name from the row location_name', () => {
    renderTable();
    expect(screen.getByText('Студия на Арбате')).toBeTruthy();
  });

  it('shows total price from visits', () => {
    renderTable();
    expect(screen.getByText('2 500₽')).toBeTruthy();
  });

  it('shows «✓ Оплачено» when row.paid covers the visits total', () => {
    renderTable();
    expect(screen.getByText('✓ Оплачено')).toBeTruthy();
  });

  it('shows «Не оплачено» when row.paid is 0', () => {
    renderTable({ records: [{ ...mockRecord, paid: 0 }] });
    expect(screen.getByText('Не оплачено')).toBeTruthy();
  });

  it('shows «Частично (N₽)» when 0 < row.paid < total', () => {
    renderTable({ records: [{ ...mockRecord, paid: 1000 }] });
    expect(screen.getByText('Частично (1 000₽)')).toBeTruthy();
  });

  it('shows the unified «Нет записей» empty state (Addendum 12)', () => {
    renderTable({ records: [] });
    expect(screen.getByText('Нет записей')).toBeTruthy();
    expect(screen.queryByText('Записи не найдены')).not.toBeInTheDocument();
  });

  it('shows dash when the row client_name is null (anonymous record)', () => {
    const recordNoClient: RecordView = {
      ...mockRecord,
      id: 'rec-no-client',
      client_id: null,
      client_name: null,
    };
    renderTable({ records: [recordNoClient] });
    // The client column renders '—' from row.client_name ?? '—'
    const clientCells = screen.getAllByText('—');
    expect(clientCells.length).toBeGreaterThanOrEqual(1);
  });

  it('renders multiple records with mixed client_name presence', () => {
    const recordNoClient: RecordView = {
      ...mockRecord,
      id: 'rec-no-client',
      client_id: null,
      client_name: null,
    };
    renderTable({ records: [mockRecord, recordNoClient] });
    // Should show the known client name
    expect(screen.getByText('Анна Смирнова')).toBeTruthy();
    // Should show dash for the record without client_name
    const clientCells = screen.getAllByText('—');
    expect(clientCells.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Server-driven sort wiring (DataTable computes the toggle) ──────────

  it('header click calls setSort with field and order (two-arg §6.4)', () => {
    const setSort = vi.fn();
    renderTable({ setSort });
    fireEvent.click(screen.getByText(/Оплата/));
    // DataTable toggle: inactive column (sortBy defaults to `date`) → asc.
    expect(setSort).toHaveBeenCalledWith('payment', 'asc');
  });

  it('repeat click on the active asc column toggles to desc (DataTable §6.10.4)', () => {
    const setSort = vi.fn();
    renderTable({ setSort, sortBy: 'payment', sortOrder: 'asc' });
    fireEvent.click(screen.getByText(/Оплата/));
    expect(setSort).toHaveBeenCalledWith('payment', 'desc');
  });

  it('sort indicator reflects context sortBy/sortOrder', () => {
    renderTable({ sortBy: 'payment', sortOrder: 'desc' });
    expect(screen.getByText(/Оплата/).textContent).toContain('↓');
  });

  // ─── Server-driven pagination wiring (DataTable owns the pager) ─────────

  it('pagination shows server total and calls setPage/setPerPage', () => {
    const setPage = vi.fn();
    const setPerPage = vi.fn();
    renderTable({ total: 42, page: 2, perPage: 10, setPage, setPerPage });
    expect(screen.getByText('42 всего')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    expect(setPage).toHaveBeenCalledWith(3);
    fireEvent.change(screen.getByDisplayValue('10'), { target: { value: '50' } });
    expect(setPerPage).toHaveBeenCalledWith(50);
  });

  // ─── Detail panel (reads the selected RecordView row — spec §6.3) ────────

  it('detail panel shows client/service/master/location from the row fields', () => {
    renderTable();
    fireEvent.click(screen.getByText('Анна Смирнова').closest('tr')!);
    expect(screen.getByText('Детали записи')).toBeInTheDocument();
    // Client name + service title also live in the table cells → getAllByText.
    expect(screen.getAllByText('Анна Смирнова').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Рисование акварелью').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Иванова Мария')).toBeInTheDocument();
    expect(screen.getAllByText('Студия на Арбате').length).toBeGreaterThanOrEqual(2);
  });

  it('detail panel service title carries the DiamondIcon for private rows', () => {
    renderTable({ records: [{ ...mockRecord, is_private: true }] });
    fireEvent.click(screen.getByText('Анна Смирнова').closest('tr')!);
    expect(screen.getByText('Детали записи')).toBeInTheDocument();
    // Table service cell + detail panel (spec §11: table + detail coverage).
    expect(screen.getAllByLabelText('Индивидуальное занятие')).toHaveLength(2);
  });

  it('detail panel lists payments with amount and method', () => {
    renderTable();
    fireEvent.click(screen.getByText('Анна Смирнова').closest('tr')!);
    expect(screen.getByText('Карта')).toBeInTheDocument();
    expect(screen.getByText('3 500₽')).toBeInTheDocument();
  });

  it('detail panel shows Нет платежей when record has no payments', () => {
    mockRecordPayments = [];
    renderTable();
    fireEvent.click(screen.getByText('Анна Смирнова').closest('tr')!);
    expect(screen.getByText('Нет платежей')).toBeInTheDocument();
  });

  // ─── Column picker (DataTable-owned, controlled ColumnPicker) ───────────

  it('renders column picker gear button', () => {
    renderTable();
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('shows all default column headers', () => {
    renderTable();
    expect(screen.getByText(/Дата \/ Время/)).toBeTruthy();
    expect(screen.getByText(/Клиент/)).toBeTruthy();
    expect(screen.getByText(/Гостей/)).toBeTruthy();
    expect(screen.getByText(/Услуга/)).toBeTruthy();
    expect(screen.getByText(/Мастер/)).toBeTruthy();
    expect(screen.getByText(/Локация/)).toBeTruthy();
    expect(screen.getByText(/Статус/)).toBeTruthy();
    expect(screen.getByText(/Сумма/)).toBeTruthy();
    expect(screen.getByText(/Оплата/)).toBeTruthy();
  });

  it('hides column when unchecked via ColumnPicker', () => {
    renderTable();

    // Open picker
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    // Uncheck "Клиент"
    fireEvent.click(screen.getByLabelText('Клиент'));

    // The "Клиент" th should be gone
    const thead = document.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Клиент/);
  });

  // ─── Action dropdown column (B2 cat 7 — appended LAST) ──────────────────

  it('renders one ⋯ Действия trigger per row; the dropdown column is the 10th header', () => {
    renderTable();
    expect(screen.getAllByLabelText(/Действия/)).toHaveLength(1);
    // 9 data columns + 1 trailing actions column (§6.3).
    expect(document.querySelectorAll('thead th')).toHaveLength(10);
  });

  it('clicking ⋯ opens the row menu with data-testid dropdown-<id> and role=menu', () => {
    renderTable();
    fireEvent.click(screen.getByLabelText(/Действия/));
    const menu = screen.getByTestId('dropdown-rec-1');
    expect(menu).toBeInTheDocument();
    expect(menu.getAttribute('role')).toBe('menu');
    // Delete-only actions factory — records have no table-level edit entry
    // point (the detail panel is the edit path; plan Task 8 Part C).
    expect(screen.getByRole('menuitem', { name: 'Удалить' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Редактировать' })).not.toBeInTheDocument();
  });

  it('row click still toggles the detail panel (closest guard lets ⋯ clicks through)', () => {
    renderTable();
    // Click on the row itself (not the trigger) → panel opens.
    fireEvent.click(screen.getByText('2 500₽'));
    expect(screen.getByText('Детали записи')).toBeInTheDocument();
  });

  // ─── Delete → DeleteDialog flow (Addendum 13 dry-run, FE2b wiring) ──────

  it('«Удалить» fires the dry-run delete for the row id', () => {
    renderTable();
    fireEvent.click(screen.getByLabelText(/Действия/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    expect(mockDeleteMutation.mutateAsync).toHaveBeenCalledWith('rec-1');
  });

  it('409 dry-run conflict opens DeleteDialog labelled from row.activity_start', async () => {
    setupDeleteConflict();
    renderTable();
    fireEvent.click(screen.getByLabelText(/Действия/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    // Title words the entity from formatRecordLabel(deleteTarget.record.activity_start):
    // activity_start 2024-06-15T10:00Z → «15 июня · 10:00».
    const title = screen.getByTestId('delete-dialog-title').textContent ?? '';
    expect(title).toContain('записи 15 июня · 10:00');
    // User-visible dependents (visits/payments) render as choice rows; the
    // auto join-table dep renders as an auto row — both carry dep-<entity>.
    expect(screen.getByTestId('dep-visits')).toBeInTheDocument();
    expect(screen.getByTestId('dep-payments')).toBeInTheDocument();
    expect(screen.getByTestId('dep-record_tags')).toBeInTheDocument();
  });

  it('cancel closes the dialog without calling resolveDelete', async () => {
    setupDeleteConflict();
    renderTable();
    fireEvent.click(screen.getByLabelText(/Действия/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-cancel-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-cancel-btn'));

    await waitFor(() =>
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument(),
    );
    expect(mockDeleteMutation.resolveDelete.mutateAsync).not.toHaveBeenCalled();
  });

  it('confirm resolves via resolveDelete with the picked cascade resolutions', async () => {
    setupDeleteConflict();
    renderTable();
    fireEvent.click(screen.getByLabelText(/Действия/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() =>
      expect(screen.getByTestId('delete-dialog-confirm-input')).toBeInTheDocument(),
    );

    // Pick both user-visible deps (visits, payments) — auto picks `cascade`.
    fireEvent.click(within(screen.getByTestId('dep-visits')).getByRole('button'));
    fireEvent.click(within(screen.getByTestId('dep-payments')).getByRole('button'));

    // Type-to-confirm unlocks the button (entityName = formatRecordLabel).
    const titleText = screen.getByTestId('delete-dialog-title').textContent ?? '';
    const label = titleText.replace(/^Удаление «записи /, '').replace(/»$/, '');
    fireEvent.change(screen.getByTestId('delete-dialog-confirm-input'), {
      target: { value: label },
    });
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() =>
      expect(mockDeleteMutation.resolveDelete.mutateAsync).toHaveBeenCalledWith({
        id: 'rec-1',
        resolutions: { visits: 'cascade', payments: 'cascade' },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument(),
    );
  });

  it('204 dry-run success deletes instantly — no dialog opens', async () => {
    // mutateAsync resolves (mock default) → the hook already toasted/invalidated
    // (covered by useDeleteRecord.test.ts); assert table behavior only.
    renderTable();
    fireEvent.click(screen.getByLabelText(/Действия/));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => expect(mockDeleteMutation.mutateAsync).toHaveBeenCalledWith('rec-1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });
});
