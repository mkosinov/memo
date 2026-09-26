import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import type { PagedListContextValue } from '@/contexts/createPagedListContext';
import type { PagedListFiltersState } from '@/contexts/createPagedListContext';
import type { AuditLogFilters } from '@/contexts/AuditLogContext';
import { defaultAuditFilters } from '@/contexts/AuditLogContext';
import { mockAuditLogs, createMockAuditLog } from './helpers/mockData';
import { AuditLogTable } from '../app/(main)/audit/components/AuditLogTable';

// ─── Mutable mock table state (ClientsTable test precedent, GH #140) ────────

type AuditTableState = PagedListContextValue<ReturnType<typeof createMockAuditLog>> &
  PagedListFiltersState<AuditLogFilters>;

let mockTableState: AuditTableState;

vi.mock('@/contexts/AuditLogContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/AuditLogContext')>();
  return {
    ...actual,
    useAuditLogTable: () => mockTableState,
  };
});

function makeState(overrides: Partial<AuditTableState> = {}): AuditTableState {
  return {
    items: mockAuditLogs,
    visibleItems: undefined,
    total: mockAuditLogs.length,
    page: 1,
    perPage: 20,
    // Sorting is server-fixed (created_at DESC) — sortBy stays null.
    sortBy: null,
    sortOrder: 'desc',
    status: 'active',
    isPending: false,
    isLoading: false,
    isFetching: false,
    error: null,
    search: '',
    filters: { ...defaultAuditFilters },
    setPage: vi.fn(),
    setPerPage: vi.fn(),
    setSort: vi.fn(),
    setStatus: vi.fn(),
    setSearch: vi.fn(),
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  };
}

describe('AuditLogTable (GH #344 §7)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockTableState = makeState();
  });

  it('renders the five spec columns (Когда / Кто / Действие / Над чем / Изменения)', () => {
    render(<AuditLogTable />);
    const thead = document.querySelector('thead')!;
    expect(thead.textContent).toContain('Когда');
    expect(thead.textContent).toContain('Кто');
    expect(thead.textContent).toContain('Действие');
    expect(thead.textContent).toContain('Над чем');
    expect(thead.textContent).toContain('Изменения');
  });

  it('renders the author name + role badge (role snapshot from the row)', () => {
    render(<AuditLogTable />);
    // «Иванов Иван» appears in «Кто» AND inside the «Над чем» label — ≥1 hit.
    expect(screen.getAllByText('Иванов Иван').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Администратор').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Середа Ольга').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Мастер').length).toBeGreaterThan(0);
  });

  it('renders Russian action labels from the dictionary (изменил / переставил / создал / удалил)', () => {
    render(<AuditLogTable />);
    expect(screen.getAllByText('изменил').length).toBeGreaterThan(0);
    expect(screen.getByText('переставил')).toBeInTheDocument();
    expect(screen.getByText('создал')).toBeInTheDocument();
    expect(screen.getByText('удалил')).toBeInTheDocument();
  });

  it('renders the «Над чем» cell as «Сущность: label»', () => {
    render(<AuditLogTable />);
    expect(screen.getByText('Клиент: Иванов Иван, +7 (9**) ***-45-67')).toBeInTheDocument();
    expect(screen.getByText('Локация: Студия')).toBeInTheDocument();
  });

  it('renders «—» for a null author (hard-deleted user keeps the row)', () => {
    render(<AuditLogTable />);
    const orphanRow = screen.getByTestId('audit-row-al-4');
    expect(orphanRow.textContent).toContain('—');
  });

  it('renders «Нет действий» empty state for an empty journal (spec §7)', () => {
    mockTableState = makeState({ items: [], total: 0 });
    render(<AuditLogTable />);
    expect(screen.getByText('Нет действий')).toBeInTheDocument();
  });

  // ─── «Изменения» expandable row ─────────────────────────────────────────

  it('collapsed «Изменения» shows a «поле: было → стало» count hint, not the pairs', () => {
    render(<AuditLogTable />);
    // 2 changed fields → hint mentions the count.
    expect(screen.getByText(/2 поля/)).toBeInTheDocument();
    // The raw pair text must NOT be visible while collapsed.
    expect(screen.queryByText(/Иванов И\. И\./)).not.toBeInTheDocument();
  });

  it('shows «—» in «Изменения» for rows without a snapshot (reorder)', () => {
    render(<AuditLogTable />);
    // The reorder row renders an empty dash in the changes cell — it is the
    // ONLY bare «—» inside a cell (the null-author «—» also matches, so
    // count them together: orphan author + reorder changes = 2).
    expect(screen.getAllByText('—').length).toBe(2);
  });

  it('clicking the expand toggle reveals the «поле: было → стало» lines', () => {
    render(<AuditLogTable />);
    fireEvent.click(screen.getAllByLabelText(/Раскрыть изменения/)[0]);
    expect(screen.getByText(/name:/)).toBeInTheDocument();
    expect(screen.getByText(/Иванов И\. И\./)).toBeInTheDocument();
    // «поле: было → стало» — arrow present.
    expect(screen.getAllByText('→').length).toBeGreaterThan(0);
  });

  it('masked values render VERBATIM (no re-masking)', () => {
    render(<AuditLogTable />);
    fireEvent.click(screen.getAllByLabelText(/Раскрыть изменения/)[0]);
    // Collapsed «Над чем» label + expanded pair both carry the masked value.
    expect(screen.getAllByText(/\+7 \(9\*\*\) \*\*\*-45-67/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/\+7 \(9\*\*\) \*\*\*-45-99/)).toBeInTheDocument();
  });

  it('create rows render null-before as «—» and canonical scalars (да, [t1, t2])', () => {
    render(<AuditLogTable />);
    // Expand the create row (al-3 — the only row whose cell testid is
    // audit-changes-al-3); the toggle inside it is the exact one.
    const createCell = screen.getByTestId('audit-changes-al-3');
    fireEvent.click(createCell.querySelector('button')!);
    const cell = within(createCell);
    expect(cell.getByText(/duration:/)).toBeInTheDocument();
    expect(cell.getByText(/90/)).toBeInTheDocument();
    expect(cell.getByText(/да/)).toBeInTheDocument();
    expect(cell.getByText(/\[t1, t2\]/)).toBeInTheDocument();
  });

  it('headers are non-sortable — no sort buttons (server-fixed created_at DESC)', () => {
    render(<AuditLogTable />);
    expect(screen.queryByRole('button', { name: /Когда/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Кто/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Действие/ })).not.toBeInTheDocument();
  });

  it('shows the loading skeleton when isPending', () => {
    mockTableState = makeState({ isPending: true });
    render(<AuditLogTable />);
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('formats «Когда» as ru-RU date + time', () => {
    render(<AuditLogTable />);
    // al-1 and al-2 share 20.09.2026 → two cells carry the date.
    expect(screen.getAllByText(/20\.09\.2026/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/14:30/)).toBeInTheDocument();
  });
});
