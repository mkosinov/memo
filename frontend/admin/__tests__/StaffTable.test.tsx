import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  mockStaffResponse,
  mockStaffResponseArchived,
  mockStaffResponseNoMaster,
  createMockStaffResponse,
} from './helpers/mockData';
import type { DependencyNode, StaffResponse, PaginatedResponse, PositionResponse } from '@memo/api-client';

// ─── Dependency tree fixtures (mirror backend src/domain/deletion.py Staff) ──

// Staff with activities → delete blocked → Mode B (archive only).
const DEPS_BLOCKED: DependencyNode[] = [
  {
    entity: 'activities',
    relation: 'Активность',
    count: 3,
    allowed_actions: [],
    message: 'Удалите активности вручную или архивируйте',
  },
  { entity: 'masters', relation: 'Мастер', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'staff_positions', relation: 'Должность', count: 1, allowed_actions: ['cascade'], message: null },
];

// Staff with only auto deps (users + masters + tags + positions) → Mode A, body {}.
const DEPS_AUTO: DependencyNode[] = [
  { entity: 'users', relation: 'Пользователь', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'masters', relation: 'Мастер', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'master_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
  { entity: 'staff_positions', relation: 'Должность', count: 1, allowed_actions: ['cascade'], message: null },
];

// ─── D6 dialog checkbox-visibility matrix (GH #266) ──────────────────────────
// Each case is an ACTIVE person (the dialog only opens for those), varying the
// two independent switches: an ACTIVE master section and a linked account.
interface D6Case {
  label: string;
  staff: StaffResponse;
  master: boolean;
  user: boolean;
}

const D6_CASES: D6Case[] = [
  {
    label: 'active master + has_user → both checkboxes visible and preselected',
    staff: createMockStaffResponse({ has_user: true }),
    master: true,
    user: true,
  },
  {
    label: 'no master section (СММ) → master checkbox absent',
    staff: mockStaffResponseNoMaster,
    master: false,
    user: false,
  },
  {
    label: 'active master without an account → account checkbox absent',
    staff: mockStaffResponse, // has_user: false
    master: true,
    user: false,
  },
  {
    label: 'archived master section → master checkbox absent (nothing to flip)',
    staff: createMockStaffResponse({
      id: 'm3',
      first_name: 'Ирина',
      last_name: 'Гончарова',
      master: { ...mockStaffResponse.master!, archived: true },
    }),
    master: false,
    user: false,
  },
];

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({ invalidateQueries: mockInvalidateQueries })),
  };
});

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getStaff: vi.fn(), resolveDeleteStaff: vi.fn() };
});

vi.mock('@/hooks/useStaffMutations', () => ({
  useUpdateStaff: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })),
  usePatchStaff: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })),
  useDeleteStaff: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({}), dependencies: null, isPending: false })),
  useCreateStaff: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })),
  useArchiveStaff: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })),
  useRestoreStaff: vi.fn(() => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })),
}));

// Positions dictionary (D4): id → title for the table's position cells +
// the modal checkboxes. Built-ins master/admin + user-defined smm.
const POSITIONS: PositionResponse[] = [
  { id: 'master', title: 'Мастер', is_system: true, created_at: '', updated_at: '' },
  { id: 'admin', title: 'Администратор', is_system: true, created_at: '', updated_at: '' },
  { id: 'smm', title: 'СММ', is_system: false, created_at: '', updated_at: '' },
];
vi.mock('@/hooks/usePositions', () => ({
  usePositions: vi.fn(() => ({ data: POSITIONS, isLoading: false })),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(() => ({
    showToast: vi.fn(),
    deleteMode: false,
    toasts: [],
    sidebarCollapsed: false,
    theme: 'light' as const,
  })),
}));

import { StaffTable } from '@/app/(main)/staff/components/StaffTable';
import { StaffProvider } from '@/contexts/StaffContext';
import {
  useUpdateStaff,
  useDeleteStaff,
  useArchiveStaff,
  useRestoreStaff,
} from '@/hooks/useStaffMutations';
import { getStaff, resolveDeleteStaff, ApiError } from '@memo/api-client';

const mockUseUpdateStaff = vi.mocked(useUpdateStaff);
const mockUseDeleteStaff = vi.mocked(useDeleteStaff);
const mockUseArchiveStaff = vi.mocked(useArchiveStaff);
const mockUseRestoreStaff = vi.mocked(useRestoreStaff);
const mockGetStaff = vi.mocked(getStaff);
const mockResolveDeleteStaff = vi.mocked(resolveDeleteStaff);

// ─── Test data ───────────────────────────────────────────────────────────────

const TEST_STAFF = [
  mockStaffResponse,          // m1 — active master, position master, no user
  mockStaffResponseArchived,  // m2 — archived person, archived master, has_user
  mockStaffResponseNoMaster,  // s-smm — СММ, no master section
];

function setupEnvelope(overrides: Partial<PaginatedResponse<StaffResponse>> = {}) {
  mockGetStaff.mockResolvedValue({
    items: TEST_STAFF,
    total: TEST_STAFF.length,
    page: 1,
    per_page: 10,
    ...overrides,
  });
}

function renderTable() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StaffProvider>
        <StaffTable />
      </StaffProvider>
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  const view = renderTable();
  await screen.findByText('Середа Ольга');
  return view;
}

function setupUpdateMock() {
  const mutateAsync = vi.fn().mockResolvedValue({});
  mockUseUpdateStaff.mockReturnValue({ mutateAsync, isPending: false } as never);
  return mutateAsync;
}

function conflictError(dependencies: DependencyNode[]): ApiError {
  return new ApiError(409, 'Удаление невозможно', 'CONFLICT', dependencies);
}

function setupDeleteConflict(deps: DependencyNode[]) {
  const mutateAsync = vi.fn().mockRejectedValue(conflictError(deps));
  mockUseDeleteStaff.mockReturnValue({ mutateAsync, dependencies: deps, isPending: false } as never);
  return mutateAsync;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StaffTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders staff names in the table', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
    expect(screen.getByText('Большакова Юлия')).toBeInTheDocument();
    expect(screen.getByText('СММова Светлана')).toBeInTheDocument();
  });

  it('renders position titles from the dictionary (id → title)', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();
    const tbody = container.querySelector('tbody')!;
    // m1, m2 → position_ids ['master'] → «Мастер»; s-smm → ['smm'] → «СММ».
    expect(within(tbody).getAllByText('Мастер').length).toBeGreaterThanOrEqual(2);
    expect(within(tbody).getByText('СММ')).toBeInTheDocument();
  });

  it('renders specialty + color from the master section; em-dash when no section', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();
    const tbody = container.querySelector('tbody')!;
    expect(within(tbody).getByText('живопись')).toBeInTheDocument();
    expect(within(tbody).getByText('керамика')).toBeInTheDocument();
    // СММ has no master section → specialty AND color cells show em-dashes.
    const smmRow = screen.getByText('СММова Светлана').closest('tr')!;
    expect(within(smmRow).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('shows empty state when no staff', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();
    expect(await screen.findByText('Нет записей')).toBeInTheDocument();
  });

  it('shows loading skeleton', async () => {
    mockGetStaff.mockReturnValue(new Promise<PaginatedResponse<StaffResponse>>(() => {}));
    const { container } = renderTable();
    await waitFor(() => expect(container.querySelectorAll('tbody tr').length).toBe(10));
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('rows keep the master-row-* testid (DoD: preserved across the move)', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();
    expect(container.querySelector('[data-testid="master-row-m1"]')).toBeInTheDocument();
  });

  // ─── Server fetch params (#205 §5.2/§5.3, now on /staff) ───────────────────

  it('initial fetch sends page/per_page/status with NO sort params', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(mockGetStaff).toHaveBeenCalledTimes(1);
    expect(mockGetStaff).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'active' });
    expect(mockGetStaff.mock.calls[0][0]).not.toHaveProperty('sort_by');
  });

  it('status filter change refetches with the new server status param', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), { target: { value: 'archived' } });
    await waitFor(() => {
      expect(mockGetStaff).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });
  });

  it('searches server-side via ?q= (≥2 char clamp)', async () => {
    setupEnvelope();
    await renderLoaded();
    const searchInput = screen.getByLabelText('Поиск по имени или фамилии');
    fireEvent.change(searchInput, { target: { value: 'Ольга' } });
    await waitFor(() => {
      expect(mockGetStaff).toHaveBeenCalledWith(expect.objectContaining({ q: 'Ольга' }));
    });
  });

  it('does not fire q on 1 char (≥2 clamp — treated as unset)', async () => {
    setupEnvelope();
    await renderLoaded();
    const searchInput = screen.getByLabelText('Поиск по имени или фамилии');
    fireEvent.change(searchInput, { target: { value: 'О' } });
    await waitFor(() => expect(searchInput).toHaveValue('О'));
    expect(mockGetStaff).toHaveBeenCalledTimes(1);
    expect(mockGetStaff.mock.calls[0][0]).not.toHaveProperty('q');
  });

  it('pager renders numbered pages from server total 42 and page click refetches', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();
    expect(screen.getByText('42 всего')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(mockGetStaff).toHaveBeenCalledWith({ page: 2, per_page: 10, status: 'active' });
    });
  });

  it('first header click sorts asc, second toggles desc (server sort by name)', async () => {
    setupEnvelope();
    await renderLoaded();
    const nameHeader = screen.getByText(/Имя/);
    expect(nameHeader.textContent).toContain('↕');
    fireEvent.click(nameHeader);
    await waitFor(() => {
      expect(mockGetStaff).toHaveBeenCalledWith({
        page: 1, per_page: 10, status: 'active', sort_by: 'name', sort_order: 'asc',
      });
    });
    expect(screen.getByText(/Имя/).textContent).toContain('↑');
    fireEvent.click(nameHeader);
    await waitFor(() => {
      expect(mockGetStaff).toHaveBeenCalledWith({
        page: 1, per_page: 10, status: 'active', sort_by: 'name', sort_order: 'desc',
      });
    });
  });

  it('position column is NOT sortable (M2M — spec excludes it from the sort whitelist)', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();
    const thead = container.querySelector('thead')!;
    const positionHeader = within(thead).getByText(/Должности/).closest('th')!;
    // A sortable header is a clickable button carrying a sort glyph; the
    // non-sortable position column renders a plain label with no glyph.
    expect(positionHeader.textContent).not.toContain('↕');
    expect(positionHeader.querySelector('button')).toBeNull();
  });

  // ─── Chrome ──────────────────────────────────────────────────────────────

  it('renders "+ Добавить сотрудника" and opens the create modal', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить сотрудника'));
    expect(screen.getByText('Новый сотрудник')).toBeInTheDocument();
  });

  it('shows "Удалить" in the action dropdown', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    expect(screen.getByText('Удалить')).toBeInTheDocument();
  });

  // ─── Archive (D6 dialog) / Restore ───────────────────────────────────────

  it('"Архивировать" opens the D6 dismissal dialog with both checkboxes preselected', async () => {
    setupEnvelope();
    await renderLoaded();
    // m1 has an ACTIVE master section and has_user=false → master checkbox
    // visible, user checkbox hidden.
    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Архивировать'));

    const dialog = await screen.findByTestId('archive-staff-dialog');
    const masterBox = within(dialog).getByTestId('archive-master-checkbox') as HTMLInputElement;
    expect(masterBox.checked).toBe(true);
    // m1 has_user=false → the account checkbox is not rendered.
    expect(within(dialog).queryByTestId('archive-user-checkbox')).not.toBeInTheDocument();
  });

  // D6 checkbox visibility matrix. The dialog only opens for an ACTIVE person
  // (an archived row exposes «Вернуть из архива»), so every case is its own
  // single-row envelope:
  //   master box  ← an ACTIVE master section exists (master && !master.archived)
  //   account box ← has_user (a linked account row, any is_active — Gap B)
  it.each(D6_CASES)('D6 dialog — $label', async ({ staff, master, user }) => {
    mockGetStaff.mockResolvedValue({ items: [staff], total: 1, page: 1, per_page: 10 });
    renderTable();
    await screen.findByText(`${staff.last_name} ${staff.first_name}`);

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Архивировать'));

    const dialog = await screen.findByTestId('archive-staff-dialog');
    const masterBox = within(dialog).queryByTestId('archive-master-checkbox');
    const userBox = within(dialog).queryByTestId('archive-user-checkbox');

    expect(masterBox !== null).toBe(master);
    expect(userBox !== null).toBe(user);
    // Every rendered checkbox is preselected (D6 «предвыбраны», mirrors the
    // backend defaults); unchecking is covered by the body-payload tests below.
    if (masterBox) expect((masterBox as HTMLInputElement).checked).toBe(true);
    if (userBox) expect((userBox as HTMLInputElement).checked).toBe(true);
    if (!master && !user) {
      expect(
        within(dialog).getByText(/будет архивирован только сотрудник/),
      ).toBeInTheDocument();
    }
  });

  it('confirm calls archiveStaff with the D6 checkbox body', async () => {
    const archiveMutateAsync = vi.fn().mockResolvedValue(createMockStaffResponse({ id: 'm1', archived: true }));
    mockUseArchiveStaff.mockReturnValue({ mutateAsync: archiveMutateAsync, isPending: false } as never);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Архивировать'));
    const dialog = await screen.findByTestId('archive-staff-dialog');
    fireEvent.click(within(dialog).getByTestId('archive-staff-confirm-btn'));

    await waitFor(() =>
      expect(archiveMutateAsync).toHaveBeenCalledWith({ id: 'm1', archive_master: true, archive_user: true }),
    );
  });

  it('unchecking the master box sends archive_master:false (D3 — link stays)', async () => {
    const archiveMutateAsync = vi.fn().mockResolvedValue(createMockStaffResponse({ id: 'm1', archived: true }));
    mockUseArchiveStaff.mockReturnValue({ mutateAsync: archiveMutateAsync, isPending: false } as never);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Архивировать'));
    const dialog = await screen.findByTestId('archive-staff-dialog');
    fireEvent.click(within(dialog).getByTestId('archive-master-checkbox'));
    fireEvent.click(within(dialog).getByTestId('archive-staff-confirm-btn'));

    await waitFor(() =>
      expect(archiveMutateAsync).toHaveBeenCalledWith({ id: 'm1', archive_master: false, archive_user: true }),
    );
  });

  it('"Вернуть из архива" calls restoreStaff', async () => {
    const restoreMutateAsync = vi.fn().mockResolvedValue(createMockStaffResponse({ id: 'm2', archived: false }));
    mockUseRestoreStaff.mockReturnValue({ mutateAsync: restoreMutateAsync, isPending: false } as never);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[1]);
    fireEvent.click(screen.getByText('Вернуть из архива'));
    await waitFor(() => expect(restoreMutateAsync).toHaveBeenCalledWith('m2'));
  });

  // ─── Delete → DeleteDialog (#207 §7) ─────────────────────────────────────

  it('opens DeleteDialog with the 409 dependency tree when delete conflicts', async () => {
    const deleteMutateAsync = setupDeleteConflict(DEPS_BLOCKED);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));

    expect(deleteMutateAsync).toHaveBeenCalledWith('m1');
    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-title').textContent).toContain('Середа Ольга');
  });

  it('Mode B (blocked by activities) shows "Архивировать" instead of "Удалить"', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));
    await waitFor(() => expect(screen.getByTestId('delete-dialog-block-message')).toBeInTheDocument());
    expect(screen.queryByTestId('delete-dialog-confirm-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument();
  });

  it('Mode A confirm calls resolveDeleteStaff with {} (all deps auto)', async () => {
    setupDeleteConflict(DEPS_AUTO);
    mockResolveDeleteStaff.mockResolvedValue(undefined);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));
    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() => expect(mockResolveDeleteStaff).toHaveBeenCalledWith('m1', {}));
    await waitFor(() =>
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['staff'] }),
    );
  });

  // ─── Edit ────────────────────────────────────────────────────────────────

  it('row click opens the edit modal pre-filled and submit sends no is_active (#207)', async () => {
    const updateMutateAsync = setupUpdateMock();
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getByText('Середа Ольга'));
    expect(await screen.findByText('Редактирование сотрудника')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled());
    const [callArg] = updateMutateAsync.mock.calls[0];
    expect(callArg.id).toBe('m1');
    expect((callArg.data as Record<string, unknown>).is_active).toBeUndefined();
    // The master section round-trips through the payload (specialty + color).
    expect((callArg.data as Record<string, unknown>).master).toMatchObject({
      specialty: 'живопись', color: '#5B8C7A',
    });
    expect((callArg.data as Record<string, unknown>).position_ids).toEqual(['master']);
  });

  it('renders the color swatch for masters', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();
    const swatches = container.querySelectorAll('tbody .rounded-full');
    // m1 + m2 carry a color swatch (s-smm has none).
    expect(swatches.length).toBeGreaterThanOrEqual(2);
  });

  it('shows default visible columns (имя, должности, специальность, цвет, архив)', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();
    const thead = container.querySelector('thead')!;
    // Scoped to thead — the archive badge in a row also reads «Архив».
    // Sortable headers carry a glyph («Имя ↕») → regex, not exact text.
    expect(within(thead).getByText(/Имя/)).toBeInTheDocument();
    expect(within(thead).getByText('Должности')).toBeInTheDocument();
    expect(within(thead).getByText(/Специальность/)).toBeInTheDocument();
    expect(within(thead).getByText(/Цвет/)).toBeInTheDocument();
    expect(within(thead).getByText(/Архив/)).toBeInTheDocument();
  });
});
