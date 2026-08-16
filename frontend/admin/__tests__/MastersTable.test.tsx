import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import {
  mockMasterResponse,
  mockMasterResponseArchived,
  createMockMasterResponse,
} from './helpers/mockData';
import type { DependencyNode } from '@memo/api-client';

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

// Shared so tests can assert cross-invalidation (#207: ['masters'] + ['records']).
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  // `keepPreviousData` is a sentinel symbol in real react-query; the component
  // imports it for `placeholderData`. Provide a stable sentinel so the import
  // resolves. The mocked `useQuery` ignores `placeholderData` anyway.
  keepPreviousData: Symbol('keepPreviousData'),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
  })),
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

// ─── Mock @memo/api-client — spy on getMasters (preserve other exports) ───

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getMasters: vi.fn(), resolveDeleteMaster: vi.fn() };
});

import { useQuery } from '@tanstack/react-query';
const mockUseQuery = vi.mocked(useQuery);

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
import {
  useUpdateMaster,
  usePatchMaster,
  useDeleteMaster,
  useArchiveMaster,
  useRestoreMaster,
} from '@/hooks/useMastersMutations';
import { useUI } from '@/contexts/UIContext';
import { getMasters, resolveDeleteMaster, ApiError } from '@memo/api-client';

const mockUseUpdateMaster = vi.mocked(useUpdateMaster);
const mockUsePatchMaster = vi.mocked(usePatchMaster);
const mockUseDeleteMaster = vi.mocked(useDeleteMaster);
const mockUseArchiveMaster = vi.mocked(useArchiveMaster);
const mockUseRestoreMaster = vi.mocked(useRestoreMaster);
const mockUseUI = vi.mocked(useUI);
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

function setupQuery(masters: typeof TEST_MASTERS, isLoading = false) {
  // Resolve the getMasters spy with the supplied list so the component's
  // `queryFn` (which calls `getMasters(...).then(r => r.items)`) settles.
  mockGetMasters.mockResolvedValue({
    items: masters,
    total: masters.length,
    page: 1,
    per_page: 100,
  });
  // Drive `useQuery` through `mockImplementation` so the real `queryFn` is
  // invoked on every render — this is what lets the getMasters spy record
  // the call args (including the current `status`). The resolved promise is
  // discarded; we inject the static `data` synchronously to keep these unit
  // tests independent of react-query's async fetch machinery.
  mockUseQuery.mockImplementation((((opts: { queryFn?: () => unknown }) => {
    try {
      void opts?.queryFn?.();
    } catch {
      // queryFn errors don't affect the injected static data
    }
    return {
      data: masters,
      isLoading,
      error: null,
      refetch: vi.fn(),
      isSuccess: true,
      isError: false,
      isPending: false,
      isFetching: false,
      status: 'success',
      fetchStatus: 'idle',
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
      failureCount: 0,
      failureReason: null,
      errorUpdateCount: 0,
      isFetched: true,
      isFetchedAfterMount: true,
      isInitialLoading: false,
      isLoadingError: false,
      isPlaceholderData: false,
      isRefetchError: false,
      isStale: false,
      isRefetching: false,
      isLoadingSuccess: true,
      remove: vi.fn(),
      promise: Promise.resolve({ data: masters }),
    };
  }) as unknown) as typeof useQuery);
  return mockGetMasters;
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

  it('renders master names in the table', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
    expect(screen.getByText('Большакова Юлия')).toBeInTheDocument();
    expect(screen.getByText('Петрова Анна')).toBeInTheDocument();
  });

  it('renders master specialties', () => {
    setupQuery(TEST_MASTERS);
    const { container } = render(<MastersTable />);

    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    // Two masters have "живопись" specialty
    expect(within(tbody!).getAllByText('живопись')).toHaveLength(2);
    expect(within(tbody!).getByText('керамика')).toBeInTheDocument();
  });

  it('renders master positions', () => {
    setupQuery(TEST_MASTERS);
    const { container } = render(<MastersTable />);

    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    expect(within(tbody!).getAllByText('мастер').length).toBeGreaterThanOrEqual(1);
    expect(within(tbody!).getByText('администратор')).toBeInTheDocument();
  });

  it('shows empty state when no masters', () => {
    setupQuery([]);
    render(<MastersTable />);

    expect(screen.getByText('Мастера не найдены')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    setupQuery([], true);
    render(<MastersTable />);

    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  it('filters by search text in name', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    const searchInput = screen.getByLabelText('Поиск по имени или фамилии');
    fireEvent.change(searchInput, { target: { value: 'Ольга' } });

    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
    expect(screen.queryByText('Большакова Юлия')).not.toBeInTheDocument();
    expect(screen.queryByText('Петрова Анна')).not.toBeInTheDocument();
  });

  it('requests active masters by default', () => {
    const spy = setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'active' });
  });

  it('requests archived masters when filter is "Архив"', () => {
    const spy = setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'archived' });
  });

  it('requests all masters when filter is "Все"', () => {
    const spy = setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'all' });
  });

  it('resets status filter to active when reset button clicked', () => {
    const spy = setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });
    fireEvent.click(screen.getByText('Сбросить'));

    expect(screen.getByLabelText('Фильтр по статусу')).toHaveValue('active');
    expect(spy).toHaveBeenLastCalledWith({ per_page: 100, status: 'active' });
  });

  it('resets filters when reset button clicked', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    const searchInput = screen.getByLabelText('Поиск по имени или фамилии');
    fireEvent.change(searchInput, { target: { value: 'Ольга' } });

    expect(screen.queryByText('Большакова Юлия')).not.toBeInTheDocument();

    const resetButton = screen.getByText('Сбросить');
    fireEvent.click(resetButton);

    expect(screen.getByText('Середа Ольга')).toBeInTheDocument();
    expect(screen.getByText('Большакова Юлия')).toBeInTheDocument();
    expect(screen.getByText('Петрова Анна')).toBeInTheDocument();
    expect(searchInput).toHaveValue('');
  });

  it('shows page count and total', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    expect(screen.getByText('3 всего')).toBeInTheDocument();
  });

  it('renders "Добавить мастера" button', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);
    expect(screen.getByText('+ Добавить мастера')).toBeInTheDocument();
  });

  it('opens create modal when "Добавить мастера" clicked', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);
    fireEvent.click(screen.getByText('+ Добавить мастера'));
    expect(screen.getByText('Новый мастер')).toBeInTheDocument();
  });

  it('opens create modal with empty fields', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);
    fireEvent.click(screen.getByText('+ Добавить мастера'));
    expect(screen.getByText('Новый мастер')).toBeInTheDocument();
    // Name input should be empty in create mode
    const firstNameInput = screen.getByPlaceholderText('Иван');
    expect(firstNameInput).toHaveValue('');
  });

  it('shows "Удалить" option in action dropdown', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    expect(screen.getByText('Удалить')).toBeInTheDocument();
  });

  // ─── Delete → DeleteDialog flow (#207 §7) ──────────────────────────────

  /** Delete hook whose dry-run dry-rejects with a 409 carrying the given tree. */
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
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

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
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

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
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

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
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

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
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('m1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });

  it('cancel closes the dialog without executing a delete', async () => {
    const deleteMutateAsync = setupDeleteConflict(DEPS_BLOCKED);
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

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
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

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
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    // m2 is archived → its dropdown shows "Восстановить"
    fireEvent.click(screen.getAllByLabelText('Действия')[1]);
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(restoreMutateAsync).toHaveBeenCalledWith('m2'));
    expect(patchMutateAsync).not.toHaveBeenCalled();
  });

  it('renders color swatch for each master', () => {
    setupQuery(TEST_MASTERS);
    const { container } = render(<MastersTable />);

    // Color swatches are small divs with rounded-full and backgroundColor
    const swatches = container.querySelectorAll('.rounded-full');
    expect(swatches.length).toBeGreaterThanOrEqual(TEST_MASTERS.length);
  });

  it('renders column picker gear button', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('shows default visible columns', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);
    expect(screen.getByText(/Имя/)).toBeInTheDocument();
    expect(screen.getByText(/Специальность/)).toBeInTheDocument();
    expect(screen.getByText(/Должность/)).toBeInTheDocument();
    expect(screen.getByText(/Цвет/)).toBeInTheDocument();
  });

  it('hides non-default columns by default', () => {
    setupQuery(TEST_MASTERS);
    const { container } = render(<MastersTable />);
    const thead = container.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Аватар/);
    expect(thead?.textContent).not.toMatch(/Статус/);
  });

  it('sorts by name when column header clicked', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    const nameHeader = screen.getByText(/Имя/);
    fireEvent.click(nameHeader);

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    const secondDataRow = rows[2];
    const thirdDataRow = rows[3];

    expect(within(firstDataRow).getByText('Петрова Анна')).toBeInTheDocument();
    expect(within(secondDataRow).getByText('Середа Ольга')).toBeInTheDocument();
    expect(within(thirdDataRow).getByText('Большакова Юлия')).toBeInTheDocument();
  });

  it('sorts by specialty when specialty header clicked', () => {
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    const specialtyHeader = screen.getByText(/Специальность/);
    fireEvent.click(specialtyHeader);

    const rows = screen.getAllByRole('row');
    // "живопись" < "керамика" in Russian alphabet, so "живопись" comes first ascending
    const firstDataRow = rows[1];
    expect(within(firstDataRow).getByText('живопись')).toBeInTheDocument();
  });

  it('paginates with page size selector', () => {
    const manyMasters = Array.from({ length: 25 }, (_, i) =>
      createMockMasterResponse({
        id: `m-${i}`,
        first_name: `Имя${String(i).padStart(2, '0')}`,
        last_name: `Фамилия${String(i).padStart(2, '0')}`,
        archived: false,
      }),
    );
    setupQuery(manyMasters);
    const { container } = render(<MastersTable />);

    expect(screen.getByText('25 всего')).toBeInTheDocument();

    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    let dataRows = tbody!.querySelectorAll('tr');
    expect(dataRows).toHaveLength(10);

    const pageSizeSelect = screen.getByTestId('page-size-select');
    fireEvent.change(pageSizeSelect, { target: { value: '20' } });

    dataRows = tbody!.querySelectorAll('tr');
    expect(dataRows).toHaveLength(20);
  });

  it('shows avatar thumbnail when avatar_url exists', () => {
    localStorage.setItem('masters-columns', JSON.stringify(['name', 'avatar']));
    setupQuery([mockMasterResponse]);
    render(<MastersTable />);

    const img = screen.getByAltText('avatar');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  });

  it('shows dash when avatar_url is null', () => {
    localStorage.setItem('masters-columns', JSON.stringify(['name', 'avatar']));
    setupQuery([mockMasterResponseArchived]);
    const { container } = render(<MastersTable />);

    const tbody = container.querySelector('tbody');
    // Should have a dash character in the avatar column
    expect(tbody?.textContent).toContain('—');
  });

  // ─── Edit does not resurrect archived masters (GH #195 via #207) ────────

  it('edit submit on archived master sends no archive flag (GH #195/#207)', async () => {
    const updateMutateAsync = setupUpdateMock();
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

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
