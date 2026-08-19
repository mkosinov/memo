import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  mockLocationResponse,
  mockLocationResponseArchived,
  createMockLocationResponse,
} from './helpers/mockData';
import type { DependencyNode, LocationResponse, PaginatedResponse } from '@memo/api-client';

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
// Only useQueryClient is mocked (invalidate spy shared with the delete flow
// assertions). useQuery/QueryClientProvider stay REAL: the table renders
// inside the real LocationsProvider, and the server-pagination wiring is
// asserted through the getLocations spy (RecordsTable precedent).

// Shared so tests can assert cross-invalidation (#207: ['locations'] + ['records']).
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

// ─── Mock @memo/api-client — spy on getLocations (preserve other exports) ─

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getLocations: vi.fn(), resolveDeleteLocation: vi.fn() };
});

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
import { LocationsProvider } from '@/contexts/LocationsContext';
import {
  useUpdateLocation,
  usePatchLocation,
  useDeleteLocation,
  useArchiveLocation,
  useRestoreLocation,
} from '@/hooks/useLocationsMutations';
import { getLocations, resolveDeleteLocation, ApiError } from '@memo/api-client';

const mockUseUpdateLocation = vi.mocked(useUpdateLocation);
const mockUsePatchLocation = vi.mocked(usePatchLocation);
const mockUseDeleteLocation = vi.mocked(useDeleteLocation);
const mockUseArchiveLocation = vi.mocked(useArchiveLocation);
const mockUseRestoreLocation = vi.mocked(useRestoreLocation);
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

function setupEnvelope(overrides: Partial<PaginatedResponse<LocationResponse>> = {}) {
  mockGetLocations.mockResolvedValue({
    items: TEST_LOCATIONS,
    total: TEST_LOCATIONS.length,
    page: 1,
    per_page: 10,
    ...overrides,
  });
}

/** Real LocationsProvider + real QueryClient; list data flows through the mocked getLocations. */
function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LocationsProvider>
        <LocationsTable />
      </LocationsProvider>
    </QueryClientProvider>,
  );
}

/** Render and wait for the server page to load. */
async function renderLoaded() {
  const view = renderTable();
  await screen.findByText('Студия на Невском');
  return view;
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

  it('renders location names in the table', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();
    expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
    expect(screen.getByText('Альпика')).toBeInTheDocument();
  });

  it('renders location capacities', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();

    // Scope queries to tbody to avoid matching select option values
    const tbody = container.querySelector('tbody');
    expect(tbody).toBeInTheDocument();
    expect(within(tbody!).getByText('10')).toBeInTheDocument();
    expect(within(tbody!).getByText('20')).toBeInTheDocument();
    expect(within(tbody!).getByText('15')).toBeInTheDocument();
  });

  it('shows empty state when no locations', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();

    expect(await screen.findByText('Локации не найдены')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    mockGetLocations.mockReturnValue(new Promise<PaginatedResponse<LocationResponse>>(() => {}));
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

    expect(mockGetLocations).toHaveBeenCalledTimes(1);
    expect(mockGetLocations).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'active' });
    // sortBy starts null → sort params omitted → backend default
    // sort_order/name/id order (preserves manual reorder).
    expect(mockGetLocations.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(mockGetLocations.mock.calls[0][0]).not.toHaveProperty('sort_order');
  });

  it('status filter change refetches with the new server status param', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });

    await waitFor(() => {
      expect(mockGetLocations).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });
  });

  it('status filter "Все" refetches with status=all', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    await waitFor(() => {
      expect(mockGetLocations).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'all' });
    });
  });

  it('resets status filter to active when reset button clicked', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });
    await waitFor(() => {
      expect(mockGetLocations).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });

    fireEvent.click(screen.getByText('Сбросить'));

    await waitFor(() => {
      expect(mockGetLocations).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'active' });
    });
    expect(screen.getByLabelText('Фильтр по статусу')).toHaveValue('active');
  });

  // ─── Search (G1b Q1 — KEPT: client-side filter over the loaded page) ───

  it('filters the loaded page by search text in name (client-side)', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию или адресу');
    fireEvent.change(searchInput, { target: { value: 'Невском' } });

    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();
    expect(screen.queryByText('Гранд Отель Поляна')).not.toBeInTheDocument();
    expect(screen.queryByText('Альпика')).not.toBeInTheDocument();
  });

  it('filters the loaded page by search text in address (client-side)', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию или адресу');
    fireEvent.change(searchInput, { target: { value: 'лобби' } });

    expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
    expect(screen.queryByText('Студия на Невском')).not.toBeInTheDocument();
    expect(screen.queryByText('Альпика')).not.toBeInTheDocument();
  });

  it('resets search filter when reset button clicked', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию или адресу');
    fireEvent.change(searchInput, { target: { value: 'Невском' } });

    expect(screen.queryByText('Гранд Отель Поляна')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Сбросить'));

    expect(screen.getByText('Студия на Невском')).toBeInTheDocument();
    expect(screen.getByText('Гранд Отель Поляна')).toBeInTheDocument();
    expect(screen.getByText('Альпика')).toBeInTheDocument();
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
      expect(mockGetLocations).toHaveBeenCalledWith({ page: 2, per_page: 10, status: 'active' });
    });
  });

  it('page-size select refetches page 1 with the new per_page', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '20' } });

    await waitFor(() => {
      expect(mockGetLocations).toHaveBeenCalledWith({ page: 1, per_page: 20, status: 'active' });
    });
  });

  it('first header click sorts asc, second click toggles desc (server sort)', async () => {
    setupEnvelope();
    await renderLoaded();

    const nameHeader = screen.getByText(/Название/);
    // No sort picked yet → neutral indicator
    expect(nameHeader.textContent).toContain('↕');

    fireEvent.click(nameHeader);
    await waitFor(() => {
      expect(mockGetLocations).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'name',
        sort_order: 'asc',
      });
    });
    expect(screen.getByText(/Название/).textContent).toContain('↑');

    fireEvent.click(nameHeader);
    await waitFor(() => {
      expect(mockGetLocations).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'name',
        sort_order: 'desc',
      });
    });
    expect(screen.getByText(/Название/).textContent).toContain('↓');
  });

  // ─── Chrome ─────────────────────────────────────────────────────────────

  it('renders "Добавить локацию" button', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(screen.getByText('+ Добавить локацию')).toBeInTheDocument();
  });

  it('opens create modal when "Добавить локацию" clicked', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить локацию'));
    expect(screen.getByText('Новая локация')).toBeInTheDocument();
  });

  it('opens create modal with empty name field', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить локацию'));
    expect(screen.getByText('Новая локация')).toBeInTheDocument();
    // Name input should be empty in create mode
    const nameInput = screen.getByPlaceholderText('Студия на Тверской');
    expect(nameInput).toHaveValue('');
  });

  it('shows "Удалить" option in action dropdown', async () => {
    setupEnvelope();
    await renderLoaded();
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    expect(screen.getByText('Удалить')).toBeInTheDocument();
  });

  it('shows page count and total', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('3 всего')).toBeInTheDocument();
  });

  it('shows yandex map link icon for locations with map url', async () => {
    setupEnvelope({ items: [mockLocationResponse], total: 1 });
    renderTable();
    await screen.findByText('Студия на Невском');

    // The location has yandex_map_url, should have a link
    const mapLink = screen.getByLabelText('Карта');
    expect(mapLink).toBeInTheDocument();
    expect(mapLink).toHaveAttribute('href', 'https://yandex.ru/maps/...');
    expect(mapLink).toHaveAttribute('target', '_blank');
  });

  it('does not show map link when yandex_map_url is null', async () => {
    setupEnvelope({ items: [mockLocationResponseArchived], total: 1 });
    renderTable();
    await screen.findByText('Гранд Отель Поляна');

    expect(screen.queryByLabelText('Карта')).not.toBeInTheDocument();
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
    setupEnvelope();
    await renderLoaded();

    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));

    expect(deleteMutateAsync).toHaveBeenCalledWith('loc-1');
    // window.confirm is gone — the dialog takes over (§7.3 fetch flow)
    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-title').textContent).toContain('Студия на Невском');
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

  it('Mode B "Архивировать" calls archiveLocation and closes the dialog', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    const archiveMutateAsync = vi.fn().mockResolvedValue(createMockLocationResponse({ id: 'loc-1', archived: true }));
    mockUseArchiveLocation.mockReturnValue({ mutateAsync: archiveMutateAsync, isPending: false } as never);
    setupEnvelope();
    await renderLoaded();

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
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-confirm-input')).toBeInTheDocument());
    // Type-to-confirm unlocks the button
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
    // Hook-level cross-invalidation (['locations'] + ['records']) is covered by
    // useLocationsMutations.test.ts — the mutation is mocked out here, so this
    // test asserts table behavior only: the dry-run fires and the dialog
    // never opens when the delete succeeds.
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
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('loc-1'));
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

  it('calls archiveLocation when "В архив" clicked on an active location', async () => {
    const archiveMutateAsync = vi.fn().mockResolvedValue(createMockLocationResponse({ id: 'loc-1', archived: true }));
    const patchMutateAsync = vi.fn();
    mockUseArchiveLocation.mockReturnValue({ mutateAsync: archiveMutateAsync, isPending: false } as never);
    mockUsePatchLocation.mockReturnValue({ mutateAsync: patchMutateAsync, isPending: false } as never);
    setupEnvelope();
    await renderLoaded();

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
    setupEnvelope();
    await renderLoaded();

    // loc-2 is archived → its dropdown shows "Восстановить"
    fireEvent.click(screen.getAllByLabelText('Действия')[1]);
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(restoreMutateAsync).toHaveBeenCalledWith('loc-2'));
    expect(patchMutateAsync).not.toHaveBeenCalled();
  });

  // ─── Column picker ──────────────────────────────────────────────────────

  it('renders column picker gear button', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(screen.getByLabelText('Настроить колонки')).toBeInTheDocument();
  });

  it('shows default visible columns by default', async () => {
    setupEnvelope();
    await renderLoaded();
    // Default visible: name, capacity, address, location_hint
    // Column headers include sort icon ↕, so use partial matching
    expect(screen.getByText(/Название/)).toBeInTheDocument();
    expect(screen.getByText(/Вместимость/)).toBeInTheDocument();
    expect(screen.getByText(/Адрес/)).toBeInTheDocument();
    expect(screen.getByText(/Подсказка/)).toBeInTheDocument();
  });

  it('hides non-default columns by default', async () => {
    setupEnvelope();
    const { container } = await renderLoaded();
    // Check that column headers for hidden columns are NOT in the table header
    const thead = container.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Описание/);
    expect(thead?.textContent).not.toMatch(/Статус/);
    expect(thead?.textContent).not.toMatch(/Карта/);
    expect(thead?.textContent).not.toMatch(/Создано/);
  });

  it('shows hidden column in table when loaded from localStorage', async () => {
    localStorage.setItem('locations-columns', JSON.stringify(['name', 'description']));
    setupEnvelope();
    renderTable();
    await screen.findByText('Студия на Невском');
    // "Описание" should be visible as a column header (includes sort icon)
    expect(screen.getByText(/Описание/)).toBeInTheDocument();
    // "Вместимость" should NOT be visible (not in localStorage set)
    const thead = document.querySelector('thead');
    expect(thead?.textContent).not.toMatch(/Вместимость/);
  });

  it('toggles column visibility via ColumnPicker', async () => {
    setupEnvelope();
    await renderLoaded();

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
    setupEnvelope();
    await renderLoaded();

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
