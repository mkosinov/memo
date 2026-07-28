import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  mockLocationResponse,
  mockLocationResponseArchived,
  createMockLocationResponse,
} from './helpers/mockData';

// ─── Mock @tanstack/react-query ──────────────────────────────────────────

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: vi.fn(),
  })),
  useMutation: vi.fn(() => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
  })),
}));

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
    isPending: false,
  })),
  useCreateLocation: vi.fn(() => ({
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
import { useUpdateLocation, useDeleteLocation } from '@/hooks/useLocationsMutations';
import { useUI } from '@/contexts/UIContext';

const mockUseUpdateLocation = vi.mocked(useUpdateLocation);
const mockUseDeleteLocation = vi.mocked(useDeleteLocation);
const mockUseUI = vi.mocked(useUI);

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
    is_active: true,
  }),
];

// ─── Helpers ─────────────────────────────────────────────────────────────

function setupQuery(locations: typeof TEST_LOCATIONS, isLoading = false) {
  mockUseQuery.mockReturnValue({
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
    promise: Promise.resolve({ data: TEST_LOCATIONS }),
  } as unknown as ReturnType<typeof useQuery>);
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

function setupDeleteMock() {
  const mutateAsync = vi.fn().mockResolvedValue({});
  mockUseDeleteLocation.mockReturnValue({
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
  } as unknown as ReturnType<typeof useDeleteLocation>);
  return mutateAsync;
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

  it('filters by active status', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const statusSelect = screen.getByLabelText('Фильтр по статусу');
    fireEvent.change(statusSelect, { target: { value: 'active' } });

    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();
    expect(screen.getByText('Альпика')).toBeInTheDocument();
    expect(screen.queryByText('Гранд Отель Поляна')).not.toBeInTheDocument();
  });

  it('shows all locations when status filter is "all"', () => {
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const statusSelect = screen.getByLabelText('Фильтр по статусу');
    fireEvent.change(statusSelect, { target: { value: '' } });

    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();
    expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
    expect(screen.getByText('Альпика')).toBeInTheDocument();
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
        is_active: true,
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

  it('calls deleteLocation when "Удалить" clicked and confirmed', async () => {
    const deleteMutateAsync = vi.fn().mockResolvedValue({});
    mockUseDeleteLocation.mockReturnValue({
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
    } as unknown as ReturnType<typeof useDeleteLocation>);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    // Open action menu and click delete
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));

    expect(window.confirm).toHaveBeenCalledWith('Удалить локацию?');
    expect(deleteMutateAsync).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('does not call deleteLocation when confirmation cancelled', () => {
    const deleteMutateAsync = vi.fn();
    mockUseDeleteLocation.mockReturnValue({
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
    } as unknown as ReturnType<typeof useDeleteLocation>);

    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setupQuery(TEST_LOCATIONS);
    render(<LocationsTable />);

    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));

    expect(window.confirm).toHaveBeenCalledWith('Удалить локацию?');
    expect(deleteMutateAsync).not.toHaveBeenCalled();
    vi.restoreAllMocks();
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
});
