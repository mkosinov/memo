import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, ServiceResponse, MaterialResponse } from '@memo/api-client';

// Mock only the wire fetchers — the factory + Services/Materials contexts
// stay REAL, so this pins the actual fetcher params (locations T5 precedent).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getServices: vi.fn(), getMaterials: vi.fn() };
});

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hooks read AND write through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl } from './helpers/nextNavigationMock';

import { getServices, getMaterials } from '@memo/api-client';
import {
  useServicesUrlState,
  useMaterialsUrlState,
  servicesUrlConfig,
  materialsUrlConfig,
  SERVICES_SORT_FIELDS,
  MATERIALS_SORT_FIELDS,
} from '../app/(main)/services/useServicesUrlState';
import { ServicesProvider, useServicesTable } from '../contexts/ServicesContext';
import { MaterialsProvider, useMaterialsTable } from '../contexts/MaterialsContext';

const mockGetServices = vi.mocked(getServices);
const mockGetMaterials = vi.mocked(getMaterials);

function servicesEnvelope(items: ServiceResponse[] = []): PaginatedResponse<ServiceResponse> {
  return { items, total: items.length, page: 1, per_page: 10 };
}

function materialsEnvelope(items: MaterialResponse[] = []): PaginatedResponse<MaterialResponse> {
  return { items, total: items.length, page: 1, per_page: 10 };
}

function lastServicesParams(): Record<string, unknown> {
  const calls = mockGetServices.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

function lastMaterialsParams(): Record<string, unknown> {
  const calls = mockGetMaterials.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetServices.mockResolvedValue(servicesEnvelope());
  mockGetMaterials.mockResolvedValue(materialsEnvelope());
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

/** Both page-scoped adapters in ONE host — exactly how the page mounts them
 * (two useTableUrlState instances on the single /services URL, #349 Task 6). */
function useBothAdapters() {
  return { services: useServicesUrlState(), materials: useMaterialsUrlState() };
}

describe('services page URL configs (#349 Task 6)', () => {
  it('services config — canonical names, backend sort whitelist, dict defaults', () => {
    expect([...SERVICES_SORT_FIELDS]).toEqual([
      'title',
      'duration',
      'age',
      'tariffs',
      'specialty',
      'archived',
      'created_at',
    ]);
    expect(servicesUrlConfig.q).toEqual({ kind: 'string', maxLength: 200, defaultValue: '' });
    expect(servicesUrlConfig.status).toEqual({
      kind: 'enum',
      values: ['active', 'all', 'archived'],
      defaultValue: 'active',
    });
    expect(servicesUrlConfig.sort_by).toEqual({
      kind: 'enum',
      values: [...SERVICES_SORT_FIELDS],
      defaultValue: '',
    });
    expect(servicesUrlConfig.sort_order).toEqual({
      kind: 'enum',
      values: ['asc', 'desc'],
      defaultValue: 'asc',
      requires: 'sort_by',
    });
    expect(servicesUrlConfig.page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    expect(servicesUrlConfig.per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 10,
    });
  });

  it('materials config — mat_-prefixed names (spec §2), own sort whitelist', () => {
    expect([...MATERIALS_SORT_FIELDS]).toEqual(['title', 'description', 'archived', 'created_at']);
    expect(materialsUrlConfig.mat_q).toEqual({ kind: 'string', maxLength: 200, defaultValue: '' });
    expect(materialsUrlConfig.mat_status).toEqual({
      kind: 'enum',
      values: ['active', 'all', 'archived'],
      defaultValue: 'active',
    });
    expect(materialsUrlConfig.mat_sort_by).toEqual({
      kind: 'enum',
      values: [...MATERIALS_SORT_FIELDS],
      defaultValue: '',
    });
    expect(materialsUrlConfig.mat_sort_order).toEqual({
      kind: 'enum',
      values: ['asc', 'desc'],
      defaultValue: 'asc',
      requires: 'mat_sort_by',
    });
    expect(materialsUrlConfig.mat_page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    expect(materialsUrlConfig.mat_per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 10,
    });
  });

  it('combined link: BOTH adapter states restored from one URL', () => {
    __resetNavigation(
      '?q=%D0%B0%D0%BA%D0%B2&status=all&sort_by=title&sort_order=desc&page=2&per_page=50' +
        '&mat_q=%D0%BC%D0%B0%D1%81&mat_status=archived&mat_sort_by=created_at&mat_sort_order=asc&mat_page=3&mat_per_page=20',
      '/services',
    );
    const { result } = renderHook(() => useBothAdapters());
    // Services half — canonical names verbatim.
    expect(result.current.services.state.q).toBe('акв');
    expect(result.current.services.state.status).toBe('all');
    expect(result.current.services.state.sort_by).toBe('title');
    expect(result.current.services.state.sort_order).toBe('desc');
    expect(result.current.services.state.page).toBe(2);
    expect(result.current.services.state.per_page).toBe(50);
    // Materials half — projected to canonical names for the factory.
    expect(result.current.materials.state.q).toBe('мас');
    expect(result.current.materials.state.status).toBe('archived');
    expect(result.current.materials.state.sort_by).toBe('created_at');
    expect(result.current.materials.state.sort_order).toBe('asc');
    expect(result.current.materials.state.page).toBe(3);
    expect(result.current.materials.state.per_page).toBe(20);
  });

  it('dirty values fall back silently on BOTH halves, URL untouched', () => {
    __resetNavigation(
      '?sort_by=bogus&status=xyz&page=0&per_page=7&mat_sort_by=bogus&mat_status=xyz&mat_page=0&mat_per_page=7',
      '/services',
    );
    const { result } = renderHook(() => useBothAdapters());
    expect(result.current.services.state.sort_by).toBe('');
    expect(result.current.services.state.status).toBe('active');
    expect(result.current.services.state.page).toBe(1);
    expect(result.current.services.state.per_page).toBe(10);
    expect(result.current.materials.state.sort_by).toBe('');
    expect(result.current.materials.state.status).toBe('active');
    expect(result.current.materials.state.page).toBe(1);
    expect(result.current.materials.state.per_page).toBe(10);
    expect(__lastPushedUrl()).toBeNull(); // dirty URL not rewritten
  });
});

describe('ServicesProvider urlState wiring — fetcher params', () => {
  /** Renders hook + provider together, exactly like the page does. */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof useServicesTable> | null } = { current: null };
    function Probe() {
      probe.current = useServicesTable();
      return null;
    }
    function Page() {
      const urlState = useServicesUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          <ServicesProvider urlState={urlState}>
            <Probe />
          </ServicesProvider>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, no sort/q keys, status=active, page 1 / per_page 10', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(1));
    expect(lastServicesParams()).toEqual({ page: 1, per_page: 10, status: 'active' });
    expect(probe.current!.sortBy).toBeNull();
    expect(probe.current!.search).toBe('');
  });

  it('services link params — one fetch, exact params, mat_* ignored by the fetcher', async () => {
    __resetNavigation(
      '?q=%D0%B0%D0%BA%D0%B2&status=all&sort_by=title&sort_order=desc&page=2&per_page=50' +
        '&mat_q=%D0%BC%D0%B0%D1%81&mat_page=3',
      '/services',
    );
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(1));
    expect(lastServicesParams()).toEqual({
      q: 'акв',
      status: 'all',
      sort_by: 'title',
      sort_order: 'desc',
      page: 2,
      per_page: 50,
    });
    expect(probe.current!.search).toBe('акв');
    // Still exactly ONE request after settling (no double-fetch regression).
    await settle(100);
    expect(mockGetServices).toHaveBeenCalledTimes(1);
  });

  it('setStatus writes the URL in one push — mat_* params survive untouched', async () => {
    __resetNavigation('?mat_q=%D0%BC%D0%B0%D1%81&mat_page=3', '/services');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setStatus('all');
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/services?mat_q=%D0%BC%D0%B0%D1%81&mat_page=3&status=all');
  });

  it('structured material_id filter stays machine-side — never in the URL, lands on the wire', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setFilters({ material_id: 'm1' });
    });
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(2));
    expect(lastMaterialsParams).toBeDefined(); // sanity: helper alive
    expect(lastServicesParams()).toMatchObject({ material_id: 'm1' });
    expect(probe.current!.filters.material_id).toBe('m1');
    await settle();
    expect(__lastPushedUrl()).toBeNull(); // no URL write for structured filters
  });

  it('resetFilters returns material_id to «все» without touching the URL', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setFilters({ material_id: 'm1' });
    });
    await waitFor(() => expect(mockGetServices).toHaveBeenCalledTimes(2));
    act(() => {
      probe.current!.resetFilters();
    });
    await waitFor(() => expect(probe.current!.filters.material_id).toBe(''));
    await settle();
    expect(__lastPushedUrl()).toBeNull();
  });
});

describe('MaterialsProvider urlState wiring — mat_ → canonical fetcher params', () => {
  /** Renders BOTH adapters + the materials provider, exactly like the page
   * (the services adapter is mounted too — one URL, two instances). */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof useMaterialsTable> | null } = { current: null };
    function Probe() {
      probe.current = useMaterialsTable();
      return null;
    }
    function Page() {
      const servicesUrlState = useServicesUrlState();
      const materialsUrlState = useMaterialsUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          {/* Services provider omitted (the page renders it in the other
              branch) — the adapter still mounts to prove co-existence. */}
          <MaterialsProvider urlState={materialsUrlState}>
            <Probe />
          </MaterialsProvider>
          <span data-testid="services-adapter-mounted">{String(servicesUrlState.state.page)}</span>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, defaults (mat_* absent)', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalledTimes(1));
    expect(lastMaterialsParams()).toEqual({ page: 1, per_page: 10, status: 'active' });
    expect(probe.current!.sortBy).toBeNull();
  });

  it('mat_ link params — one fetch with CANONICAL names on the wire', async () => {
    __resetNavigation(
      '?mat_q=%D0%BC%D0%B0%D1%81&mat_status=all&mat_sort_by=title&mat_sort_order=asc&mat_page=1&mat_per_page=20',
      '/services',
    );
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalledTimes(1));
    expect(lastMaterialsParams()).toEqual({
      q: 'мас',
      status: 'all',
      sort_by: 'title',
      sort_order: 'asc',
      page: 1,
      per_page: 20,
    });
    expect(probe.current!.search).toBe('мас');
    await settle(100);
    expect(mockGetMaterials).toHaveBeenCalledTimes(1);
  });

  it('setStatus writes mat_status + auto page reset in one push; services params preserved', async () => {
    __resetNavigation('?q=%D0%B0%D0%BA%D0%B2&page=2', '/services');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setStatus('archived');
    });
    await settle();
    // mat_page auto-reset to default (1 → stripped), q/page (services half)
    // pass through as unmanaged params of the mat_ config.
    expect(__lastPushedUrl()).toBe('/services?q=%D0%B0%D0%BA%D0%B2&page=2&mat_status=archived');
  });

  it('explicit page in the patch wins over the auto-reset (mat_page kept)', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetMaterials).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setPage(4);
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/services?mat_page=4');
  });
});
