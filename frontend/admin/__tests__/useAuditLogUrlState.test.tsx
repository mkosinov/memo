import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PaginatedResponse, AuditLogResponse } from '@memo/api-client';

// Mock only the wire fetcher — the factory + AuditLogContext stay REAL, so
// this pins the actual fetcher params (useStaffUrlState.test.tsx precedent).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, getAuditLogs: vi.fn() };
});

// Real next/navigation shape via the shared stateful mock — the page-scoped
// hook reads AND writes through it, so pushed URLs must re-render the tree.
vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
import { __resetNavigation, __lastPushedUrl } from './helpers/nextNavigationMock';

import { getAuditLogs } from '@memo/api-client';
import {
  useAuditLogUrlState,
  auditLogUrlConfig,
  AUDIT_ACTION_VALUES,
  AUDIT_ENTITY_VALUES,
} from '../app/(main)/audit/useAuditLogUrlState';
import { AuditLogProvider, useAuditLogTable } from '@/contexts/AuditLogContext';

const mockGetAuditLogs = vi.mocked(getAuditLogs);

function envelope(items: AuditLogResponse[] = []): PaginatedResponse<AuditLogResponse> {
  return { items, total: items.length, page: 1, per_page: 20 };
}

function lastWireParams(): Record<string, unknown> {
  const calls = mockGetAuditLogs.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

beforeEach(() => {
  mockGetAuditLogs.mockResolvedValue(envelope());
  __resetNavigation('', '/audit');
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

describe('useAuditLogUrlState — config (#349 Task 9)', () => {
  it('exposes the canonical preset contract for the audit page', () => {
    // Discrete enums = the REAL journal vocabularies (auditLabels.ts, spec
    // §7): 8 actions (update/patch share «изменил» but stay distinct slugs;
    // password_link_issued — #348 spec §8, backend canon: models/audit_log.py
    // widened 16→24 + usecases/password_setup.py writes it) and the 16
    // canonical #239 entity names.
    expect([...AUDIT_ACTION_VALUES]).toEqual([
      'create',
      'update',
      'patch',
      'delete',
      'archive',
      'restore',
      'reorder',
      'password_link_issued',
    ]);
    expect([...AUDIT_ENTITY_VALUES]).toEqual([
      'clients',
      'visitors',
      'services',
      'locations',
      'materials',
      'tags',
      'positions',
      'activities',
      'records',
      'visits',
      'payments',
      'photos',
      'staff',
      'users',
      'masters',
      'user_settings',
    ]);
    expect(auditLogUrlConfig.user_id).toEqual({ kind: 'string', maxLength: 64, defaultValue: '' });
    expect(auditLogUrlConfig.action).toEqual({
      kind: 'enum',
      values: [...AUDIT_ACTION_VALUES],
      defaultValue: '',
    });
    expect(auditLogUrlConfig.entity).toEqual({
      kind: 'enum',
      values: [...AUDIT_ENTITY_VALUES],
      defaultValue: '',
    });
    // datePair owns date_from/date_to (NOT from/to — spec §5 п.7) with the
    // «не задано» default: BOTH null, unlike records' current week.
    expect(auditLogUrlConfig.period).toEqual({
      kind: 'datePair',
      fromName: 'date_from',
      toName: 'date_to',
      defaults: expect.any(Function),
    });
    expect(auditLogUrlConfig.period.defaults()).toEqual({ from: null, to: null });
    expect(auditLogUrlConfig.page).toEqual({ kind: 'int', min: 1, max: 10000, defaultValue: 1 });
    // per_page default 20 — the AuditLogContext factory default (NOT 10).
    expect(auditLogUrlConfig.per_page).toEqual({
      kind: 'enum',
      values: [10, 20, 50, 100],
      defaultValue: 20,
    });
    // Sorting is SERVER-FIXED (created_at DESC): NO sort_by/sort_order keys —
    // the config must not manage what the URL must not carry.
    expect(Object.keys(auditLogUrlConfig).sort()).toEqual(
      ['action', 'entity', 'page', 'per_page', 'period', 'user_id'],
    );
  });

  it('valid link is honored (flattened view, datePair → date_from/date_to strings)', () => {
    __resetNavigation(
      '?action=create&entity=tags&user_id=abc-123&date_from=2026-01-01&date_to=2026-01-31&page=2&per_page=50',
      '/audit',
    );
    const { result } = renderHook(() => useAuditLogUrlState());
    expect(result.current.state.user_id).toBe('abc-123');
    expect(result.current.state.action).toBe('create');
    expect(result.current.state.entity).toBe('tags');
    expect(result.current.state.date_from).toBe('2026-01-01');
    expect(result.current.state.date_to).toBe('2026-01-31');
    expect(result.current.state.page).toBe(2);
    expect(result.current.state.per_page).toBe(50);
  });

  it('dirty values silently fall back (action/entity bogus, page=0), URL untouched', () => {
    __resetNavigation('?action=bogus&entity=bogus&page=0&user_id=x', '/audit');
    const { result } = renderHook(() => useAuditLogUrlState());
    expect(result.current.state.action).toBe('');
    expect(result.current.state.entity).toBe('');
    expect(result.current.state.page).toBe(1);
    // user_id is a free string (UUID from the authors dropdown) — kept raw.
    expect(result.current.state.user_id).toBe('x');
    expect(__lastPushedUrl()).toBeNull(); // dirty URL not rewritten
  });

  it('inverted period (date_from > date_to) → BOTH sides null («не задано»)', () => {
    __resetNavigation('?date_from=2030-12-31&date_to=2020-01-01', '/audit');
    const { result } = renderHook(() => useAuditLogUrlState());
    expect(result.current.state.date_from).toBe('');
    expect(result.current.state.date_to).toBe('');
  });

  it('half-filter: one valid side stays, the other remains unset (no default substitution)', () => {
    __resetNavigation('?date_from=2026-06-01', '/audit');
    const { result } = renderHook(() => useAuditLogUrlState());
    expect(result.current.state.date_from).toBe('2026-06-01');
    expect(result.current.state.date_to).toBe('');
  });

  it('update({entity}) writes entity + implicit page reset in one push', async () => {
    __resetNavigation('?page=3', '/audit');
    const { result } = renderHook(() => useAuditLogUrlState());
    act(() => {
      result.current.update({ entity: 'tags' });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/audit?entity=tags');
  });

  it('update({date_to}) carries the URL date_from side (translation to the pair)', async () => {
    __resetNavigation('?date_from=2026-06-01', '/audit');
    const { result } = renderHook(() => useAuditLogUrlState());
    act(() => {
      result.current.update({ date_to: '2026-06-30' });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/audit?date_from=2026-06-01&date_to=2026-06-30');
  });

  it('update({date_from: ""}) clears the side → param gone, other side kept', async () => {
    __resetNavigation('?date_from=2026-06-01&date_to=2026-06-30', '/audit');
    const { result } = renderHook(() => useAuditLogUrlState());
    act(() => {
      result.current.update({ date_from: '' });
    });
    await settle();
    expect(__lastPushedUrl()).toBe('/audit?date_to=2026-06-30');
  });
});

describe('AuditLogProvider urlState wiring — fetcher params', () => {
  /** Renders hook + provider together, exactly like the page does. */
  function renderProvider() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const probe: { current: ReturnType<typeof useAuditLogTable> | null } = { current: null };
    function Probe() {
      probe.current = useAuditLogTable();
      return null;
    }
    function Page() {
      const urlState = useAuditLogUrlState();
      return (
        <QueryClientProvider client={queryClient}>
          <AuditLogProvider urlState={urlState}>
            <Probe />
          </AuditLogProvider>
        </QueryClientProvider>
      );
    }
    const utils = render(<Page />);
    return { ...utils, probe };
  }

  it('clean mount: one fetch, no filter/sort keys, page 1 / per_page 20', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));
    // Only the pagination floor — the «не задано» period and empty discrete
    // filters never reach the wire; sort is server-fixed (never forwarded).
    expect(lastWireParams()).toEqual({ page: 1, per_page: 20 });
    expect(probe.current!.filters).toEqual({
      user_id: '',
      action: '',
      entity: '',
      date_from: '',
      date_to: '',
    });
    expect(probe.current!.sortBy).toBeNull();
  });

  it('full link — one fetch, exact params, still one after settling', async () => {
    __resetNavigation(
      '?action=create&entity=tags&user_id=abc-123&date_from=2026-01-01&date_to=2026-01-31&page=2&per_page=50',
      '/audit',
    );
    renderProvider();
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({
      action: 'create',
      entity: 'tags',
      user_id: 'abc-123',
      date_from: '2026-01-01',
      date_to: '2026-01-31',
      page: 2,
      per_page: 50,
    });
    // No double-fetch regression.
    await settle(100);
    expect(mockGetAuditLogs).toHaveBeenCalledTimes(1);
  });

  it('half-filter link: only the present side reaches the wire', async () => {
    __resetNavigation('?date_from=2026-06-01&action=create', '/audit');
    renderProvider();
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({
      action: 'create',
      date_from: '2026-06-01',
      page: 1,
      per_page: 20,
    });
  });

  it('dirty link (bogus enums + inverted period) — one fetch with clean defaults', async () => {
    __resetNavigation('?action=bogus&entity=bogus&date_from=2030-12-31&date_to=2020-01-01&page=0', '/audit');
    renderProvider();
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));
    expect(lastWireParams()).toEqual({ page: 1, per_page: 20 });
  });

  it('setFilters({action}) writes the action to the URL (one push)', async () => {
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.setFilters({ action: 'delete' });
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/audit?action=delete');
  });

  it('resetFilters returns the bare /audit URL (all defaults stripped)', async () => {
    __resetNavigation('?action=create&entity=tags&page=4', '/audit');
    const { probe } = renderProvider();
    await waitFor(() => expect(mockGetAuditLogs).toHaveBeenCalledTimes(1));
    act(() => {
      probe.current!.resetFilters();
    });
    await settle(50);
    expect(__lastPushedUrl()).toBe('/audit');
  });
});
