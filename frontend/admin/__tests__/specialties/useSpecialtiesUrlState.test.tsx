import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, SpecialtyResponse } from '@memo/api-client';

// GH #599 Task 8.1 — the specialties half of the /services URL state. Mock
// only the wire fetchers: the factory + Services/Materials/Specialties
// contexts stay REAL, so this pins the actual fetcher params (the
// useServicesUrlState.test.tsx precedent, third adapter added).

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getServices: vi.fn(),
    getMaterials: vi.fn(),
    getSpecialties: vi.fn(),
  };
});

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hooks read AND write through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('../helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl } from '../helpers/nextNavigationMock';

import { getServices, getMaterials, getSpecialties } from '@memo/api-client';
import {
  useServicesUrlState,
  useMaterialsUrlState,
  useSpecialtiesUrlState,
  specialtiesUrlConfig,
  SPECIALTIES_SORT_FIELDS,
} from '@/app/(main)/services/useServicesUrlState';
import { SpecialtiesProvider, useSpecialtiesTable } from '@/contexts/SpecialtiesContext';

const mockGetServices = vi.mocked(getServices);
const mockGetMaterials = vi.mocked(getMaterials);
const mockGetSpecialties = vi.mocked(getSpecialties);

// Non-empty envelope: the factory's page-clamp effect resets an empty
// non-first page — a lone row keeps every page assertion deterministic.
const ROW: SpecialtyResponse = {
  id: 'spec-1',
  title: 'Живопись',
  created_at: '2024-01-01T10:00:00Z',
  updated_at: '2024-01-01T10:00:00Z',
};

function envelope(items: SpecialtyResponse[] = [ROW]): PaginatedResponse<SpecialtyResponse> {
  return { items, total: items.length, page: 1, per_page: 10 };
}

// The services/materials fetchers stay UNMOUNTED here (read-only adapters;
// their providers never render) — empty envelopes suffice, and the never[]
// items keep the literal assignable to every PaginatedResponse<T> without
// dragging in the (Task 8.2-pending) ServiceResponse fixture shapes.
const EMPTY_ENVELOPE = { items: [] as never[], total: 0, page: 1, per_page: 10 };

function lastSpecialtiesParams(): Record<string, unknown> {
  const calls = mockGetSpecialties.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetServices.mockResolvedValue(EMPTY_ENVELOPE);
  mockGetMaterials.mockResolvedValue(EMPTY_ENVELOPE);
  mockGetSpecialties.mockResolvedValue(envelope());
  __resetNavigation('', '/services');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

/** Real-time sleep past the ~16ms coalescing window, inside act. */
async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/** ALL THREE page-scoped adapters in ONE host — exactly how the page mounts
 * them (three useTableUrlState instances on the single /services URL). */
function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const probe: { current: ReturnType<typeof useSpecialtiesTable> | null } = { current: null };
  function Probe() {
    probe.current = useSpecialtiesTable();
    return null;
  }
  function Page() {
    const servicesUrlState = useServicesUrlState();
    const materialsUrlState = useMaterialsUrlState();
    const specialtiesUrlState = useSpecialtiesUrlState();
    return (
      <QueryClientProvider client={queryClient}>
        {/* The other two adapters stay mounted read-only — the page renders
            their providers in mutually exclusive branches; the adapters
            themselves always mount (co-existence is the point). */}
        <SpecialtiesProvider urlState={specialtiesUrlState}>
          <Probe />
        </SpecialtiesProvider>
        <span data-testid="services-adapter-mounted">{String(servicesUrlState.state.page)}</span>
        <span data-testid="materials-adapter-mounted">{String(materialsUrlState.state.page)}</span>
      </QueryClientProvider>
    );
  }
  const utils = render(<Page />);
  return { ...utils, probe };
}

describe('specialties URL config (GH #599 Task 8.1)', () => {
  it('spec_-prefixed pagination only — the dictionary has no q/status/sort', () => {
    expect([...SPECIALTIES_SORT_FIELDS]).toEqual([]);
    expect(specialtiesUrlConfig.spec_page).toEqual({
      kind: 'int',
      min: 1,
      max: 10000,
      defaultValue: 1,
    });
    expect(specialtiesUrlConfig.spec_per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 10,
    });
    expect(Object.keys(specialtiesUrlConfig)).toEqual(['spec_page', 'spec_per_page']);
  });
});

describe('SpecialtiesProvider urlState wiring — spec_ → canonical fetcher params', () => {
  it('clean mount: ONE fetch, pagination only — NO sort, NO status, NO q', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetSpecialties).toHaveBeenCalledTimes(1));
    expect(lastSpecialtiesParams()).toEqual({ page: 1, per_page: 10 });
    expect(lastSpecialtiesParams()).not.toHaveProperty('sort_by');
    expect(lastSpecialtiesParams()).not.toHaveProperty('status');
    expect(lastSpecialtiesParams()).not.toHaveProperty('q');
    expect(probe.current!.page).toBe(1);
    expect(probe.current!.perPage).toBe(10);
    expect(probe.current!.sortBy).toBeNull();
    await settle(100);
    expect(mockGetSpecialties).toHaveBeenCalledTimes(1);
  });

  it('spec_ deep link — canonical names on the wire', async () => {
    __resetNavigation('?spec_page=3&spec_per_page=50', '/services');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetSpecialties).toHaveBeenCalledTimes(1));
    expect(lastSpecialtiesParams()).toEqual({ page: 3, per_page: 50 });
    expect(probe.current!.page).toBe(3);
    expect(probe.current!.perPage).toBe(50);
  });

  it('setPerPage writes spec_per_page + page reset in ONE push; other halves survive', async () => {
    __resetNavigation('?q=%D0%B0%D0%BA%D0%B2&mat_page=2', '/services');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetSpecialties).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setPerPage(20);
    });
    await waitFor(() => expect(mockGetSpecialties).toHaveBeenCalledTimes(2));
    expect(lastSpecialtiesParams()).toEqual({ page: 1, per_page: 20 });
    await settle();
    // spec_page=1 is the default → stripped; q (services) + mat_page pass
    // through as unmanaged params of the spec_ config.
    expect(__lastPushedUrl()).toBe('/services?q=%D0%B0%D0%BA%D0%B2&mat_page=2&spec_per_page=20');
  });

  it('setPage writes spec_page; a services-half write never clobbers spec_*', async () => {
    __resetNavigation('?spec_page=2', '/services');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetSpecialties).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setPage(4);
    });
    await waitFor(() => expect(mockGetSpecialties).toHaveBeenCalledTimes(2));
    expect(lastSpecialtiesParams()).toEqual({ page: 4, per_page: 10 });
    await settle();
    expect(__lastPushedUrl()).toBe('/services?spec_page=4');
  });
});
