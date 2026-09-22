import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import type { PagedListContextValue, PagedListFiltersState } from '@/contexts/createPagedListContext';
import type { AuditLogFilters as AuditLogFiltersShape } from '@/contexts/AuditLogContext';
import { defaultAuditFilters } from '@/contexts/AuditLogContext';
import { mockAuditLogAuthors } from './helpers/mockData';
import type { AuditLogResponse } from '@memo/api-client';

// ─── Mocks: table state (factory value) + authors lookup hook ───────────────

type AuditTableState = PagedListContextValue<AuditLogResponse> &
  PagedListFiltersState<AuditLogFiltersShape>;

let mockTableState: AuditTableState;
/** The useAuditLogAuthors() return mock — `{ data: AuditLogAuthorResponse[] }`. */
let mockAuthors: () => { data: typeof mockAuditLogAuthors };

vi.mock('@/contexts/AuditLogContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/AuditLogContext')>();
  return {
    ...actual,
    useAuditLogTable: () => mockTableState,
  };
});

vi.mock('@/hooks/useAuditLogAuthors', () => ({
  useAuditLogAuthors: () => mockAuthors(),
}));

import { AuditLogFilters } from '../app/(main)/audit/components/AuditLogFilters';

function makeState(overrides: Partial<AuditTableState> = {}): AuditTableState {
  return {
    items: [],
    visibleItems: undefined,
    total: 0,
    page: 1,
    perPage: 20,
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

describe('AuditLogFilters (GH #344 §7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTableState = makeState();
    mockAuthors = vi.fn(() => ({ data: mockAuditLogAuthors }));
  });

  it('renders the four filter controls (Автор / Действие / Сущность / Период)', () => {
    render(<AuditLogFilters />);
    expect(screen.getByLabelText('Автор')).toBeInTheDocument();
    expect(screen.getByLabelText('Действие')).toBeInTheDocument();
    expect(screen.getByLabelText('Сущность')).toBeInTheDocument();
    // The visible «Период» label + the from/to date pair (2 inputs).
    expect(screen.getAllByLabelText('Период')).toHaveLength(2);
  });

  it('author dropdown lists /audit-logs/authors entries (label shown, user_id value)', () => {
    render(<AuditLogFilters />);
    const select = screen.getByLabelText('Автор') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain('Все авторы');
    expect(options).toContain('Иванов Иван');
    expect(options).toContain('Середа Ольга');
    const ivan = Array.from(select.options).find((o) => o.textContent === 'Иванов Иван')!;
    expect(ivan).toHaveAttribute('value', 'u-1');
  });

  it('empty authors list → the dropdown holds only the «Все авторы» placeholder (spec §7)', () => {
    mockAuthors = vi.fn(() => ({ data: [] }));
    render(<AuditLogFilters />);
    const select = screen.getByLabelText('Автор') as HTMLSelectElement;
    expect(select.options).toHaveLength(1);
    expect(select.options[0].textContent).toBe('Все авторы');
  });

  it('action dropdown covers every journal action with Russian labels', () => {
    render(<AuditLogFilters />);
    const select = screen.getByLabelText('Действие') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining(['create', 'update', 'patch', 'delete', 'archive', 'restore', 'reorder']),
    );
    // update/patch share «изменил» — the slug in parens disambiguates.
    expect(Array.from(select.options).map((o) => o.textContent)).toContain('изменил (patch)');
  });

  it('entity dropdown covers all 16 canonical entities', () => {
    render(<AuditLogFilters />);
    const select = screen.getByLabelText('Сущность') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(
      expect.arrayContaining([
        'clients', 'visitors', 'services', 'locations', 'materials', 'tags',
        'positions', 'activities', 'records', 'visits', 'payments', 'photos',
        'staff', 'users', 'masters', 'user_settings',
      ]),
    );
  });

  it('selecting an author sends user_id to setFilters', () => {
    render(<AuditLogFilters />);
    fireEvent.change(screen.getByLabelText('Автор'), { target: { value: 'u-2' } });
    expect(mockTableState.setFilters).toHaveBeenCalledWith({ user_id: 'u-2' });
  });

  it('selecting an action and an entity sends both to setFilters', () => {
    render(<AuditLogFilters />);
    fireEvent.change(screen.getByLabelText('Действие'), { target: { value: 'delete' } });
    fireEvent.change(screen.getByLabelText('Сущность'), { target: { value: 'clients' } });
    expect(mockTableState.setFilters).toHaveBeenCalledWith({ action: 'delete' });
    expect(mockTableState.setFilters).toHaveBeenCalledWith({ entity: 'clients' });
  });

  it('period inputs send date_from / date_to', () => {
    render(<AuditLogFilters />);
    const [from, to] = screen.getAllByLabelText('Период');
    fireEvent.change(from, { target: { value: '2026-09-01' } });
    fireEvent.change(to, { target: { value: '2026-09-20' } });
    expect(mockTableState.setFilters).toHaveBeenCalledWith({ date_from: '2026-09-01' });
    expect(mockTableState.setFilters).toHaveBeenCalledWith({ date_to: '2026-09-20' });
  });

  it('«Сбросить фильтры» calls resetFilters (clients-page pattern)', () => {
    render(<AuditLogFilters />);
    fireEvent.click(screen.getByText('Сбросить фильтры'));
    expect(mockTableState.resetFilters).toHaveBeenCalled();
  });
});
