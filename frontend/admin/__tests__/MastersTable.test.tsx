import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  mockMasterResponse,
  mockMasterResponseArchived,
  createMockMasterResponse,
} from './helpers/mockData';
import type { DependencyNode, MasterResponse, PaginatedResponse } from '@memo/api-client';

// ─── Dependency tree fixtures (mirror backend src/domain/deletion.py) ─────

// Master with activities → delete blocked → Mode B (archive only).
const DEPS_BLOCKED: DependencyNode[] = [
  {
    entity: 'activities',
    relation: 'Активность',
    count: 3,
    allowed_actions: [],
    message: 'Удалите активности вручную или архивируйте',
  },
  { entity: 'master_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
];

// Master with only auto deps (users + tags) → Mode A, resolutions body {}.
const DEPS_AUTO: DependencyNode[] = [
  { entity: 'users', relation: 'Пользователь', count: 1, allowed_actions: ['cascade'], message: null },
  { entity: 'master_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
];

// ─── Mock @tanstack/react-query ──────────────────────────────────────────
// Only useQueryClient is mocked (invalidate spy shared with the delete flow
// assertions). useQuery/QueryClientProvider stay REAL: the table renders
// inside the real MastersProvider, and the server-pagination wiring is
// asserted through the getMasters spy (RecordsTable precedent).

// Shared so tests can assert cross-invalidation (#207: ['masters'] + ['records']).
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({
      invalidateQueries: mockInvalidateQueries,
    })),
  };
});

// ─── Mock @memo/api-client — spy on getMasters (preserve other exports) ───

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getMasters: vi.fn(), resolveDeleteMaster: vi.fn() };
});

// ─── Mock hooks ──────────────────────────────────────────────────────────

vi.mock('@/hooks/useMastersMutations', () => ({
  useUpdateMaster: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  usePatchMaster: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useDeleteMaster: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    dependencies: null,
    isPending: false,
  })),
  useCreateMaster: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useArchiveMaster: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useRestoreMaster: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
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

// ─── Import after mocks ──────────────────────────────────────────────────

import { MastersTable } from '@/app/(main)/masters/components/MastersTable';
import { MastersProvider } from '@/contexts/MastersContext';
import {
  useUpdateMaster,
  usePatchMaster,
  useDeleteMaster,
  useArchiveMaster,
  useRestoreMaster,
} from '@/hooks/useMastersMutations';
import { getMasters, resolveDeleteMaster, ApiError } from '@memo/api-client';

const mockUseUpdateMaster = vi.mocked(useUpdateMaster);
const mockUsePatchMaster = vi.mocked(usePatchMaster);
const mockUseDeleteMaster = vi.mocked(useDeleteMaster);
const mockUseArchiveMaster = vi.mocked(useArchiveMaster);
const mockUseRestoreMaster = vi.mocked(useRestoreMaster);
const mockGetMasters = vi.mocked(getMasters);
const mockResolveDeleteMaster = vi.mocked(resolveDeleteMaster);

// ─── Test data ───────────────────────────────────────────────────────────

const TEST_MASTERS = [
  mockMasterResponse,
  mockMasterResponseArchived,
  createMockMasterResponse({
    id: 'm3',
    first_name: 'Анна',
    last_name: 'Петрова',
    specialty: 'живопись',
    position: 'администратор',
    archived: false,
  }),
];

// ─── Helpers ─────────────────────────────────────────────────────────────

function setupEnvelope(overrides: Partial<PaginatedResponse<MasterResponse>> = {}) {
  mockGetMasters.mockResolvedValue({
    items: TEST_MASTERS,
    total: TEST_MASTERS.length,
    page: 1,
    per_page: 10,
    ...overrides,
  });
}

/** Real MastersProvider + real QueryClient; list data flows through the mocked getMasters. */
function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MastersProvider>
        <MastersTable />
      </MastersProvider>
    </QueryClientProvider>,
  );
}

/** Render and wait for the server page to load. */
async function renderLoaded() {
  const view = renderTable();
  await screen.findByText('Середа Ольга');
  return view;
}

function setupUpdateMock() {
  const mutateAsync = vi.fn().mockResolvedValue({});
  mockUseUpdateMaster.mockReturnValue({
    mutateAsync,
    mutate: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    isIdle: true,
    data: undefined,
    error: null,
    status: 'idle',
    reset: vi.fn(),
    failureCount: 0,
    failureReason: null,
    variables: undefined,
    context: undefined,
    submittedAt: 0,
  } as unknown as ReturnType<typeof useUpdateMaster>);
  return mutateAsync;
}

/** A 409 ApiError carrying the dependency tree — what deleteMaster rejects with on conflict. */
function conflictError(dependencies: DependencyNode[]): ApiError {
  return new ApiError(409, 'Удаление невозможно', 'CONFLICT', dependencies);
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('MastersTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders master names in the table', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
    expect(screen.getByText('Большакова Юлия')).toBeInTheDocument();
    expect(screen.getByText('Петрова Анна')).toBeInTheDocument();
  });

  it('renders master specialties', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();

    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    // Two masters have "живопись" specialty
    expect(within(tbody!).getAllByText('живопись')).toHaveLength(2);
    expect(within(tbody!).getByText('керамика')).toBeInTheDocument();
  });

  it('renders master positions', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();

    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    expect(within(tbody!).getAllByText('мастер').length).toBeGreaterThanOrEqual(1);
    expect(within(tbody!).getByText('администратор')).toBeInTheDocument();
  });

  it('shows empty state when no masters', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();

    expect(await screen.findByText('Мастера не найдены')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    mockGetMasters.mockReturnValue(new Promise<PaginatedResponse<MasterResponse>>(() => {}));
    const { container } = renderTable();

    // B2 cat 4 (#139 §6.8): the shared DataTable replaced the "Загрузка..."
    // div with a 10-row skeleton (visible columns only).
    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr').length).toBe(10);
    });
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();
  });

  // ─── Server fetch params (#205 §5.2/§5.3) ──────────────────────────────

  it('initial fetch sends page/per_page/status with NO sort params (server default order)', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(mockGetMasters).toHaveBeenCalledTimes(1);
    expect(mockGetMasters).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'active' });
    // sortBy starts null → sort params omitted → backend default
    // sort_order/first_name/id order (preserves manual reorder).
    expect(mockGetMasters.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(mockGetMasters.mock.calls[0][0]).not.toHaveProperty('sort_order');
  });

  it('status filter change refetches with the new server status param', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });

    await waitFor(() => {
      expect(mockGetMasters).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });
  });

  it('status filter "Все" refetches with status=all', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    await waitFor(() => {
      expect(mockGetMasters).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'all' });
    });
  });

  it('resets status filter to active when reset button clicked', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });
    await waitFor(() => {
      expect(mockGetMasters).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });

    fireEvent.click(screen.getByText('Сбросить'));

    await waitFor(() => {
      expect(mockGetMasters).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'active' });
    });
    expect(screen.getByLabelText('Фильтр по статусу')).toHaveValue('active');
  });

  // ─── Search (G1b Q1 — KEPT: client-side filter over the loaded page) ───

  it('filters the loaded page by search text in name (client-side)', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по имени или фамилии');
    fireEvent.change(searchInput, { target: { value: 'Ольга' } });

    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
    expect(screen.queryByText('Большакова Юлия')).not.toBeInTheDocument();
    expect(screen.queryByText('Петрова Анна')).not.toBeInTheDocument();
  });

  it('resets search filter when reset button clicked', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по имени или фамилии');
    fireEvent.change(searchInput, { target: { value: 'Ольга' } });

    expect(screen.queryByText('Большакова Юлия')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Сбросить'));

    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
    expect(screen.getByText('Большакова Юлия')).toBeInTheDocument();
    expect(screen.getByText('Петрова Анна')).toBeInTheDocument();
    expect(searchInput).toHaveValue('');
  });

  // ─── Server-driven pagination wiring ───────────────────────────────────

  it('pager renders 5 numbered pages from server total 42 and page click refetches', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    expect(screen.getByText('42 всего')).toBeInTheDocument();
    for (let i = 1; i <= 5; i += 1) {
      expect(screen.getByRole('button', { name: String(i) })).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole('button', { name: '2' }));

    await waitFor(() => {
      expect(mockGetMasters).toHaveBeenCalledWith({ page: 2, per_page: 10, status: 'active' });
    });
  });

  it('page-size select refetches page 1 with the new per_page', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '20' } });

    await waitFor(() => {
      expect(mockGetMasters).toHaveBeenCalledWith({ page: 1, per_page: 20, status: 'active' });
    });
  });

  it('first header click sorts asc, second click toggles desc (server sort)', async () => {
    setupEnvelope();
    await renderLoaded();

    const nameHeader = screen.getByText(/Имя/);
    // No sort picked yet → neutral indicator
    expect(nameHeader.textContent).toContain('↕');

    fireEvent.click(nameHeader);
    await waitFor(() => {
      expect(mockGetMasters).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'name',
        sort_order: 'asc',
      });
    });
    expect(screen.getByText(/Имя/).textContent).toContain('↑');

    fireEvent.click(nameHeader);
    await waitFor(() => {
      expect(mockGetMasters).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'name',
        sort_order: 'desc',
      });
    });
    expect(screen.getByText(/Имя/).textContent).toContain('↓');
  });

  // ─── Chrome ─────────────────────────────────────────────────────────────

  it('renders "Добавить мастера" button', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(screen.getByText('+ Добавить мастера')).toBeInTheDocument();
  });

  it('opens create modal when "Добавить мастера" clicked', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить мастера'));
    expect(screen.getByText('Новый мастер')).toBeInTheDocument();
  });

  it('opens create modal with empty fields', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить мастера'));
    expect(screen.getByText('Новый мастер')).toBeInTheDocument();
    // Name input should be empty in create mode
    const firstNameInput = screen.getByPlaceholderText('Иван');
    expect(firstNameInput).toHaveValue('');
  });

  it('shows "Удалить" option in action dropdown', async () => {
    setupEnvelope();
    await renderLoaded();
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    expect(screen.getByText('Удалить')).toBeInTheDocument();
  });

  // ─── Delete → DeleteDialog flow (#207 §7) ──────────────────────────────

  /** Delete hook whose dry-run rejects with a 409 carrying the given tree. */
  function setupDeleteConflict(deps: DependencyNode[]) {
    const mutateAsync = vi.fn().mockRejectedValue(conflictError(deps));
    mockUseDeleteMaster.mockReturnValue({
      mutateAsync,
      dependencies: deps,
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
      isIdle: true,
      data: undefined,
      error: conflictError(deps),
      status: 'error',
      reset: vi.fn(),
      failureCount: 1,
      failureReason: conflictError(deps),
      variables: undefined,
      context: undefined,
      submittedAt: 0,
    } as unknown as ReturnType<typeof useDeleteMaster>);
    return mutateAsync;
  }

  it('opens DeleteDialog with the 409 dependency tree when delete conflicts', async () => {
    const deleteMutateAsync = setupDeleteConflict(DEPS_BLOCKED);
    setupEnvelope();
    await renderLoaded();

    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));

    expect(deleteMutateAsync).toHaveBeenCalledWith('m1');
    // window.confirm is gone — the dialog takes over (§7.3 fetch flow)
    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-title').textContent).toContain('Середа Ольга');
  });

  it('Mode B (blocked by activities) shows "Архивировать" instead of "Удалить"', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-block-message')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-block-message').textContent).toContain('3 активности');
    expect(screen.queryByTestId('delete-dialog-confirm-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument();
  });

  it('Mode B "Архивировать" calls archiveMaster and closes the dialog', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    const archiveMutateAsync = vi.fn().mockResolvedValue(createMockMasterResponse({ id: 'm1', archived: true }));
    mockUseArchiveMaster.mockReturnValue({ mutateAsync: archiveMutateAsync, isPending: false } as never);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-archive-btn'));

    await waitFor(() => expect(archiveMutateAsync).toHaveBeenCalledWith('m1'));
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('Mode A confirm calls resolveDeleteMaster with {} (all deps auto) and closes', async () => {
    setupDeleteConflict(DEPS_AUTO);
    mockResolveDeleteMaster.mockResolvedValue(undefined);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-confirm-input')).toBeInTheDocument());
    // Type-to-confirm unlocks the button
    fireEvent.change(screen.getByTestId('delete-dialog-confirm-input'), {
      target: { value: 'Середа Ольга' },
    });
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() => expect(mockResolveDeleteMaster).toHaveBeenCalledWith('m1', {}));
    await waitFor(() =>
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['masters'] }),
    );
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('204 dry-run success → instant delete: dry-run call happens, no dialog opens', async () => {
    // Hook-level cross-invalidation (['masters'] + ['records']) is covered by
    // useMastersMutations.test.ts — the mutation is mocked out here, so this
    // test asserts table behavior only: the dry-run fires and the dialog
    // never opens when the delete succeeds.
    const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseDeleteMaster.mockReturnValue({
      mutateAsync: deleteMutateAsync,
      dependencies: null,
      mutate: vi.fn(),
      isPending: false,
      isSuccess: false,
      isError: false,
      isIdle: true,
      data: undefined,
      error: null,
      status: 'idle',
      reset: vi.fn(),
      failureCount: 0,
      failureReason: null,
      variables: undefined,
      context: undefined,
      submittedAt: 0,
    } as unknown as ReturnType<typeof useDeleteMaster>);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('m1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });

  it('cancel closes the dialog without executing a delete', async () => {
    const deleteMutateAsync = setupDeleteConflict(DEPS_BLOCKED);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-cancel-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-cancel-btn'));

    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    // Only the dry-run attempt happened — never executed beyond it
    expect(deleteMutateAsync).toHaveBeenCalledTimes(1);
  });

  // ─── Archive / Restore (#207 §7.2, replaces patchX({is_active})) ────────

  it('calls archiveMaster when "В архив" clicked on an active master', async () => {
    const archiveMutateAsync = vi.fn().mockResolvedValue(createMockMasterResponse({ id: 'm1', archived: true }));
    const patchMutateAsync = vi.fn();
    mockUseArchiveMaster.mockReturnValue({ mutateAsync: archiveMutateAsync, isPending: false } as never);
    mockUsePatchMaster.mockReturnValue({ mutateAsync: patchMutateAsync, isPending: false } as never);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('В архив'));

    await waitFor(() => expect(archiveMutateAsync).toHaveBeenCalledWith('m1'));
    expect(patchMutateAsync).not.toHaveBeenCalled();
  });

  it('calls restoreMaster when "Восстановить" clicked on an archived master', async () => {
    const restoreMutateAsync = vi.fn().mockResolvedValue(createMockMasterResponse({ id: 'm2', archived: false }));
    const patchMutateAsync = vi.fn();
    mockUseRestoreMaster.mockReturnValue({ mutateAsync: restoreMutateAsync, isPending: false } as never);
    mockUsePatchMaster.mockReturnValue({ mutateAsync: patchMutateAsync, isPending: false } as never);
    setupEnvelope();
    await renderLoaded();

    // m2 is archived → its dropdown shows "Восстановить"
    fireEvent.click(screen.getAllByLabelText('Действия')[1]);
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(restoreMutateAsync).toHaveBeenCalledWith('m2'));
    expect(patchMutateAsync).not.toHaveBeenCalled();
  });

  it('renders color swatch for each master', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();

    // Color swatches are small divs with rounded-full and backgroundColor
    const swatches = container.querySelectorAll('tbody .rounded-full');
    expect(swatches.length).toBeGreaterThanOrEqual(TEST_MASTERS.length);
  });

  it('renders column picker gear button', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('shows default visible columns', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(screen.getByText(/Имя/)).toBeInTheDocument();
    expect(screen.getByText(/Специальность/)).toBeInTheDocument();
    expect(screen.getByText(/Должность/)).toBeInTheDocument();
    expect(screen.getByText(/Цвет/)).toBeInTheDocument();
  });

  it('hides non-default columns by default', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();
    const thead = container.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Аватар/);
    expect(thead?.textContent).not.toMatch(/Статус/);
  });

  it('shows avatar thumbnail when avatar_url exists', async () => {
    localStorage.setItem('masters-columns', JSON.stringify(['name', 'avatar']));
    setupEnvelope({ items: [mockMasterResponse], total: 1 });
    renderTable();
    await screen.findByText('Середа Ольга');

    const img = screen.getByAltText('avatar');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('shows dash when avatar_url is null', async () => {
    localStorage.setItem('masters-columns', JSON.stringify(['name', 'avatar']));
    setupEnvelope({ items: [mockMasterResponseArchived], total: 1 });
    const { container } = renderTable();
    await screen.findByText('Большакова Юлия');

    const tbody = container.querySelector('tbody');
    // Should have a dash character in the avatar column
    expect(tbody?.textContent).toContain('—');
  });

  // ─── Edit does not resurrect archived masters (GH #195 via #207) ────────

  it('edit submit on archived master sends no archive flag (GH #195/#207)', async () => {
    const updateMutateAsync = setupUpdateMock();
    setupEnvelope();
    await renderLoaded();

    // Open the edit modal on the archived row (mockMasterResponseArchived id=m2,
    // displayed as "Большакова Юлия").
    const archivedRow = screen.getByText('Большакова Юлия').closest('tr')!;
    fireEvent.click(archivedRow);

    // Submit the modal — pre-populated fields are valid for the fixture.
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    // #207 inverted the schema: Update bodies carry no archive flag at all
    // (archive/restore goes through POST endpoints), so editing an archived
    // master can no longer resurrect it. The payload must carry no flag.
    // (Until Task 19 rewires the table, the key survives as undefined.)
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled());
    const [callArg] = updateMutateAsync.mock.calls[0];
    expect(callArg.id).toBe(mockMasterResponseArchived.id);
    expect((callArg.data as Record<string, unknown>).is_active).toBeUndefined();
  });
});
