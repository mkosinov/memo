import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MaterialResponse, DependencyNode, PaginatedResponse } from '@memo/api-client';

// ─── Mock data ──────────────────────────────────────────────────────────────

const mockMaterial1: MaterialResponse = {
  id: 'mat-1',
  title: 'Фартук',
  description: 'Защитная одежда',
  archived: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockMaterial2: MaterialResponse = {
  id: 'mat-2',
  title: 'Кисти',
  description: 'Набор кистей',
  archived: false,
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

const mockMaterial3: MaterialResponse = {
  id: 'mat-3',
  title: 'Старые краски',
  description: 'Архивный набор',
  archived: true,
  created_at: '2024-03-01T00:00:00Z',
  updated_at: '2024-03-01T00:00:00Z',
};

const TEST_MATERIALS: MaterialResponse[] = [
  mockMaterial1,
  mockMaterial2,
  mockMaterial3,
];

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Per-hook spies so tests can assert which mutation the table calls
// (#207: delete ≠ patch(is_active) — archive/restore are dedicated hooks).
// Shared consts read by the hoisted factory arrows at render time.
const mockCreateMutateAsync = vi.fn().mockResolvedValue({});
const mockUpdateMutateAsync = vi.fn().mockResolvedValue({});
const mockPatchMutateAsync = vi.fn().mockResolvedValue({});
const mockDeleteMutateAsync = vi.fn().mockResolvedValue({});
const mockArchiveMutateAsync = vi.fn().mockResolvedValue({});
const mockRestoreMutateAsync = vi.fn().mockResolvedValue({});
// The hook's `dependencies` (409 dry-run tree) — mutable per test; read by the
// factory arrow at render time.
let mockDeleteDependencies: DependencyNode[] | null = null;

// Shared so tests can assert invalidation (#207: ['materials'] on dialog done).
const mockInvalidateQueries = vi.fn().mockResolvedValue(undefined);

// ─── Mock @tanstack/react-query ──────────────────────────────────────────
// Only useQueryClient is mocked (invalidate spy shared with the delete flow
// assertions). useQuery/QueryClientProvider stay REAL: the table renders
// inside the real MaterialsProvider, and the server-pagination wiring is
// asserted through the getMaterials spy (MastersTable precedent, #205 Task 7).

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: vi.fn(() => ({
      invalidateQueries: mockInvalidateQueries,
    })),
  };
});

// Spy on getMaterials (preserve other api-client exports via importOriginal)
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getMaterials: vi.fn(), resolveDeleteMaterial: vi.fn() };
});

vi.mock('@/hooks/useMaterialsMutations', () => ({
  useCreateMaterial: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useUpdateMaterial: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  usePatchMaterial: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useDeleteMaterial: () => ({
    mutateAsync: mockDeleteMutateAsync,
    dependencies: mockDeleteDependencies,
    isPending: false,
  }),
  useArchiveMaterial: () => ({ mutateAsync: mockArchiveMutateAsync, isPending: false }),
  useRestoreMaterial: () => ({ mutateAsync: mockRestoreMutateAsync, isPending: false }),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({
    showToast: vi.fn(),
    deleteMode: false,
    toasts: [],
  }),
}));

import { getMaterials, ApiError } from '@memo/api-client';
import { MaterialsTable } from '../app/(main)/services/components/MaterialsTable';
import { MaterialsProvider } from '@/contexts/MaterialsContext';

const mockGetMaterials = vi.mocked(getMaterials);

// ─── Helpers ───────────────────────────────────────────────────────────────

function setupEnvelope(overrides: Partial<PaginatedResponse<MaterialResponse>> = {}) {
  mockGetMaterials.mockResolvedValue({
    items: TEST_MATERIALS,
    total: TEST_MATERIALS.length,
    page: 1,
    per_page: 10,
    ...overrides,
  });
}

/** Real MaterialsProvider + real QueryClient; list data flows through the mocked getMaterials. */
function renderTable() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MaterialsProvider>
        <MaterialsTable />
      </MaterialsProvider>
    </QueryClientProvider>,
  );
}

/** Render and wait for the server page to load. */
async function renderLoaded() {
  const view = renderTable();
  await screen.findByText('Фартук');
  return view;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MaterialsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders material titles', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('Фартук')).toBeInTheDocument();
    expect(screen.getByText('Кисти')).toBeInTheDocument();
    expect(screen.getByText('Старые краски')).toBeInTheDocument();
  });

  it('renders material descriptions', async () => {
    setupEnvelope();
    await renderLoaded();

    expect(screen.getByText('Защитная одежда')).toBeInTheDocument();
    expect(screen.getByText('Набор кистей')).toBeInTheDocument();
  });

  it('shows empty state when no materials', async () => {
    setupEnvelope({ items: [], total: 0 });
    renderTable();

    expect(await screen.findByText('Материалы не найдены')).toBeInTheDocument();
  });

  it('shows loading state', async () => {
    mockGetMaterials.mockReturnValue(new Promise<PaginatedResponse<MaterialResponse>>(() => {}));
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

    expect(mockGetMaterials).toHaveBeenCalledTimes(1);
    expect(mockGetMaterials).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'active' });
    // sortBy starts null → sort params omitted → backend default
    // title/id order (server default, no defaultSortBy).
    expect(mockGetMaterials.mock.calls[0][0]).not.toHaveProperty('sort_by');
    expect(mockGetMaterials.mock.calls[0][0]).not.toHaveProperty('sort_order');
  });

  it('status filter change refetches with the new server status param', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });

    await waitFor(() => {
      expect(mockGetMaterials).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });
  });

  it('status filter "Все" refetches with status=all', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    await waitFor(() => {
      expect(mockGetMaterials).toHaveBeenCalledWith({ page: 1, per_page: 10, status: 'all' });
    });
  });

  it('resets status filter to active when reset button clicked', async () => {
    setupEnvelope();
    await renderLoaded();

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });
    await waitFor(() => {
      expect(mockGetMaterials).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'archived' });
    });

    fireEvent.click(screen.getByText('Сбросить'));

    await waitFor(() => {
      expect(mockGetMaterials).toHaveBeenLastCalledWith({ page: 1, per_page: 10, status: 'active' });
    });
    expect(screen.getByLabelText('Фильтр по статусу')).toHaveValue('active');
  });

  // ─── Search (G1b Q1 — KEPT: client-side filter over the loaded page) ───

  it('filters the loaded page by search text (client-side)', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию');
    fireEvent.change(searchInput, { target: { value: 'Фарт' } });

    expect(screen.getByText('Фартук')).toBeInTheDocument();
    expect(screen.queryByText('Кисти')).not.toBeInTheDocument();
    expect(screen.queryByText('Старые краски')).not.toBeInTheDocument();
  });

  it('resets search filter when reset button clicked', async () => {
    setupEnvelope();
    await renderLoaded();

    const searchInput = screen.getByLabelText('Поиск по названию');
    fireEvent.change(searchInput, { target: { value: 'Фарт' } });

    expect(screen.queryByText('Кисти')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Сбросить'));

    expect(screen.getByText('Фартук')).toBeInTheDocument();
    expect(screen.getByText('Кисти')).toBeInTheDocument();
    expect(screen.getByText('Старые краски')).toBeInTheDocument();
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
      expect(mockGetMaterials).toHaveBeenCalledWith({ page: 2, per_page: 10, status: 'active' });
    });
  });

  it('page-size select refetches page 1 with the new per_page', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    fireEvent.change(screen.getByTestId('page-size-select'), { target: { value: '20' } });

    await waitFor(() => {
      expect(mockGetMaterials).toHaveBeenCalledWith({ page: 1, per_page: 20, status: 'active' });
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
      expect(mockGetMaterials).toHaveBeenCalledWith({
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
      expect(mockGetMaterials).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'title',
        sort_order: 'desc',
      });
    });
    expect(screen.getByText(/Название/).textContent).toContain('↓');
  });

  it('sort change resets pager to page 1', async () => {
    setupEnvelope({ total: 42 });
    await renderLoaded();

    // Go to page 2 first, then sort — server refetch must reset to page 1.
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    await waitFor(() => {
      expect(mockGetMaterials).toHaveBeenCalledWith({ page: 2, per_page: 10, status: 'active' });
    });

    fireEvent.click(screen.getByText(/Название/));

    await waitFor(() => {
      expect(mockGetMaterials).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        status: 'active',
        sort_by: 'title',
        sort_order: 'asc',
      });
    });
  });

  // ─── Chrome ─────────────────────────────────────────────────────────────

  it('renders "Добавить материал" button', async () => {
    setupEnvelope();
    await renderLoaded();
    expect(screen.getByText('+ Добавить материал')).toBeInTheDocument();
  });

  it('opens create modal when "Добавить материал" clicked', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить материал'));
    expect(screen.getByText('Новый материал')).toBeInTheDocument();
  });

  it('opens create modal with empty title field', async () => {
    setupEnvelope();
    await renderLoaded();
    fireEvent.click(screen.getByText('+ Добавить материал'));
    // Modal should be open with the "Новый материал" title
    expect(screen.getByText('Новый материал')).toBeInTheDocument();
    // The title input should be empty
    const titleInput = screen.getByPlaceholderText('Масляные краски');
    expect(titleInput).toHaveValue('');
  });

  // ─── Delete functionality ────────────────────────────────────────────

  it('shows "Удалить" option in action dropdown', async () => {
    setupEnvelope();
    await renderLoaded();
    const actionButtons = screen.getAllByLabelText('Действия');
    fireEvent.click(actionButtons[0]);
    expect(screen.getByText('Удалить')).toBeInTheDocument();
  });

  it('calls delete dry-run when "Удалить" clicked (204 → instant delete, no dialog)', async () => {
    mockDeleteMutateAsync.mockResolvedValue(undefined);
    mockDeleteDependencies = null;
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(mockDeleteMutateAsync).toHaveBeenCalledWith('mat-1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });

  // ─── Delete → DeleteDialog flow (#207 §7) — defensive 409 branch ────────
  // Material has ZERO FK deps (§4 matrix: DELETE always 204), so the 409
  // branch is defensive but keeps the uniform DeleteDialog wiring.

  /** Dry-run rejects with a 409 carrying the given tree; hook exposes it. */
  function setupDeleteConflict(deps: DependencyNode[]) {
    mockDeleteDependencies = deps;
    mockDeleteMutateAsync.mockRejectedValue(
      new ApiError(409, 'Удаление невозможно', 'CONFLICT', deps),
    );
  }

  it('opens DeleteDialog when a 409 conflict occurs (defensive)', async () => {
    setupDeleteConflict([
      { entity: 'service_materials', relation: 'Услуга', count: 1, allowed_actions: ['nullify'], message: null },
    ]);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
  });

  it('cancel closes the dialog without executing a delete', async () => {
    setupDeleteConflict([
      { entity: 'service_materials', relation: 'Услуга', count: 1, allowed_actions: ['nullify'], message: null },
    ]);
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog-cancel-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('delete-dialog-cancel-btn'));

    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    expect(mockDeleteMutateAsync).toHaveBeenCalledTimes(1);
  });

  // ─── Archive / Restore (#207 §7.2, replaces patchX({is_active})) ────────

  it('calls archiveMaterial when "В архив" clicked on an active material', async () => {
    mockArchiveMutateAsync.mockResolvedValue({});
    setupEnvelope();
    await renderLoaded();

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('В архив'));

    await waitFor(() => expect(mockArchiveMutateAsync).toHaveBeenCalledWith('mat-1'));
    expect(mockPatchMutateAsync).not.toHaveBeenCalled();
  });

  it('calls restoreMaterial when "Восстановить" clicked on an archived material', async () => {
    setupEnvelope();
    await renderLoaded();

    // mat-3 (archived, "Старые краски") is row index 2 in TEST_MATERIALS
    // order — the server returns the full envelope as-is; no client filtering.
    fireEvent.click(screen.getAllByLabelText('Действия')[2]);
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(mockRestoreMutateAsync).toHaveBeenCalledWith('mat-3'));
    expect(mockPatchMutateAsync).not.toHaveBeenCalled();
  });

  // ─── Edit does not resurrect archived materials (GH #195 via #207) ────────

  it('edit submit on archived material sends no archive flag (GH #195/#207)', async () => {
    setupEnvelope();
    await renderLoaded();

    const archivedRow = screen.getByText('Старые краски').closest('tr')!;
    fireEvent.click(archivedRow);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    // #207 inverted the schema: Update bodies carry no archive flag at all
    // (archive/restore goes through POST endpoints), so editing an archived
    // material can no longer resurrect it. The payload must carry no flag.
    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    const [arg] = mockUpdateMutateAsync.mock.calls[0];
    expect(arg.id).toBe(mockMaterial3.id);
    expect(arg.data.is_active).toBeUndefined();
  });
});
