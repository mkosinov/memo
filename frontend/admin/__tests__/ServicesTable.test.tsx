import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServiceResponse, DependencyNode, PaginatedResponse } from '@memo/api-client';

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

// ─── Mock @tanstack/react-query ──────────────────────────────────────────
// Only useQueryClient is mocked (invalidate spy shared with the delete flow
// assertions). useQuery/QueryClientProvider stay REAL: the table renders
// inside the real ServicesProvider, and the server-pagination wiring is
// asserted through the getServices spy (MastersTable precedent, #205 Task 7).

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({
      invalidateQueries: mockInvalidateQueries,
    })),
  };
});

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

import { getServices, resolveDeleteService, ApiError } from '@memo/api-client';
import { ServicesTable } from '../app/(main)/services/components/ServicesTable';
import { ServicesProvider } from '@/contexts/ServicesContext';

const mockGetServices = vi.mocked(getServices);
const mockResolveDeleteService = vi.mocked(resolveDeleteService);

// ─── Helpers ───────────────────────────────────────────────────────────────

function setupEnvelope(overrides: Partial<PaginatedResponse<ServiceResponse>> = {}) {
  mockGetServices.mockResolvedValue({
    items: TEST_SERVICES,
    total: TEST_SERVICES.length,
    page: 1,
    per_page: 10,
    ...overrides,
  });
}

/** Real ServicesProvider + real QueryClient; list data flows through the mocked getServices. */
function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ServicesProvider>
        <ServicesTable />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

/** Render and wait for the server page to load. */
async function renderLoaded() {
  const view = renderTable();
  await screen.findByText('Картина маслом');
  return view;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ServicesTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders service titles', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    expect(screen.getByText('Картина акрилом')).toBeInTheDocument();
    expect(screen.getByText('Ручная лепка')).toBeInTheDocument();
  });

  it('renders duration formatted as minutes', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('150 мин')).toBeInTheDocument();
    expect(screen.getByText('120 мин')).toBeInTheDocument();
  });

  it('renders age range', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('12–18')).toBeInTheDocument();
    expect(screen.getByText('6–14')).toBeInTheDocument();
  });

  it('renders tariff count and min price', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('2 тарифа')).toBeInTheDocument();
    expect(screen.getByText('от 2 500₽')).toBeInTheDocument();
    expect(screen.getByText('1 тариф')).toBeInTheDocument();
  });

  it('renders material hint', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('Фартук')).toBeInTheDocument();
  });

  it('shows "—" for services without material hint', async () => {
    setupEnvelope();
    await renderLoaded();

    // Картина акрилом and Ручная лепка have material_hint: null — show "—"
    const cells = screen.getAllByText('—');
    expect(cells.length).toBeGreaterThanOrEqual(1);
  });

  it('shows empty state when no services', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();

    expect(await screen.findByText('Нет записей')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    mockGetServices.mockReturnValue(new Promise<PaginatedResponse<ServiceResponse>>(() => {}));
    const { container } = renderTable();

    // B2 cat 4 (#139 §6.8): the shared DataTable replaced the "Загрузка..."
    // div with a 10-row skeleton (visible columns only).
    await waitFor(() => {
      expect(container.querySelectorAll('tbody tr').length).toBe(10);
    });
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Загрузка...')).not.toBeInTheDocument();
  });

  it('opens edit modal on row click', async () => {
    setupEnvelope();
    await renderLoaded();

    const row = screen.getByText('Картина маслом').closest('tr')!;
    fireEvent.click(row);
    expect(screen.getByText('Редактировать услугу')).toBeInTheDocument();
  });

  // ─── Server fetch params (#205 §5.2/§5.3) ──────────────────────────────

  it('initial fetch sends page/per_page/status with NO sort params (server default order)', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(mockGetServices).toHaveBeenCalledTimes(1);
    expect(mockGetServices).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'active' });
    // sortBy starts null → sort params omitted → backend default
    // title/id order (server default, no defaultSortBy).
    expect(mockGetServices.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(mockGetServices.mock.calls[0][0]).not.toHaveProperty('sort_order');
  });

  it('status filter change refetches with the new server status param', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });
  });

  it('status filter "Все" refetches with status=all', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'all' });
    });
  });

  it('resets status filter to active when reset button clicked', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });

    fireEvent.click(screen.getByText('Сбросить'));

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'active' });
    });
    expect(screen.getByLabelText('Фильтр по статусу')).toHaveValue('active');
  });

  // ─── Search (G1b Q1 — KEPT: client-side filter over the loaded page) ───

  it('filters the loaded page by search text (client-side)', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию');
    fireEvent.change(searchInput, { target: { value: 'масл' } });

    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    expect(screen.queryByText('Картина акрилом')).not.toBeInTheDocument();
    expect(screen.queryByText('Ручная лепка')).not.toBeInTheDocument();
  });

  it('resets search filter when reset button clicked', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию');
    fireEvent.change(searchInput, { target: { value: 'масл' } });

    expect(screen.queryByText('Картина акрилом')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Сбросить'));

    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    expect(screen.getByText('Картина акрилом')).toBeInTheDocument();
    expect(screen.getByText('Ручная лепка')).toBeInTheDocument();
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
      expect(mockGetServices).toHaveBeenCalledWith({ page: 2, per_page: 10, status: 'active' });
    });
  });

  it('page-size select refetches page 1 with the new per_page', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '20' } });

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({ page: 1, per_page: 20, status: 'active' });
    });
  });

  it('first header click sorts asc, second click toggles desc (server sort)', async () => {
    setupEnvelope();
    await renderLoaded();

    const titleHeader = screen.getByText(/Название/);
    // No sort picked yet → neutral indicator
    expect(titleHeader.textContent).toContain('↕');

    fireEvent.click(titleHeader);
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'title',
        sort_order: 'asc',
      });
    });
    expect(screen.getByText(/Название/).textContent).toContain('↑');

    fireEvent.click(titleHeader);
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'title',
        sort_order: 'desc',
      });
    });
    expect(screen.getByText(/Название/).textContent).toContain('↓');
  });

  // `age` and `tariffs` are UI sort keys — the table sends them as-is; the
  // backend whitelist (#205 Task 3) maps age→min_age and tariffs→count
  // subquery. Never rename/mapping happens client-side.

  it('age header click sends sort_by=age (backend maps to min_age)', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getByText(/Возраст/));

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'age',
        sort_order: 'asc',
      });
    });
  });

  it('tariffs header click sends sort_by=tariffs (backend maps to count subquery)', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getByText(/Тарифы/));

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'tariffs',
        sort_order: 'asc',
      });
    });
  });

  it('sort change resets pager to page 1', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    // Go to page 2 first, then sort — server refetch must reset to page 1.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({ page: 2, per_page: 10, status: 'active' });
    });

    fireEvent.click(screen.getByText(/Название/));

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'title',
        sort_order: 'asc',
      });
    });
  });

  // ─── Tag header: NOT sortable (#205 Task 3 — backend whitelist has no
  // `tags` mapping; §6.2 sortable:false, key passes through nowhere)

  it('tags header is not sortable — no glyph, no sort control, no pointer cursor', async () => {
    setupEnvelope();
    await renderLoaded();

    // Column hidden by default → enable it via the picker (#139: DataTable
    // owns visibility under services-columns; picker renders every column).
    fireEvent.click(screen.getByLabelText('Настроить колонки'));
    fireEvent.click(screen.getByLabelText('Теги'));
    // Close the picker popover (outside mousedown) so "Теги" resolves to the
    // header cell only, not the picker's checkbox label.
    fireEvent.mouseDown(document.body);

    const tagsHeader = screen.getByText(/^Теги\s*[↕↑↓]?$/);
    expect(tagsHeader.textContent).not.toMatch(/[↕↑↓]/);
    const th = tagsHeader.closest('th')!;
    expect(th.querySelector('button')).toBeNull();
    // Pre-#139 every th carried `cursor-pointer` unconditionally; the generic
    // DataTable drops it on non-sortable headers.
    expect(th.className).not.toContain('cursor-pointer');
  });

  // ─── Column visibility persistence (#139 B2 cat 2 — services-columns) ──

  it('loads persisted column visibility from services-columns (B2 cat 2)', async () => {
    localStorage.setItem('services-columns', JSON.stringify(['tariffs']));
    setupEnvelope();
    renderTable();
    // Wait anchor: a cell of the ONE visible column (titles are hidden by the
    // persisted set, so findByText('Картина маслом') can't serve).
    await screen.findByText('2 тарифа');

    // Only the persisted `tariffs` column renders — the default set is NOT used.
    const thead = document.querySelector('thead');
    expect(thead?.textContent).toMatch(/Тарифы/);
    expect(thead?.textContent).not.toMatch(/Название/);
    expect(thead?.textContent).not.toMatch(/Длительность/);
  });

  // ─── Chrome ─────────────────────────────────────────────────────────────

  it('renders "Добавить услугу" button', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(screen.getByText('+ Добавить услугу')).toBeInTheDocument();
  });

  it('opens create modal when "Добавить услугу" clicked', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить услугу'));
    expect(screen.getByText('Новая услуга')).toBeInTheDocument();
  });

  it('opens create modal with empty title field', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить услугу'));
    // Modal should be open with the "Новая услуга" title
    expect(screen.getByText('Новая услуга')).toBeInTheDocument();
    // The title input should be empty
    const titleInput = screen.getByPlaceholderText('Мастер-класс по рисованию');
    expect(titleInput).toHaveValue('');
  });

  // ─── Delete functionality ────────────────────────────────────────────

  it('shows "Удалить" option in action dropdown', async () => {
    setupEnvelope();
    await renderLoaded();
    const actionButtons = screen.getAllByLabelText(/Действия/);
    fireEvent.click(actionButtons[0]);
    expect(screen.getByText('Удалить')).toBeInTheDocument();
  });

  it('calls deleteService dry-run when "Удалить" clicked (204 → no dialog)', async () => {
    mockDeleteMutateAsync.mockResolvedValue(undefined);
    mockDeleteDependencies = null;
    setupEnvelope();
    await renderLoaded();

    const actionButtons = screen.getAllByLabelText(/Действия/);
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
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    expect(screen.getByTestId('delete-dialog-block-message').textContent).toContain('3 активности');
    expect(screen.queryByTestId('delete-dialog-confirm-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument();
  });

  it('Mode B "Архивировать" calls archiveService and closes the dialog', async () => {
    setupDeleteConflict(DEPS_BLOCKED);
    mockArchiveMutateAsync.mockResolvedValue({});
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-archive-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-archive-btn'));

    await waitFor(() => expect(mockArchiveMutateAsync).toHaveBeenCalledWith('svc-1'));
    await waitFor(() => expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument());
  });

  it('Mode A confirm calls resolveDeleteService with {} (all deps auto) and closes', async () => {
    setupDeleteConflict(DEPS_AUTO);
    mockResolveDeleteService.mockResolvedValue(undefined);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
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
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-cancel-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-cancel-btn'));

    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    expect(mockDeleteMutateAsync).toHaveBeenCalledTimes(1);
  });

  // ─── Archive / Restore (#207 §7.2, replaces patchX({is_active})) ────────

  it('calls archiveService when "В архив" clicked on an active service', async () => {
    mockArchiveMutateAsync.mockResolvedValue({});
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText(/Действия/)[0]);
    fireEvent.click(screen.getByText('В архив'));

    await waitFor(() => expect(mockArchiveMutateAsync).toHaveBeenCalledWith('svc-1'));
    expect(mockPatchMutateAsync).not.toHaveBeenCalled();
  });

  it('calls restoreService when "Восстановить" clicked on an archived service', async () => {
    setupEnvelope();
    await renderLoaded();

    // svc-3 (archived, "Ручная лепка") is row index 2 in TEST_SERVICES order
    // — the server returns the full envelope as-is; no client filtering.
    fireEvent.click(screen.getAllByLabelText(/Действия/)[2]);
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(mockRestoreMutateAsync).toHaveBeenCalledWith('svc-3'));
    expect(mockPatchMutateAsync).not.toHaveBeenCalled();
  });

  // ─── Edit does not resurrect archived services (GH #195 via #207) ────────

  it('edit submit on archived service sends no archive flag (GH #195/#207)', async () => {
    setupEnvelope();
    await renderLoaded();

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
