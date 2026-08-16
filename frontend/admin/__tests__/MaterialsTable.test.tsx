import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MaterialResponse } from '@memo/api-client';

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

// Shared mutateAsync so tests can assert on update calls. Because the mock
// factory below is hoisted above this const by vitest, the factory is only
// invoked when `@/hooks/useMaterialsMutations` is imported — by which point
// the module-level const has been initialized. (Same pattern as
// ServicesTable.test.tsx.)
const mockMutateAsync = vi.fn().mockResolvedValue({});

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
    mutateAsync: vi.fn().mockResolvedValue({}),
    isPending: false,
  })),
}));

// Spy on getMaterials (preserve other api-client exports via importOriginal)
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getMaterials: vi.fn() };
});

vi.mock('@/hooks/useMaterialsMutations', () => ({
  useUpdateMaterial: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  usePatchMaterial: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  useCreateMaterial: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
  useDeleteMaterial: () => ({ mutateAsync: mockMutateAsync, isPending: false }),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: () => ({
    showToast: vi.fn(),
    deleteMode: false,
    toasts: [],
  }),
}));

import { useQuery } from '@tanstack/react-query';
import { getMaterials } from '@memo/api-client';

const mockUseQuery = vi.mocked(useQuery);
const mockGetMaterials = vi.mocked(getMaterials);

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
    // (Until Task 19 rewires the table, the key survives as undefined.)
    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalled());
    const [arg] = mockMutateAsync.mock.calls[0];
    expect(arg.id).toBe(mockMaterialArchived.id);
    expect(arg.data.is_active).toBeUndefined();
  });
});