import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import type { RecordsContextType } from '../contexts/RecordsContext';
import type {
  RecordResponse,
  ClientWithStats,
  ActivityResponse,
  ServiceResponse,
  MasterResponse,
  LocationResponse,
  PaymentResponse,
  DependencyNode,
} from '@memo/api-client';
import { mockPayment } from './helpers/mockData';
import { createMockRecordsContext } from './helpers/mockContexts';

// ─── Mock data ──────────────────────────────────────────────────────────────

const mockClient: ClientWithStats = {
  id: 'client-1',
  name: 'Анна Смирнова',
  phone: '+7 900 111-22-33',
  email: null,
  channel: 'phone',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
  archived: false,
  records_count: 5,
  last_record: '2024-06-15',
  total_paid: 2500,
  missed_records: 0,
};

const mockActivity: ActivityResponse = {
  id: 'act-1',
  master_id: 'master-1',
  service_id: 'svc-1',
  location_id: 'loc-1',
  start: '2024-06-15T10:00:00Z',
  duration: 120,
  capacity: 8,
  is_private: false,
  comment: null,
  record_info: null,
  created_at: '2024-06-15T10:00:00Z',
  updated_at: '2024-06-15T10:00:00Z',
  occupied: 2,
};

const mockService: ServiceResponse = {
  id: 'svc-1',
  title: 'Рисование акварелью',
  description: 'Мастер-класс',
  image_url: '',
  specialty: 'art',
  min_age: 6,
  max_age: 99,
  duration: 120,
  record_info: '',
  tariffs: [{ id: 't-1', service_id: 'svc-1', title: 'Стандарт', description: null, price: 2500 }],
  tags: [],
  archived: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockMaster: MasterResponse = {
  id: 'master-1',
  first_name: 'Мария',
  last_name: 'Иванова',
  color: '#E74C3C',
  position: 'artist',
  specialty: 'art',
  avatar_url: null,
  archived: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockLocation: LocationResponse = {
  id: 'loc-1',
  name: 'Студия на Арбате',
  address: null,
  description: null,
  capacity: 12,
  yandex_map_url: null,
  review_url: null,
  record_info: null,
  image_url: null,
  archived: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockRecord: RecordResponse = {
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
  clients: new Map([['client-1', mockClient]]),
  payments: new Map([['rec-1', 2500]]),
  activities: new Map([['act-1', mockActivity]]),
  masters: new Map([['master-1', mockMaster]]),
  services: new Map([['svc-1', mockService]]),
  locations: new Map([['loc-1', mockLocation]]),
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

  it('renders client name from context', () => {
    renderTable();
    expect(screen.getByText('Анна Смирнова')).toBeTruthy();
  });

  it('renders service title from context', () => {
    renderTable();
    expect(screen.getByText('Рисование акварелью')).toBeTruthy();
  });

  it('renders master color dot', () => {
    const { container } = renderTable();
    const dot = container.querySelector('[title="Иванова Мария"]');
    expect(dot).toBeTruthy();
  });

  it('renders location name from context', () => {
    renderTable();
    expect(screen.getByText('Студия на Арбате')).toBeTruthy();
  });

  it('shows total price from visits', () => {
    renderTable();
    expect(screen.getByText('2 500₽')).toBeTruthy();
  });

  it('shows payment status when fully paid', () => {
    renderTable();
    expect(screen.getByText('✓ Оплачено')).toBeTruthy();
  });

  it('record with no entry in totals map renders Не оплачено', () => {
    renderTable({ payments: new Map() });
    expect(screen.getByText('Не оплачено')).toBeTruthy();
  });

  it('shows the unified «Нет записей» empty state (Addendum 12)', () => {
    renderTable({ records: [] });
    expect(screen.getByText('Нет записей')).toBeTruthy();
    expect(screen.queryByText('Записи не найдены')).not.toBeInTheDocument();
  });

  it('renders client name from client_id lookup', () => {
    // Record with known client_id should show client name
    renderTable();
    expect(screen.getByText('Анна Смирнова')).toBeTruthy();
  });

  it('shows dash when record has no client_id', () => {
    // Record without client_id should show '—' as fallback
    const recordNoClient: RecordResponse = {
      ...mockRecord,
      id: 'rec-no-client',
      client_id: null,
    };
    renderTable({ records: [recordNoClient] });
    // The client column should show '—' (em dash) when client_id is null
    const clientCells = screen.getAllByText('—');
    expect(clientCells.length).toBeGreaterThanOrEqual(1);
  });

  it('shows dash when client_id not found in clients map', () => {
    // Record with client_id that doesn't exist in the clients map
    const recordUnknownClient: RecordResponse = {
      ...mockRecord,
      id: 'rec-unknown-client',
      client_id: 'nonexistent-client',
    };
    renderTable({ records: [recordUnknownClient] });
    // Should show '—' when client is not in the map
    const clientCells = screen.getAllByText('—');
    expect(clientCells.length).toBeGreaterThanOrEqual(1);
  });

  it('renders multiple records with mixed client_id presence', () => {
    const recordNoClient: RecordResponse = {
      ...mockRecord,
      id: 'rec-no-client',
      client_id: null,
    };
    renderTable({ records: [mockRecord, recordNoClient] });
    // Should show the known client name
    expect(screen.getByText('Анна Смирнова')).toBeTruthy();
    // Should show dash for the record without client_id
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

  // ─── Detail panel payments (per-payment list via useRecordData) ──────────

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
    expect(screen.getAllByLabelText('Действия')).toHaveLength(1);
    // 9 data columns + 1 trailing actions column (§6.3).
    expect(document.querySelectorAll('thead th')).toHaveLength(10);
  });

  it('clicking ⋯ opens the row menu with data-testid dropdown-<id> and role=menu', () => {
    renderTable();
    fireEvent.click(screen.getByLabelText('Действия'));
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
    fireEvent.click(screen.getByLabelText('Действия'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    expect(mockDeleteMutation.mutateAsync).toHaveBeenCalledWith('rec-1');
  });

  it('409 dry-run conflict opens DeleteDialog with the dependency tree', async () => {
    setupDeleteConflict();
    renderTable();
    fireEvent.click(screen.getByLabelText('Действия'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    // Title words the entity: "Удаление «записи …»".
    expect(screen.getByTestId('delete-dialog-title').textContent).toContain('записи');
    // User-visible dependents (visits/payments) render as choice rows; the
    // auto join-table dep renders as an auto row — both carry dep-<entity>.
    expect(screen.getByTestId('dep-visits')).toBeInTheDocument();
    expect(screen.getByTestId('dep-payments')).toBeInTheDocument();
    expect(screen.getByTestId('dep-record_tags')).toBeInTheDocument();
  });

  it('cancel closes the dialog without calling resolveDelete', async () => {
    setupDeleteConflict();
    renderTable();
    fireEvent.click(screen.getByLabelText('Действия'));
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
    fireEvent.click(screen.getByLabelText('Действия'));
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
    fireEvent.click(screen.getByLabelText('Действия'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));

    await waitFor(() => expect(mockDeleteMutation.mutateAsync).toHaveBeenCalledWith('rec-1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });
});
