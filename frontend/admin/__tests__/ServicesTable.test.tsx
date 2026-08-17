import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { ServiceResponse, DependencyNode } from '@memo/api-client';

// ─── Dependency tree fixtures (mirror backend src/domain/deletion.py) ─────

// Service with activities → delete blocked → Mode B (archive only).
const DEPS_BLOCKED: DependencyNode[] = [
  {
    entity: 'activities',
    relation: 'Активность',
    count: 3,
    allowed_actions: [],
    message: 'Удалите активности вручную или архивируйте',
  },
  { entity: 'service_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
];

// Service with only auto deps (tariffs + tags) → Mode A, resolutions body {}.
const DEPS_AUTO: DependencyNode[] = [
  { entity: 'tariffs', relation: 'Тариф', count: 3, allowed_actions: ['cascade'], message: null },
  { entity: 'service_tags', relation: 'Тег', count: 2, allowed_actions: ['cascade'], message: null },
];

// ─── Mock data ──────────────────────────────────────────────────────────────

const mockService1: ServiceResponse = {
  id: 'svc-1',
  title: 'Картина маслом',
  description: 'Мастер-класс по рисованию маслом',
  image_url: '',
  specialty: 'Живопись',
  min_age: 12,
  max_age: 18,
  duration: 150,
  record_info: '',
  material_hint: 'Фартук',
  tariffs: [
    { id: 't-1', service_id: 'svc-1', title: 'Взрослый', description: null, price: 3500 },
    { id: 't-2', service_id: 'svc-1', title: 'Детский', description: null, price: 2500 },
  ],
  tags: [{ id: 'tag-1', tag: 'масло' }],
  archived: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockService2: ServiceResponse = {
  id: 'svc-2',
  title: 'Картина акрилом',
  description: 'Акриловая живопись',
  image_url: '',
  specialty: 'Графика',
  min_age: 6,
  max_age: 14,
  duration: 120,
  record_info: '',
  material_hint: null,
  tariffs: [
    { id: 't-3', service_id: 'svc-2', title: 'Взрослый', description: null, price: 2800 },
  ],
  tags: [{ id: 'tag-2', tag: 'акрил' }],
  archived: false,
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

const mockService3: ServiceResponse = {
  id: 'svc-3',
  title: 'Ручная лепка',
  description: 'Лепка из глины',
  image_url: '',
  specialty: 'Керамика',
  min_age: 5,
  max_age: 12,
  duration: 90,
  record_info: '',
  material_hint: null,
  tariffs: [],
  tags: [],
  archived: true,
  created_at: '2024-03-01T00:00:00Z',
  updated_at: '2024-03-01T00:00:00Z',
};

const TEST_SERVICES: ServiceResponse[] = [
  mockService1,
  mockService2,
  mockService3,
];

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Per-hook spies so tests can assert which mutation the table calls
// (#207: delete ≠ patch(is_active) — archive/restore are dedicated hooks).
const mockCreateMutateAsync = vi.fn().mockResolvedValue({});
const mockUpdateMutateAsync = vi.fn().mockResolvedValue({});
const mockPatchMutateAsync = vi.fn().mockResolvedValue({});
const mockDeleteMutateAsync = vi.fn().mockResolvedValue({});
const mockArchiveMutateAsync = vi.fn().mockResolvedValue({});
const mockRestoreMutateAsync = vi.fn().mockResolvedValue({});
// The hook's `dependencies` (409 dry-run tree) — mutable per test; read by the
// factory arrow at render time.
let mockDeleteDependencies: DependencyNode[] | null = null;
const mockShowToast = vi.fn();

// Shared so tests can assert invalidation (#207: ['services'] on dialog done).
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
  // `keepPreviousData` is a sentinel symbol in real react-query; the component
  // imports it for `placeholderData`. Provide a stable sentinel so the import
  // resolves. The mocked `useQuery` ignores `placeholderData` anyway.
  keepPreviousData: Symbol('keepPreviousData'),
  useMutation: vi.fn(() => ({
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
  useQueryClient: vi.fn(() => ({
    invalidateQueries: mockInvalidateQueries,
  })),
}));

// Spy on getServices (preserve other api-client exports via importOriginal)
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getServices: vi.fn(), resolveDeleteService: vi.fn() };
});

vi.mock('@/hooks/useServicesMutations', () => ({
  useCreateService: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateService: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  usePatchService: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useDeleteService: () => ({
    mutateAsync: mockDeleteMutateAsync,
    dependencies: mockDeleteDependencies,
    isPending: false,
  }),
  useArchiveService: () => ({ mutateAsync: mockArchiveMutateAsync, isPending: false }),
  useRestoreService: () => ({ mutateAsync: mockRestoreMutateAsync, isPending: false }),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({
    showToast: mockShowToast,
    deleteMode: false,
    toasts: [],
  }),
}));

import { useQuery } from '@tanstack/react-query';
import { getServices, resolveDeleteService, ApiError } from '@memo/api-client';

const mockUseQuery = vi.mocked(useQuery);
const mockGetServices = vi.mocked(getServices);
const mockResolveDeleteService = vi.mocked(resolveDeleteService);

import { ServicesTable } from '../app/(main)/services/components/ServicesTable';

// ─── Helpers ───────────────────────────────────────────────────────────────

// Simulate the server's archive filtering per `ListParams.status`. The mock
// `useQuery` discards the `queryFn`'s resolved value and returns the injected
// `data` synchronously, so we must inject already-filtered lists matching the
// status the component requested. This mirrors how the real backend responds.
const ACTIVE_SERVICES = TEST_SERVICES.filter((s) => !s.archived);
const ARCHIVED_SERVICES = TEST_SERVICES.filter((s) => s.archived);

function setupQuery(services: ServiceResponse[] = ACTIVE_SERVICES, isLoading = false) {
  // Resolve the getServices spy with the supplied list so the component's
  // `queryFn` (which calls `getServices(...).then(r => r.items)`) settles.
  mockGetServices.mockResolvedValue({
    items: services,
    total: services.length,
    page: 1,
    per_page: 100,
  });
  // Drive `useQuery` through `mockImplementation` so the real `queryFn` is
  // invoked on every render — this is what lets the getServices spy record
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
      data: services,
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
      promise: Promise.resolve({ data: services }),
    };
  }) as unknown) as typeof useQuery);
  return mockGetServices;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ServicesTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupQuery();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders active service titles by default', () => {
    render(<ServicesTable />);
    expect(screen.getByText('Картина маслом')).toBeTruthy();
    expect(screen.getByText('Картина акрилом')).toBeTruthy();
    // Archived service is filtered out server-side (status: 'active' default)
    expect(screen.queryByText('Ручная лепка')).toBeNull();
    // Default server-side filter requests status: 'active' (GH #195)
    expect(mockGetServices).toHaveBeenCalledWith({
      per_page: 100,
      status: 'active',
    });
  });

  it('renders all services when status filter is "all"', () => {
    // Simulate server returning all services (active + archived) for status='all'
    setupQuery(TEST_SERVICES);
    render(<ServicesTable />);
    const statusSelect = screen.getByLabelText(/Фильтр по статусу/);
    fireEvent.change(statusSelect, { target: { value: 'all' } });
    expect(screen.getByText('Картина маслом')).toBeTruthy();
    expect(screen.getByText('Картина акрилом')).toBeTruthy();
    expect(screen.getByText('Ручная лепка')).toBeTruthy();
    expect(mockGetServices).toHaveBeenCalledWith({
      per_page: 100,
      status: 'all',
    });
  });

  it('renders duration formatted as minutes', () => {
    render(<ServicesTable />);
    expect(screen.getByText('150 мин')).toBeTruthy();
    expect(screen.getByText('120 мин')).toBeTruthy();
  });

  it('renders age range', () => {
    render(<ServicesTable />);
    expect(screen.getByText('12–18')).toBeTruthy();
    expect(screen.getByText('6–14')).toBeTruthy();
  });

  it('renders tariff count and min price', () => {
    render(<ServicesTable />);
    expect(screen.getByText('2 тарифа')).toBeTruthy();
    expect(screen.getByText('от 2 500₽')).toBeTruthy();
    expect(screen.getByText('1 тариф')).toBeTruthy();
  });

  it('renders material hint', () => {
    render(<ServicesTable />);
    expect(screen.getByText('Фартук')).toBeTruthy();
  });

  it('shows "—" for services without material hint', () => {
    render(<ServicesTable />);
    // Картина акрилом has material_hint: null — shows "—"
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it('sorts by title when clicking header (asc)', () => {
    render(<ServicesTable />);
    const titleHeader = screen.getByText(/Название/);
    fireEvent.click(titleHeader);
    // Ascending: Картина акрилом before Картина маслом
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Картина акрилом')).toBeTruthy();
    expect(within(rows[2]).getByText('Картина маслом')).toBeTruthy();
  });

  it('sorts by title when clicking header (desc)', () => {
    render(<ServicesTable />);
    const titleHeader = screen.getByText(/Название/);
    // Click twice: asc → desc
    fireEvent.click(titleHeader);
    fireEvent.click(titleHeader);
    // Descending: Картина маслом before Картина акрилом
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('Картина маслом')).toBeTruthy();
    expect(within(rows[2]).getByText('Картина акрилом')).toBeTruthy();
  });

  it('filters by search text', () => {
    render(<ServicesTable />);
    const searchInput = screen.getByLabelText(/Поиск по названию/);
    fireEvent.change(searchInput, { target: { value: 'масл' } });
    expect(screen.getByText('Картина маслом')).toBeTruthy();
    expect(screen.queryByText('Картина акрилом')).toBeNull();
  });

  it('filters by status (archived)', () => {
    // Simulate server returning only archived services for status='archived'
    setupQuery(ARCHIVED_SERVICES);
    render(<ServicesTable />);
    const statusSelect = screen.getByLabelText(/Фильтр по статусу/);
    // Switch to archived — request now carries status: 'archived' (GH #195)
    fireEvent.change(statusSelect, { target: { value: 'archived' } });
    expect(screen.getByText('Ручная лепка')).toBeTruthy();
    expect(mockGetServices).toHaveBeenCalledWith({
      per_page: 100,
      status: 'archived',
    });
  });

  it('shows empty state when no services match', () => {
    setupQuery([]);
    render(<ServicesTable />);
    expect(screen.getByText('Услуги не найдены')).toBeTruthy();
  });

  it('opens edit modal on row click', () => {
    render(<ServicesTable />);
    const row = screen.getByText('Картина маслом').closest('tr')!;
    fireEvent.click(row);
    expect(screen.getByText('Редактировать услугу')).toBeTruthy();
  });

  // ─── Create functionality ────────────────────────────────────────────

  it('renders "Добавить услугу" button', () => {
    render(<ServicesTable />);
    expect(screen.getByText('+ Добавить услугу')).toBeTruthy();
  });

  it('opens create modal when "Добавить услугу" clicked', () => {
    render(<ServicesTable />);
    const addBtn = screen.getByText('+ Добавить услугу');
    fireEvent.click(addBtn);
    expect(screen.getByText('Новая услуга')).toBeTruthy();
  });

  it('opens create modal with empty title field', () => {
    render(<ServicesTable />);
    fireEvent.click(screen.getByText('+ Добавить услугу'));
    // Modal should be open with the "Новая услуга" title
    expect(screen.getByText('Новая услуга')).toBeTruthy();
    // The title input should be empty
    const titleInput = screen.getByPlaceholderText('Мастер-класс по рисованию');
    expect(titleInput).toHaveValue('');
  });

  // ─── Delete functionality ────────────────────────────────────────────

  it('shows "Удалить" option in action dropdown', () => {
    render(<ServicesTable />);
    // Open action menu for first service
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    expect(screen.getByText('Удалить')).toBeTruthy();
  });

  it('calls deleteService dry-run when "Удалить" clicked (204 → no dialog)', async () => {
    mockDeleteMutateAsync.mockResolvedValue(undefined);
    mockDeleteDependencies = null;
    render(<ServicesTable />);
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    fireEvent.click(screen.getByText('Удалить'));
    await waitFor(() => expect(mockDeleteMutateAsync).toHaveBeenCalledWith('svc-1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });

  // ─── Delete → DeleteDialog flow (#207 §7) ──────────────────────────────

  /** Dry-run rejects with a 409 carrying the given tree; hook exposes it. */
  function setupDeleteConflict(deps: DependencyNode[]) {
    mockDeleteDependencies = deps;
    mockDeleteMutateAsync.mockRejectedValue(
      new ApiError(409, 'Удаление невозможно', 'CONFLICT', deps),
    );
  }

  it('opens DeleteDialog in Mode B when delete conflicts with activities', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    render(<ServicesTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-block-message').textContent).toContain('3 активности');
    expect(screen.queryByTestId('delete-dialog-confirm-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument();
  });

  it('Mode B "Архивировать" calls archiveService and closes the dialog', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    mockArchiveMutateAsync.mockResolvedValue({});
    render(<ServicesTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-archive-btn'));

    await waitFor(() => expect(mockArchiveMutateAsync).toHaveBeenCalledWith('svc-1'));
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('Mode A confirm calls resolveDeleteService with {} (all deps auto) and closes', async () => {
    setupDeleteConflict(DEPS_AUTO);
    mockResolveDeleteService.mockResolvedValue(undefined);
    render(<ServicesTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-confirm-input')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('delete-dialog-confirm-input'), {
      target: { value: 'Картина маслом' },
    });
    fireEvent.click(screen.getByTestId('delete-dialog-confirm-btn'));

    await waitFor(() => expect(mockResolveDeleteService).toHaveBeenCalledWith('svc-1', {}));
    await waitFor(() =>
      expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['services'] }),
    );
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('cancel closes the dialog without executing a delete', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    render(<ServicesTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-cancel-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-cancel-btn'));

    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    expect(mockDeleteMutateAsync).toHaveBeenCalledTimes(1);
  });

  // ─── Archive / Restore (#207 §7.2, replaces patchX({is_active})) ────────

  it('calls archiveService when "В архив" clicked on an active service', async () => {
    mockArchiveMutateAsync.mockResolvedValue({});
    render(<ServicesTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('В архив'));

    await waitFor(() => expect(mockArchiveMutateAsync).toHaveBeenCalledWith('svc-1'));
    expect(mockPatchMutateAsync).not.toHaveBeenCalled();
  });

  it('calls restoreService when "Восстановить" clicked on an archived service', async () => {
    // Switch to "all" so the archived mockService3 ("Ручная лепка", id=svc-3) renders.
    setupQuery(TEST_SERVICES);
    render(<ServicesTable />);
    fireEvent.change(screen.getByLabelText(/Фильтр по статусу/), {
      target: { value: 'all' },
    });

    mockRestoreMutateAsync.mockResolvedValue({});
    fireEvent.click(screen.getAllByLabelText('Действия')[2]); // svc-3 row
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(mockRestoreMutateAsync).toHaveBeenCalledWith('svc-3'));
    expect(mockPatchMutateAsync).not.toHaveBeenCalled();
  });

  // ─── Edit does not resurrect archived services (GH #195 via #207) ────────

  it('edit submit on archived service sends no archive flag (GH #195/#207)', async () => {
    // Switch to "all" so the archived mockService3 ("Ручная лепка", id=svc-3)
    // is rendered by the table.
    setupQuery(TEST_SERVICES);
    render(<ServicesTable />);
    fireEvent.change(screen.getByLabelText(/Фильтр по статусу/), {
      target: { value: 'all' },
    });

    const archivedRow = screen.getByText('Ручная лепка').closest('tr')!;
    fireEvent.click(archivedRow);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    // #207 inverted the schema: Update bodies carry no archive flag at all
    // (archive/restore goes through POST endpoints), so editing an archived
    // service can no longer resurrect it. The payload must carry no flag.
    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    // Find the call shaped like an update ({id, data}) for the archived row.
    const updateCall = mockUpdateMutateAsync.mock.calls.find(
      ([arg]) =>
        typeof arg === 'object' &&
        arg !== null &&
        arg.id === 'svc-3' &&
        typeof arg.data === 'object',
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![0].data.is_active).toBeUndefined();
  });
});