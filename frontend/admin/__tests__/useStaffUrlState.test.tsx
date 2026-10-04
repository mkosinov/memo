import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, StaffResponse } from '@memo/api-client';

// Mock only the wire fetcher — the factory + StaffContext stay REAL, so this
// pins the actual fetcher params (useLocationsUrlState.test.tsx precedent).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getStaff: vi.fn() };
});

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hook reads AND writes through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl } from './helpers/nextNavigationMock';

import { getStaff } from '@memo/api-client';
import {
  useStaffUrlState,
  staffUrlConfig,
  STAFF_SORT_FIELDS,
} from '../app/(main)/staff/useStaffUrlState';
import { StaffProvider, useStaffTable } from '@/contexts/StaffContext';

const mockGetStaff = vi.mocked(getStaff);

function envelope(items: StaffResponse[] = []): PaginatedResponse<StaffResponse> {
  return { items, total: items.length, page: 1, per_page: 10 };
}

function lastWireParams(): Record<string, unknown> {
  const calls = mockGetStaff.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetStaff.mockResolvedValue(envelope());
  __resetNavigation('', '/staff');
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

describe('useStaffUrlState — config (#349 Task 8)', () => {
  it('exposes the canonical preset contract for the staff page', () => {
    // Sort whitelist = the backend staff whitelist (domain-rules/staff.md
    // §List contract): `position` is EXCLUDED (M2M makes it ambiguous).
    expect([...STAFF_SORT_FIELDS]).toEqual([
      'name',
      'specialty',
      'color',
      'avatar',
      'status',
    ]);
    expect(staffUrlConfig.q).toEqual({ kind: 'string', maxLength: 200, defaultValue: '' });
    expect(staffUrlConfig.status).toEqual({
      kind: 'enum',
      values: ['active', 'all', 'archived'],
      defaultValue: 'active',
    });
    expect(staffUrlConfig.sort_by).toEqual({
      kind: 'enum',
      values: [...STAFF_SORT_FIELDS],
      defaultValue: '',
    });
    expect(staffUrlConfig.sort_order).toEqual({
      kind: 'enum',
      values: ['asc', 'desc'],
      defaultValue: 'asc',
      requires: 'sort_by',
    });
    expect(staffUrlConfig.page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    expect(staffUrlConfig.per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 10,
    });
  });

  it('valid ?q=Ольга&status=all&sort_by=name&sort_order=desc is honored', () => {
    __resetNavigation('?q=%D0%9E%D0%BB%D1%8C%D0%B3%D0%B0&status=all&sort_by=name&sort_order=desc', '/staff');
    const { result } = renderHook(() => useStaffUrlState());
    expect(result.current.state.q).toBe('Ольга');
    expect(result.current.state.status).toBe('all');
    expect(result.current.state.sort_by).toBe('name');
    expect(result.current.state.sort_order).toBe('desc');
  });

  it('dirty values silently fall back (sort_by=position, status=xyz, page=0), URL untouched', () => {
    __resetNavigation('?sort_by=position&status=xyz&page=0&q=x', '/staff');
    const { result } = renderHook(() => useStaffUrlState());
    // position is NOT in the whitelist (M2M — domain-rules/staff.md).
    expect(result.current.state.sort_by).toBe('');
    expect(result.current.state.status).toBe('active');
    expect(result.current.state.page).toBe(1);
    // q=1 char: the STRING state keeps the raw text (≥2 rule is wire-side).
    expect(result.current.state.q).toBe('x');
    expect(__lastPushedUrl()).toBeNull(); // dirty URL not rewritten
  });

  it('update({status}) writes status + implicit page reset in one push', async () => {
    __resetNavigation('?page=3', '/staff');
    const { result } = renderHook(() => useStaffUrlState());
    act(() => {
      result.current.update({ status: 'all' });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/staff?status=all');
  });
});

describe('StaffProvider urlState wiring — fetcher params', () => {
  /** Renders hook + provider together, exactly like the page does. */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof useStaffTable> | null } = { current: null };
    function Probe() {
      probe.current = useStaffTable();
      return null;
    }
    function Page() {
      const urlState = useStaffUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          <StaffProvider urlState={urlState}>
            <Probe />
          </StaffProvider>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, no sort/q keys, status=active, page 1 / per_page 10', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetStaff).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({ page: 1, per_page: 10, status: 'active' });
    expect(probe.current!.sortBy).toBeNull();
    expect(probe.current!.search).toBe('');
    expect(probe.current!.status).toBe('active');
  });

  it('?q=Ольга&status=all&sort_by=name&sort_order=desc&page=2&per_page=50 — one fetch, exact params', async () => {
    __resetNavigation(
      '?q=%D0%9E%D0%BB%D1%8C%D0%B3%D0%B0&status=all&sort_by=name&sort_order=desc&page=2&per_page=50',
      '/staff',
    );
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetStaff).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({
      q: 'Ольга',
      status: 'all',
      sort_by: 'name',
      sort_order: 'desc',
      page: 2,
      per_page: 50,
    });
    expect(probe.current!.search).toBe('Ольга');
    expect(probe.current!.status).toBe('all');
    // Still exactly ONE request after settling (no double-fetch regression).
    await settle(100);
    expect(mockGetStaff).toHaveBeenCalledTimes(1);
  });

  it('1-char q stays in state but never reaches the wire (≥2 server clamp)', async () => {
    __resetNavigation('?q=x', '/staff');
    renderProvider();
    await waitFor(() => expect(mockGetStaff).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({ page: 1, per_page: 10, status: 'active' });
  });

  it('setStatus writes status to the URL (one push) — lands in the address', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetStaff).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setStatus('archived');
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/staff?status=archived');
  });
});
