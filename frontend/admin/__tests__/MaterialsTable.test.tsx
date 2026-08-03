import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { MaterialResponse } from '@memo/api-client';

// ─── Mock data (minimal — only what filter → queryFn tests need) ────────────

const mockMaterialActive: MaterialResponse = {
  id: 'mat-1',
  title: 'Фартук',
  description: 'Защитная одежда',
  is_active: true,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const mockMaterialArchived: MaterialResponse = {
  id: 'mat-2',
  title: 'Старые кисти',
  description: 'Архивный набор',
  is_active: false,
  created_at: '2024-02-01T00:00:00Z',
  updated_at: '2024-02-01T00:00:00Z',
};

const TEST_MATERIALS: MaterialResponse[] = [
  mockMaterialActive,
  mockMaterialArchived,
];

// ─── Mocks ──────────────────────────────────────────────────────────────────

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
  useUpdateMaterial: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  usePatchMaterial: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useCreateMaterial: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
  useDeleteMaterial: () => ({ mutateAsync: vi.fn().mockResolvedValue({}), isPending: false }),
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
});