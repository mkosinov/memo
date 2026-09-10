import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ServiceResponse, DependencyNode, PaginatedResponse, MaterialResponse } from '@memo/api-client';

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
  tariffs: [
    { id: 't-1', service_id: 'svc-1', title: 'Взрослый', description: null, price: 3500 },
    { id: 't-2', service_id: 'svc-1', title: 'Детский', description: null, price: 2500 },
  ],
  tags: [{ id: 'tag-1', tag: 'масло' }],
  materials: [],
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
  tariffs: [
    { id: 't-3', service_id: 'svc-2', title: 'Взрослый', description: null, price: 2800 },
  ],
  tags: [{ id: 'tag-2', tag: 'акрил' }],
  materials: [],
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
  tariffs: [],
  tags: [],
  materials: [],
  archived: true,
  created_at: '2024-03-01T00:00:00Z',
  updated_at: '2024-03-01T00:00:00Z',
};

const TEST_SERVICES: ServiceResponse[] = [
  mockService1,
  mockService2,
  mockService3,
];

// #223 T5: active materials for the ServiceModal picker (/all?status=active).
const MOCK_MATERIALS: MaterialResponse[] = [
  { id: 'mat-a', title: 'Акварель', description: 'Акварельные краски', archived: false, used_in_services_count: 0, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
  { id: 'mat-k', title: 'Керамика', description: 'Глина', archived: false, used_in_services_count: 0, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z' },
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
  return {
    ...actual,
    getServices: vi.fn(),
    resolveDeleteService: vi.fn(),
    // #223 T5: ServiceModal's materials picker fetches /all?status=active
    getAllMaterials: vi.fn(),
  };
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

import { getServices, resolveDeleteService, getAllMaterials, ApiError } from '@memo/api-client';
import { ServicesTable } from '../app/(main)/services/components/ServicesTable';
import { ServicesProvider } from '@/contexts/ServicesContext';

const mockGetServices = vi.mocked(getServices);
const mockResolveDeleteService = vi.mocked(resolveDeleteService);
const mockGetAllMaterials = vi.mocked(getAllMaterials);

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
    mockGetAllMaterials.mockResolvedValue(MOCK_MATERIALS);
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

  it('renders material badges ("—" for services without materials)', async () => {
    setupEnvelope();
    await renderLoaded();

    // GH #223 Task 13: material_hint column is retired; the badges column
    // renders "—" for the unlinked services (Картина акрилом, Ручная лепка).
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

  // ─── Search (GH #212 T11 — server-side via ?q=; #205 degradation ends) ──
  // The *Filters bar calls setSearch directly (no debounce); the factory
  // clamps q to ≥2 chars and sends it to getServices. Rows render exactly
  // what the server returned — no client filtering (#139 predicate removed).

  it('searches server-side via ?q= (fetch carries q, rows stay server-returned)', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию');
    fireEvent.change(searchInput, { target: { value: 'масл' } });

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith(expect.objectContaining({ q: 'масл' }));
    });
    // No client filtering — setupEnvelope's items stay visible regardless of match
    expect(screen.getByText('Картина маслом')).toBeInTheDocument();
    expect(screen.getByText('Картина акрилом')).toBeInTheDocument();
    expect(screen.getByText('Ручная лепка')).toBeInTheDocument();
  });

  it('resets search and refetches without q', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию');
    fireEvent.change(searchInput, { target: { value: 'масл' } });
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenCalledWith(expect.objectContaining({ q: 'масл' }));
    });

    fireEvent.click(screen.getByText('Сбросить'));

    await waitFor(() => {
      // Deep equality — no q key on the post-reset fetch
      expect(mockGetServices).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'active' });
    });
    expect(searchInput).toHaveValue('');
  });

  it('does not fire q on 1 char (≥2 clamp — treated as unset)', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию');
    fireEvent.change(searchInput, { target: { value: 'м' } });

    // Raw input state reflects the char, but no q fetch fires
    await waitFor(() => {
      expect(searchInput).toHaveValue('м');
    });
    expect(mockGetServices).toHaveBeenCalledTimes(1);
    expect(mockGetServices.mock.calls[0][0]).not.toHaveProperty('q');
  });

  // ─── Material filter (GH #223 T7 — S2, spec §8) ─────────────────────────
  // A select «Материал: все | <title>…» in the *Filters bar (source:
  // getAllMaterials active list); the pick feeds `material_id` into the
  // server-paginated query via ServicesContext; «все» = param omitted.

  it('material filter select renders «все» + active material options', async () => {
    setupEnvelope();
    await renderLoaded();

    const select = screen.getByLabelText('Фильтр по материалу');
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'Акварель' })).toBeInTheDocument();
    });
    expect(within(select).getByRole('option', { name: 'Керамика' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'все' })).toBeInTheDocument();
    expect(select).toHaveValue('');
  });

  it('picking a material refetches with material_id and resets page to 1', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    // Go to page 2 first — the filter change must restart at page 1
    // (same reset contract as status/sort/perPage/q).
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({ page: 2, per_page: 10, status: 'active' });
    });

    const select = screen.getByLabelText('Фильтр по материалу');
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'Акварель' })).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: 'mat-a' } });

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        material_id: 'mat-a',
      });
    });
  });

  it('«все» omits material_id from the fetch (deep equality — no key)', async () => {
    setupEnvelope();
    await renderLoaded();

    const select = screen.getByLabelText('Фильтр по материалу');
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'Акварель' })).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: 'mat-a' } });
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        material_id: 'mat-a',
      });
    });

    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'active' });
    });
    expect(mockGetServices.mock.calls.at(-1)![0]).not.toHaveProperty('material_id');
  });

  it('material filter composes with the status filter', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });

    const select = screen.getByLabelText('Фильтр по материалу');
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'Акварель' })).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: 'mat-k' } });

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({
        page: 1,
        per_page: 10,
        status: 'archived',
        material_id: 'mat-k',
      });
    });
  });

  it('keeps the selected material visible when the options refetch without it (SSE archive, GH #239)', async () => {
    // #239: any mutation echoes an SSE frame that invalidates ['materials'];
    // useMaterialsRaw refetches the ACTIVE list and the selected material may
    // drop out (archived externally). The applied filter (context state) must
    // stay AND the select must keep displaying the selection — not silently
    // fall back to «все» while the list is still filtered.
    setupEnvelope();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <ServicesProvider>
          <ServicesTable />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    await screen.findByText('Картина маслом');

    const select = screen.getByLabelText('Фильтр по материалу');
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'Акварель' })).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: 'mat-a' } });
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith(
        expect.objectContaining({ material_id: 'mat-a' }),
      );
    });

    // The materials dict refetches WITHOUT mat-a (archived elsewhere); the
    // SSE-driven invalidateQueries on the ['materials'] family triggers it.
    mockGetAllMaterials.mockResolvedValue([MOCK_MATERIALS[1]]);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
    });

    // The applied filter is untouched (query keeps material_id) and the select
    // still DISPLAYS the selection instead of falling back to «все».
    expect(mockGetServices).toHaveBeenLastCalledWith(
      expect.objectContaining({ material_id: 'mat-a' }),
    );
    expect(select).toHaveValue('mat-a');
  });

  it('reset button clears the material filter too', async () => {
    setupEnvelope();
    await renderLoaded();

    const select = screen.getByLabelText('Фильтр по материалу');
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'Акварель' })).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: 'mat-k' } });
    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith(
        expect.objectContaining({ material_id: 'mat-k' }),
      );
    });

    fireEvent.click(screen.getByText('Сбросить'));

    await waitFor(() => {
      expect(mockGetServices).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'active' });
    });
    expect(screen.getByLabelText('Фильтр по материалу')).toHaveValue('');
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

    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
    // All deps auto — no confirm checkbox, button enabled immediately
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

  // ─── Materials multi-select with notes (GH #223 T5) ────────────────────
  // The ServiceModal renders a checkbox multi-list of ACTIVE materials
  // (getAllMaterials → /all?status=active) with a one-line note input under
  // each checked item. Form state `materials: {material_id, note?}[]` maps
  // both ways against `service.materials` (read shape {id,title,note}).

  /** Service with prefilled material links (read shape, spec §5). */
  const svcWithMaterials: ServiceResponse = {
    ...mockService1,
    materials: [
      { id: 'mat-a', title: 'Акварель', description: 'Акварельные краски', note: 'бумага 300 г' },
      { id: 'mat-k', title: 'Керамика', description: 'Глина', note: null },
    ],
  };

  /** Open the edit modal for a service by title (row click). */
  async function openEditModal(title: string) {
    fireEvent.click(screen.getByText(title).closest('tr')!);
    await screen.findByRole('dialog');
    // Wait for the materials picker options (async dictionary fetch).
    await screen.findByRole('checkbox', { name: 'Акварель' });
  }

  /** The PUT payload of the update call for a given service id. */
  function updatePayloadFor(id: string): Record<string, unknown> {
    const call = mockUpdateMutateAsync.mock.calls.find(
      ([arg]) => typeof arg === 'object' && arg !== null && arg.id === id,
    );
    expect(call).toBeDefined();
    return call![0].data as Record<string, unknown>;
  }

  it('edit modal offers active materials from getAllMaterials({status:"active"}) and has no material_hint field', async () => {
    setupEnvelope();
    await renderLoaded();
    await openEditModal('Картина маслом');

    expect(mockGetAllMaterials).toHaveBeenCalledWith({ status: 'active' });
    expect(screen.getByRole('checkbox', { name: 'Акварель' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Керамика' })).toBeInTheDocument();
    // material_hint text field is REMOVED from the form (spec §8) and the
    // field is retired everywhere (Task 13, spec §10).
    expect(screen.queryByPlaceholderText('Что взять с собой')).not.toBeInTheDocument();
  });

  it('checking two materials + one note → PUT payload contains materials links', async () => {
    setupEnvelope();
    await renderLoaded();
    await openEditModal('Картина маслом');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Акварель' }));
    fireEvent.change(screen.getByLabelText('Заметка: Акварель'), {
      target: { value: 'бумага 300 г' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Керамика' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    const payload = updatePayloadFor('svc-1');
    // Empty notes are omitted (note is optional on the link); picker order.
    expect(payload.materials).toEqual([
      { material_id: 'mat-a', note: 'бумага 300 г' },
      { material_id: 'mat-k' },
    ]);
  });

  it('edit prefills checked materials and their notes from service.materials', async () => {
    setupEnvelope({ items: [svcWithMaterials], total: 1 });
    await renderLoaded();
    await openEditModal('Картина маслом');

    expect(screen.getByRole('checkbox', { name: 'Акварель' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Керамика' })).toBeChecked();
    expect(screen.getByLabelText('Заметка: Акварель')).toHaveValue('бумага 300 г');
    // null note → empty input (still rendered under the checked item)
    expect(screen.getByLabelText('Заметка: Керамика')).toHaveValue('');
  });

  it('unchecking a material removes it from the PUT payload', async () => {
    setupEnvelope({ items: [svcWithMaterials], total: 1 });
    await renderLoaded();
    await openEditModal('Картина маслом');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Керамика' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    expect(updatePayloadFor('svc-1').materials).toEqual([
      { material_id: 'mat-a', note: 'бумага 300 г' },
    ]);
  });

  it('saving without touching materials keeps the prefilled links in the payload', async () => {
    setupEnvelope({ items: [svcWithMaterials], total: 1 });
    await renderLoaded();
    await openEditModal('Картина маслом');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    expect(updatePayloadFor('svc-1').materials).toEqual([
      { material_id: 'mat-a', note: 'бумага 300 г' },
      { material_id: 'mat-k' },
    ]);
  });

  it('note input keeps raw whitespace (server normalizes; UI does not trim)', async () => {
    setupEnvelope();
    await renderLoaded();
    await openEditModal('Картина маслом');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Акварель' }));
    fireEvent.change(screen.getByLabelText('Заметка: Акварель'), {
      target: { value: '  бумага  ' },
    });
    expect(screen.getByLabelText('Заметка: Акварель')).toHaveValue('  бумага  ');

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    expect(updatePayloadFor('svc-1').materials).toEqual([
      { material_id: 'mat-a', note: '  бумага  ' },
    ]);
  });

  it('create modal: checked materials land in the create payload', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getByText('+ Добавить услугу'));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByPlaceholderText('Мастер-класс по рисованию'), {
      target: { value: 'Новая услуга' },
    });
    fireEvent.change(screen.getByLabelText(/Длительность/), { target: { value: '90' } });
    await screen.findByRole('checkbox', { name: 'Акварель' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Акварель' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    await waitFor(() => expect(mockCreateMutateAsync).toHaveBeenCalled());
    const data = mockCreateMutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(data.materials).toEqual([{ material_id: 'mat-a' }]);
  });
});
