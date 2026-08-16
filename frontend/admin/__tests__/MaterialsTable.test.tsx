import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MaterialResponse, DependencyNode } from '@memo/api-client';
import { ApiError } from '@memo/api-client';

// ─── Mock data (minimal — only what filter → queryFn tests need) ────────────

const mockMaterialActive: MaterialResponse = {
  id: 'mat-1',
  title: 'Фартук',
  description: 'Защитная одежда',
  archived: false,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockMaterialArchived: MaterialResponse = {
  id: 'mat-2',
  title: 'Старые кисти',
  description: 'Архивный набор',
  archived: true,
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

const TEST_MATERIALS: MaterialResponse[] = [
  mockMaterialActive,
  mockMaterialArchived,
];

// ─── Mocks ──────────────────────────────────────────────────────────────────

// Per-hook spies so tests can assert which mutation the table calls
// (#207: delete ≠ patch(is_active) — archive/restore are dedicated hooks).
// Shared consts (like ServicesTable.test.tsx) read by the hoisted factory at
// render time.
const mockCreateMutateAsync = vi.fn().mockResolvedValue({});
const mockUpdateMutateAsync = vi.fn().mockResolvedValue({});
const mockPatchMutateAsync = vi.fn().mockResolvedValue({});
const mockDeleteMutateAsync = vi.fn().mockResolvedValue({});
const mockArchiveMutateAsync = vi.fn().mockResolvedValue({});
const mockRestoreMutateAsync = vi.fn().mockResolvedValue({});
// The hook's `dependencies` (409 dry-run tree) — mutable per test.
let mockDeleteDependencies: DependencyNode[] | null = null;

// Shared so tests can assert invalidation (#207: ['materials'] on dialog done).
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
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
}));

// Spy on getMaterials (preserve other api-client exports via importOriginal)
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getMaterials: vi.fn(), resolveDeleteMaterial: vi.fn() };
});

vi.mock('@/hooks/useMaterialsMutations', () => ({
  useUpdateMaterial: () => ({ mutateAsync: mockUpdateMutateAsync, isPending: false }),
  usePatchMaterial: () => ({ mutateAsync: mockPatchMutateAsync, isPending: false }),
  useCreateMaterial: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
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

import { useQuery } from '@tanstack/react-query';
import { getMaterials, resolveDeleteMaterial } from '@memo/api-client';

const mockUseQuery = vi.mocked(useQuery);
const mockGetMaterials = vi.mocked(getMaterials);
const mockResolveDeleteMaterial = vi.mocked(resolveDeleteMaterial);

import { MaterialsTable } from '@/app/(main)/services/components/MaterialsTable';

// ─── Helpers ───────────────────────────────────────────────────────────────

function setupQuery(materials: MaterialResponse[] = TEST_MATERIALS, isLoading = false) {
  // Resolve the getMaterials spy with the supplied list so the component's
  // `queryFn` (which calls `getMaterials(...).then(r => r.items)`) settles.
  mockGetMaterials.mockResolvedValue({
    items: materials,
    total: materials.length,
    page: 1,
    per_page: 100,
  });
  // Drive `useQuery` through `mockImplementation` so the real `queryFn` is
  // invoked on every render — this is what lets the getMaterials spy record
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
      data: materials,
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
      promise: Promise.resolve({ data: materials }),
    };
  }) as unknown) as typeof useQuery);
  return mockGetMaterials;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MaterialsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('requests active materials by default', () => {
    const spy = setupQuery(TEST_MATERIALS);
    render(<MaterialsTable />);

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'active' });
  });

  it('requests archived materials when filter is "Архив"', () => {
    const spy = setupQuery(TEST_MATERIALS);
    render(<MaterialsTable />);

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'archived' },
    });

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'archived' });
  });

  it('requests all materials when filter is "Все"', () => {
    const spy = setupQuery(TEST_MATERIALS);
    render(<MaterialsTable />);

    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    expect(spy).toHaveBeenCalledWith({ per_page: 100, status: 'all' });
  });

  // ─── Edit does not resurrect archived materials (GH #195 via #207) ───────

  it('edit submit on archived material sends no archive flag (GH #195/#207)', async () => {
    // Switch to "all" so the archived mockMaterialArchived ("Старые кисти",
    // id=mat-2) is rendered by the table.
    setupQuery(TEST_MATERIALS);
    render(<MaterialsTable />);
    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    const archivedRow = screen.getByText('Старые кисти').closest('tr')!;
    fireEvent.click(archivedRow);

    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    // #207 inverted the schema: Update bodies carry no archive flag at all
    // (archive/restore goes through POST endpoints), so editing an archived
    // material can no longer resurrect it. The payload must carry no flag.
    await waitFor(() => expect(mockUpdateMutateAsync).toHaveBeenCalled());
    const [arg] = mockUpdateMutateAsync.mock.calls[0];
    expect(arg.id).toBe(mockMaterialArchived.id);
    expect(arg.data.is_active).toBeUndefined();
  });

  // ─── Delete → instant 204 (Material has zero FK deps, §4 matrix) ───────

  it('calls delete dry-run when "Удалить" clicked (204 → instant delete, no dialog)', async () => {
    mockDeleteMutateAsync.mockResolvedValue(undefined);
    mockDeleteDependencies = null;
    setupQuery(TEST_MATERIALS);
    render(<MaterialsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(mockDeleteMutateAsync).toHaveBeenCalledWith('mat-1'));
    expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
  });

  // ─── Delete → DeleteDialog flow (#207 §7) — defensive 409 branch ────────

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
    setupQuery(TEST_MATERIALS);
    render(<MaterialsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('Удалить'));

    await waitFor(() => expect(screen.getByTestId('delete-dialog')).toBeInTheDocument());
  });

  // ─── Archive / Restore (#207 §7.2, replaces patchX({is_active})) ────────

  it('calls archiveMaterial when "В архив" clicked on an active material', async () => {
    mockArchiveMutateAsync.mockResolvedValue({});
    setupQuery(TEST_MATERIALS);
    render(<MaterialsTable />);

    fireEvent.click(screen.getAllByLabelText('Действия')[0]);
    fireEvent.click(screen.getByText('В архив'));

    await waitFor(() => expect(mockArchiveMutateAsync).toHaveBeenCalledWith('mat-1'));
    expect(mockPatchMutateAsync).not.toHaveBeenCalled();
  });

  it('calls restoreMaterial when "Восстановить" clicked on an archived material', async () => {
    // Switch to "all" so the archived mockMaterialArchived ("Старые кисти",
    // id=mat-2) is rendered.
    setupQuery(TEST_MATERIALS);
    render(<MaterialsTable />);
    fireEvent.change(screen.getByLabelText('Фильтр по статусу'), {
      target: { value: 'all' },
    });

    mockRestoreMutateAsync.mockResolvedValue({});
    fireEvent.click(screen.getAllByLabelText('Действия')[1]); // mat-2 row
    fireEvent.click(screen.getByText('Восстановить'));

    await waitFor(() => expect(mockRestoreMutateAsync).toHaveBeenCalledWith('mat-2'));
    expect(mockPatchMutateAsync).not.toHaveBeenCalled();
  });
});