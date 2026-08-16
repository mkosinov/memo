import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import {
  mockLocationResponse,
  mockLocationResponseArchived,
  createMockLocationResponse,
} from './helpers/mockData';
import type { DependencyNode } from '@memo/api-client';

// ─── Dependency tree fixtures (mirror backend src/domain/deletion.py) ─────

// Location with activities → delete blocked → Mode B (archive only).
const DEPS_BLOCKED: DependencyNode[] = [
  {
    entity: 'activities',
    relation: 'Активность',
    count: 3,
    allowed_actions: [],
    message: 'Удалите активности вручную или архивируйте',
  },
  { entity: 'location_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
];

// Location with only auto deps (tags) → Mode A, resolutions body {}.
const DEPS_AUTO: DependencyNode[] = [
  { entity: 'location_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
];

// ─── Mock @tanstack/react-query ──────────────────────────────────────────

// Shared so tests can assert invalidation (#207: ['locations'] on dialog done).
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

// ─── Mock @memo/api-client — spy on getLocations (preserve other exports) ─

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getLocations: vi.fn(), resolveDeleteLocation: vi.fn() };
});

import { useQuery } from '@tanstack/react-query';
const mockUseQuery = vi.mocked(useQuery);

// ─── Mock hooks ──────────────────────────────────────────────────────────

vi.mock('@/hooks/useLocationsMutations', () => ({
  useUpdateLocation: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  usePatchLocation: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useDeleteLocation: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    dependencies: null,
    isPending: false,
  })),
  useCreateLocation: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useArchiveLocation: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useRestoreLocation: vi.fn(() => ({
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

import { LocationsTable } from '@/app/(main)/locations/components/LocationsTable';
import {
  useUpdateLocation,
  usePatchLocation,
  useDeleteLocation,
  useArchiveLocation,
  useRestoreLocation,
} from '@/hooks/useLocationsMutations';
import { useUI } from '@/contexts/UIContext';
import { getLocations, resolveDeleteLocation, ApiError } from '@memo/api-client';

const mockUseUpdateLocation = vi.mocked(useUpdateLocation);
const mockUsePatchLocation = vi.mocked(usePatchLocation);
const mockUseDeleteLocation = vi.mocked(useDeleteLocation);
const mockUseArchiveLocation = vi.mocked(useArchiveLocation);
const mockUseRestoreLocation = vi.mocked(useRestoreLocation);
const mockUseUI = vi.mocked(useUI);
const mockGetLocations = vi.mocked(getLocations);
const mockResolveDeleteLocation = vi.mocked(resolveDeleteLocation);

// ─── Test data ───────────────────────────────────────────────────────────

const TEST_LOCATIONS = [
  mockLocationResponse,
  mockLocationResponseArchived,
  createMockLocationResponse({
    id: 'loc-3',
    name: 'Альпика',
    address: 'Альпика, 1 этаж',
    capacity: 15,
    location_hint: null,
    archived: false,
  }),
];

// ─── Helpers ─────────────────────────────────────────────────────────────

function setupQuery(locations: typeof TEST_LOCATIONS, isLoading = false) {
  // Resolve the getLocations spy with the supplied list so the component's
  // `queryFn` (which calls `getLocations(...).then(r => r.items)`) settles.
  mockGetLocations.mockResolvedValue({
    items: locations,
    total: locations.length,
    page: 1,
    per_page: 100,
  });
  // Drive `useQuery` through `mockImplementation` so the real `queryFn` is
  // invoked on every render — this is what lets the getLocations spy record
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
      data: locations,
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
      promise: Promise.resolve({ data: locations }),
    };
  }) as unknown) as typeof useQuery);
  return mockGetLocations;
}

function setupUpdateMock() {
  const mutateAsync = vi.fn().mockResolvedValue({});
  mockUseUpdateLocation.mockReturnValue({
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
  } as unknown as ReturnType<typeof useUpdateLocation>);
  return mutateAsync;
}

/** A 409 ApiError carrying the dependency tree — what deleteLocation rejects with on conflict. */
function conflictError(dependencies: DependencyNode[]): ApiError {
  return new ApiError(409, 'Удаление невозможно', 'CONFLICT', dependencies);
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('LocationsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders location names in the table', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();
    expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
    expect(screen.getByText('Альпика')).toBeInTheDocument();
  });

  it('renders location capacities', () => {
    setupQuery(TEST_LOCATIONS);
    const { container } = render(<LocationsTable />);

    // Scope queries to tbody to avoid matching select option values
    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    expect(within(tbody!).getByText('10')).toBeInTheDocument();
    expect(within(tbody!).getByText('20')).toBeInTheDocument();
    expect(within(tbody!).getByText('15')).toBeInTheDocument();
  });

  it('shows empty state when no locations', () => {
    setupQuery([]);
    render(<LocationsTable />);

    expect(screen.getByText('Локации не найдены')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    setupQuery([], true);
    render(<LocationsTable />);

    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  it('sorts by name when column header clicked', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const nameHeader = screen.getByText(/Название/);
    fireEvent.click(nameHeader);

    // After sorting asc, names should appear alphabetically
    const rows = screen.getAllByRole('row');
    // Row 0 is header, row 1-3 are data
    const firstDataRow = rows[1];
    const secondDataRow = rows[2];
    const thirdDataRow = rows[3];

    expect(within(firstDataRow).getByText('Альпика')).toBeInTheDocument();
    expect(within(secondDataRow).getByText('Гранд Отель Поляна')).toBeInTheDocument();
    expect(within(thirdDataRow).getByText('Студия на Невском')).toBeInTheDocument();
  });

  it('reverses sort direction on second click', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const nameHeader = screen.getByText(/Название/);
    // Click twice for desc
    fireEvent.click(nameHeader);
    fireEvent.click(nameHeader);

    const rows = screen.getAllByRole('row');
    const firstDataRow = rows[1];
    const thirdDataRow = rows[3];

    expect(within(firstDataRow).getByText('Студия на Невском')).toBeInTheDocument();
    expect(within(thirdDataRow).getByText('Альпика')).toBeInTheDocument();
  });

  it('filters by search text in name', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const searchInput = screen.getByLabelText('Поиск по названию или адресу');
    fireEvent.change(searchInput, { target: { value: 'Невском' } });

    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();
    expect(screen.queryByText('Гранд Отель Поляна')).not.toBeInTheDocument();
    expect(screen.queryByText('Альпика')).not.toBeInTheDocument();
  });

  it('filters by search text in address', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const searchInput = screen.getByLabelText('Поиск по названию или адресу');
    fireEvent.change(searchInput, { target: { value: 'лобби' } });

    expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
    expect(screen.queryByText('Студия на Невском')).not.toBeInTheDocument();
    expect(screen.queryByText('Альпика')).not.toBeInTheDocument();
  });

  it('requests active locations by default', () => {
    const spy = setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'active' });
  });

  it('requests archived locations when filter is "Архив"', () => {
    const spy = setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'archived' });
  });

  it('requests all locations when filter is "Все"', () => {
    const spy = setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'all' });
  });

  it('resets status filter to active when reset button clicked', () => {
    const spy = setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });
    fireEvent.click(screen.getByText('Сбросить'));

    expect(screen.getByLabelText('Фильтр по статусу')).toHaveValue('active');
    expect(spy).toHaveBeenLastCalledWith({ per_page: 100, status: 'active' });
  });

  it('resets filters when reset button clicked', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const searchInput = screen.getByLabelText('Поиск по названию или адресу');
    fireEvent.change(searchInput, { target: { value: 'Невском' } });

    // Only one visible now
    expect(screen.queryByText('Гранд Отель Поляна')).not.toBeInTheDocument();

    // Click reset
    const resetButton = screen.getByText('Сбросить');
    fireEvent.click(resetButton);

    // All visible again
    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();
    expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
    expect(screen.getByText('Альпика')).toBeInTheDocument();

    // Search input is cleared
    expect(searchInput).toHaveValue('');
  });

  it('shows page count and total', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    expect(screen.getByText('3 всего')).toBeInTheDocument();
  });

  it('paginates with page size selector', () => {
    // Create 25 locations to test pagination across 2+ pages
    const manyLocations = Array.from({ length: 25 }, (_, i) =>
      createMockLocationResponse({
        id: `loc-${i}`,
        name: `Локация ${String(i).padStart(2, '0')}`,
        capacity: i + 1,
        archived: false,
      }),
    );
    setupQuery(manyLocations);
    const { container } = render(<LocationsTable />);

    expect(screen.getByText('25 всего')).toBeInTheDocument();

    // Default page size is 10, should show 10 data rows
    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    let dataRows = tbody!.querySelectorAll('tr');
    expect(dataRows).toHaveLength(10);

    // Change page size to 20 (valid option)
    const pageSizeSelect = screen.getByTestId('page-size-select');
    fireEvent.change(pageSizeSelect, { target: { value: '20' } });

    // Now shows 20 rows of data on page 1
    dataRows = tbody!.querySelectorAll('tr');
    expect(dataRows).toHaveLength(20);
  });

  it('shows yandex map link icon for locations with map url', () => {
    setupQuery([mockLocationResponse]);
    render(<LocationsTable />);

    // The location has yandex_map_url, should have a link
    const mapLink = screen.getByLabelText('Карта');
    expect(mapLink).toBeInTheDocument();
    expect(mapLink).toHaveAttribute('href', 'https://yandex.ru/maps/...');
    expect(mapLink).toHaveAttribute('target', '_blank');
  });

  it('does not show map link when yandex_map_url is null', () => {
    setupQuery([mockLocationResponseArchived]);
    render(<LocationsTable />);

    expect(screen.queryByLabelText('Карта')).not.toBeInTheDocument();
  });

  // ─── Create functionality ────────────────────────────────────────────

  it('renders "Добавить локацию" button', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);
    expect(screen.getByText('+ Добавить локацию')).toBeInTheDocument();
  });

  it('opens create modal when "Добавить локацию" clicked', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);
    fireEvent.click(screen.getByText('+ Добавить локацию'));
    expect(screen.getByText('Новая локация')).toBeInTheDocument();
  });

  it('opens create modal with empty name field', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);
    fireEvent.click(screen.getByText('+ Добавить локацию'));
    expect(screen.getByText('Новая локация')).toBeInTheDocument();
    // Name input should be empty in create mode
    const nameInput = screen.getByPlaceholderText('Студия на Тверской');
    expect(nameInput).toHaveValue('');
  });

  // ─── Delete functionality ────────────────────────────────────────────

  it('shows "Удалить" option in action dropdown', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);
    // Open action menu for first location
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    expect(screen.getByText('Удалить')).toBeInTheDocument();
  });

  // ─── Delete → DeleteDialog flow (#207 §7) ──────────────────────────────

  /** Delete hook whose dry-run rejects with a 409 carrying the given tree. */
  function setupDeleteConflict(deps: DependencyNode[]) {
    const mutateAsync = vi.fn().mockRejectedValue(conflictError(deps));
    mockUseDeleteLocation.mockReturnValue({
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
    } as unknown as ReturnType<typeof useDeleteLocation>);
    return mutateAsync;
  }

  it('opens DeleteDialog with the 409 dependency tree when delete conflicts', async () => {
    const deleteMutateAsync = setupDeleteConflict(DEPS_BLOCKED);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));

    expect(deleteMutateAsync).toHaveBeenCalledWith('loc-1');
    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-title').textContent).toContain('Студия на Невском');
  });

  it('Mode B (blocked by activities) shows "Архивировать" instead of "Удалить"', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-block-message')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-block-message').textContent).toContain('3 активности');
    expect(screen.queryByTestId('delete-dialog-confirm-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument();
  });

  it('Mode B "Архивировать" calls archiveLocation and closes the dialog', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    const archiveMutateAsync = vi.fn().mockResolvedValue(createMockLocationResponse({ id: 'loc-1', archived: true }));
    mockUseArchiveLocation.mockReturnValue({ mutateAsync: archiveMutateAsync, isPending: false } as never);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-archive-btn'));

    await waitFor(() => expect(archiveMutateAsync).toHaveBeenCalledWith('loc-1'));
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('Mode A confirm calls resolveDeleteLocation with {} (all deps auto) and closes', async () => {
    setupDeleteConflict(DEPS_AUTO);
    mockResolveDeleteLocation.mockResolvedValue(undefined);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-confirm-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('delete-dialog-confirm-input'), {
      target: { value: 'Студия на Невском' },
    });
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() => expect(mockResolveDeleteLocation).toHaveBeenCalledWith('loc-1', {}));
    await waitFor(() =>
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['locations'] }),
    );
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('204 dry-run success → instant delete: dry-run call happens, no dialog opens', async () => {
    const deleteMutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUseDeleteLocation.mockReturnValue({
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
    } as unknown as ReturnType<typeof useDeleteLocation>);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('loc-1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });

  it('cancel closes the dialog without executing a delete', async () => {
    const deleteMutateAsync = setupDeleteConflict(DEPS_BLOCKED);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-cancel-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-cancel-btn'));

    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    expect(deleteMutateAsync).toHaveBeenCalledTimes(1);
  });

  // ─── Archive / Restore (#207 §7.2, replaces patchX({is_active})) ────────

  it('calls archiveLocation when "В архив" clicked on an active location', async () => {
    const archiveMutateAsync = vi.fn().mockResolvedValue(createMockLocationResponse({ id: 'loc-1', archived: true }));
    const patchMutateAsync = vi.fn();
    mockUseArchiveLocation.mockReturnValue({ mutateAsync: archiveMutateAsync, isPending: false } as never);
    mockUsePatchLocation.mockReturnValue({ mutateAsync: patchMutateAsync, isPending: false } as never);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('В архив'));

    await waitFor(() => expect(archiveMutateAsync).toHaveBeenCalledWith('loc-1'));
    expect(patchMutateAsync).not.toHaveBeenCalled();
  });

  it('calls restoreLocation when "Восстановить" clicked on an archived location', async () => {
    const restoreMutateAsync = vi.fn().mockResolvedValue(createMockLocationResponse({ id: 'loc-2', archived: false }));
    const patchMutateAsync = vi.fn();
    mockUseRestoreLocation.mockReturnValue({ mutateAsync: restoreMutateAsync, isPending: false } as never);
    mockUsePatchLocation.mockReturnValue({ mutateAsync: patchMutateAsync, isPending: false } as never);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    // loc-2 is archived (row index 1) → its dropdown shows "Восстановить"
    fireEvent.click(screen.getAllByLabelText('Действия')[1]);
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(restoreMutateAsync).toHaveBeenCalledWith('loc-2'));
    expect(patchMutateAsync).not.toHaveBeenCalled();
  });

  // ─── Column picker ──────────────────────────────────────────────────────

  it('renders column picker gear button', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('shows default visible columns by default', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);
    // Default visible: name, capacity, address, location_hint
    // Column headers include sort icon ↕, so use partial matching
    expect(screen.getByText(/Название/)).toBeInTheDocument();
    expect(screen.getByText(/Вместимость/)).toBeInTheDocument();
    expect(screen.getByText(/Адрес/)).toBeInTheDocument();
    expect(screen.getByText(/Подсказка/)).toBeInTheDocument();
  });

  it('hides non-default columns by default', () => {
    setupQuery(TEST_LOCATIONS);
    const { container } = render(<LocationsTable />);
    // Check that column headers for hidden columns are NOT in the table header
    const thead = container.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Описание/);
    expect(thead?.textContent).not.toMatch(/Статус/);
    expect(thead?.textContent).not.toMatch(/Карта/);
    expect(thead?.textContent).not.toMatch(/Создано/);
  });

  it('shows hidden column in table when loaded from localStorage', () => {
    localStorage.setItem('locations-columns', JSON.stringify(['name', 'description']));
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);
    // "Описание" should be visible as a column header (includes sort icon)
    expect(screen.getByText(/Описание/)).toBeInTheDocument();
    // "Вместимость" should NOT be visible (not in localStorage set)
    const thead = document.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Вместимость/);
  });

  it('toggles column visibility via ColumnPicker', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    // Open picker
    fireEvent.click(screen.getByLabelText('Настроить колонки'));

    // Uncheck "Название" — it should disappear from table header
    fireEvent.click(screen.getByLabelText('Название'));
    const thead = document.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Название/);

    // Re-check "Название" — it should reappear in thead
    fireEvent.click(screen.getByLabelText('Название'));
    const theadAfter = document.querySelector('thead');
    expect(theadAfter?.textContent).toMatch(/Название/);
  });

  // ─── Edit does not resurrect archived locations (GH #195 via #207) ─────

  it('edit submit on archived location sends no archive flag (GH #195/#207)', async () => {
    const updateMutateAsync = setupUpdateMock();
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    // Open the edit modal on the archived row (mockLocationResponseArchived
    // id=loc-2, displayed as "Гранд Отель Поляна").
    const archivedRow = screen.getByText('Гранд Отель Поляна').closest('tr')!;
    fireEvent.click(archivedRow);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    // #207 inverted the schema: Update bodies carry no archive flag at all
    // (archive/restore goes through POST endpoints), so editing an archived
    // location can no longer resurrect it. The payload must carry no flag.
    // (Until Task 19 rewires the table, the key survives as undefined.)
    await waitFor(() => expect(updateMutateAsync).toHaveBeenCalled());
    const [callArg] = updateMutateAsync.mock.calls[0];
    expect(callArg.id).toBe(mockLocationResponseArchived.id);
    expect((callArg.data as Record<string, unknown>).is_active).toBeUndefined();
  });
});
