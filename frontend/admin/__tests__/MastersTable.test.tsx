import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import {
  mockMasterResponse,
  mockMasterResponseArchived,
  createMockMasterResponse,
} from './helpers/mockData';

// ─── Mock @tanstack/react-query ──────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  // `keepPreviousData` is a sentinel symbol in real react-query; the component
  // imports it for `placeholderData`. Provide a stable sentinel so the import
  // resolves. The mocked `useQuery` ignores `placeholderData` anyway.
  keepPreviousData: Symbol('keepPreviousData'),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
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
  return { ...actual, getMasters: vi.fn() };
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
    isPending: false,
  })),
  useCreateMaster: vi.fn(() => ({
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
import { useUpdateMaster, useDeleteMaster } from '@/hooks/useMastersMutations';
import { useUI } from '@/contexts/UIContext';
import { getMasters } from '@memo/api-client';

const mockUseUpdateMaster = vi.mocked(useUpdateMaster);
const mockUseDeleteMaster = vi.mocked(useDeleteMaster);
const mockUseUI = vi.mocked(useUI);
const mockGetMasters = vi.mocked(getMasters);

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
    is_active: true,
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

function setupDeleteMock() {
  const mutateAsync = vi.fn().mockResolvedValue({});
  mockUseDeleteMaster.mockReturnValue({
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
  } as unknown as ReturnType<typeof useDeleteMaster>);
  return mutateAsync;
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

  it('calls deleteMaster when "Удалить" clicked and confirmed', async () => {
    const deleteMutateAsync = vi.fn().mockResolvedValue({});
    mockUseDeleteMaster.mockReturnValue({
      mutateAsync: deleteMutateAsync,
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

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));

    expect(window.confirm).toHaveBeenCalledWith('Удалить мастера?');
    expect(deleteMutateAsync).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does not call deleteMaster when confirmation cancelled', () => {
    const deleteMutateAsync = vi.fn();
    mockUseDeleteMaster.mockReturnValue({
      mutateAsync: deleteMutateAsync,
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

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));

    expect(window.confirm).toHaveBeenCalledWith('Удалить мастера?');
    expect(deleteMutateAsync).not.toHaveBeenCalled();
    vi.restoreAllMocks();
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
        is_active: true,
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

  // ─── Edit preserves archive state (GH #195) ───────────────────────────

  it('edit submit preserves is_active=false on archived master (GH #195)', async () => {
    const updateMutateAsync = setupUpdateMock();
    setupQuery(TEST_MASTERS);
    render(<MastersTable />);

    // Open the edit modal on the archived row (mockMasterResponseArchived id=m2,
    // displayed as "Большакова Юлия").
    const archivedRow = screen.getByText('Большакова Юлия').closest('tr')!;
    fireEvent.click(archivedRow);

    // Submit the modal — pre-populated fields are valid for the fixture.
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    // Backend MasterUpdate schema defaults is_active=True; without sending
    // the row's current value, editing an archived row silently resurrects
    // it. The handler must propagate the row's is_active. (GH #195)
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled());
    const [callArg] = updateMutateAsync.mock.calls[0];
    expect(callArg.id).toBe(mockMasterResponseArchived.id);
    expect(callArg.data.is_active).toBe(false);
  });
});
