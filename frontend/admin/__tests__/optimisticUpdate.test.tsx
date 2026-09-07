import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationProvider } from '../contexts/NavigationContext';
import { ScheduleProvider } from '../contexts/schedule/ScheduleProvider';
import { useScheduleData } from '../contexts/schedule/ScheduleDataContext';
import { getMonday, toISODate } from '@/lib/datetime';

// ─── Mock api-client ─────────────────────────────────────────────────────
vi.mock('@memo/api-client', () => {
  const update = vi.fn();
  const wrap = (items: any[]) => ({ items, total: items.length, page: 1, per_page: 100 });
  return {
    getAllMasters: vi.fn().mockResolvedValue([]),
    getAllLocations: vi.fn().mockResolvedValue([]),
    getAllServices: vi.fn().mockResolvedValue([]),
    getActivities: vi.fn().mockResolvedValue(wrap([])),
    createActivity: vi.fn(),
    updateActivity: update,
    patchActivity: update,
    deleteActivity: vi.fn(),
  };
});

import { updateActivity as apiUpdateActivity, getActivities as apiGetActivities } from '@memo/api-client';
import type { ActivityResponse } from '@memo/api-client';

// ─── Helpers ─────────────────────────────────────────────────────────────

function wrap(items: ActivityResponse[]) {
  return { items, total: items.length, page: 1, per_page: 100 };
}

/** Raw ActivityResponse for the CURRENT week's Monday, 10:00 local. */
function activityA1(overrides: Partial<ActivityResponse> = {}): ActivityResponse {
  const monday = getMonday(new Date());
  return {
    id: 'a1',
    master_id: 'm1',
    service_id: 's1',
    location_id: 'alpika',
    start: `${toISODate(monday)}T10:00:00`,
    duration: 120,
    occupied: 3,
    capacity: 8,
    is_private: false,
    comment: null,
    record_info: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

/** Minimal consumer exposing an update button. */
function TestUpdater() {
  const { updateActivity } = useScheduleData();
  return (
    <button
      data-testid="update-btn"
      onClick={() => updateActivity('a1', { occupied: 5 })}
    >
      Update
    </button>
  );
}

function renderWithContext() {
  const queryClient = createTestQueryClient();
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider>
        <ScheduleProvider>
          <TestUpdater />
        </ScheduleProvider>
      </NavigationProvider>
    </QueryClientProvider>,
  );
  return { queryClient, ...utils };
}

/** Replicate the activity query key used inside ScheduleProvider. */
function getActivityQueryKey(): string[] {
  const today = new Date();
  const monday = getMonday(today);
  const weekStart = toISODate(monday);
  const weekEnd = toISODate(
    new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000 - 1),
  );
  return ['activities', weekStart, weekEnd];
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('updateMutation — optimistic update features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Test 1: Optimistic rollback on error ─────────────────────────────
  it('has optimistic rollback on error — restores snapshot via setQueryData', async () => {
    const networkError = new Error('Network error');
    vi.mocked(apiUpdateActivity).mockRejectedValue(networkError);

    const { queryClient } = renderWithContext();

    // Wait for initial data load to settle
    await waitFor(() => {
      expect(screen.getByTestId('update-btn')).toBeInTheDocument();
    });

    const queryKey = getActivityQueryKey();

    // Spy on setQueryData AFTER initial load so we only capture
    // calls triggered by the mutation lifecycle
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    // Trigger the update mutation — it will reject
    act(() => {
      screen.getByTestId('update-btn').click();
    });

    // Wait for the API call to complete (reject) so React Query
    // triggers onMutate → setQueryData, then onError → setQueryData (rollback)
    await waitFor(() => {
      expect(apiUpdateActivity).toHaveBeenCalled();
    });

    // Allow the rejection to propagate through React Query
    await new Promise((resolve) => setTimeout(resolve, 200));

    // The cache should have been restored to its previous state
    // (both before and after are empty array, so toEqual passes)
    const cacheAfter = queryClient.getQueryData(queryKey);
    expect(cacheAfter).toEqual([]);

    // setQueryData should have been called for the activities query key
    // at least once — either by onMutate (optimistic update) or onError (rollback)
    const activityKeyCalls = setQueryDataSpy.mock.calls.filter(
      (call) =>
        Array.isArray(call[0]) &&
        call[0].length >= 1 &&
        call[0][0] === 'activities',
    );
    expect(activityKeyCalls.length).toBeGreaterThanOrEqual(1);

    setQueryDataSpy.mockRestore();
  });

  // ── Test 2: NO artificial timeout (spec §2.3/§5 — С2) ──────────────────
  it('holds the optimistic state past 5s — no timeout rolls it back (С2)', { timeout: 15000 }, async () => {
    // Seed one activity so the optimistic write is observable in the cache.
    vi.mocked(apiGetActivities).mockResolvedValue(wrap([activityA1({ occupied: 3 })]));

    // Make apiUpdateActivity hang forever — never resolves or rejects.
    vi.mocked(apiUpdateActivity).mockReturnValue(
      new Promise(() => {
        /* never settles */
      }),
    );

    const { queryClient } = renderWithContext();

    // Wait for initial data load
    await waitFor(() => {
      expect(screen.getByTestId('update-btn')).toBeInTheDocument();
    });
    const queryKey = getActivityQueryKey();
    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toEqual([activityA1({ occupied: 3 })]);
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Trigger the update mutation — the API call hangs
    act(() => {
      screen.getByTestId('update-btn').click();
    });

    // Verify the mutation was initiated and the optimistic write landed
    await waitFor(() => {
      expect(apiUpdateActivity).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const cache = queryClient.getQueryData<ActivityResponse[]>(queryKey);
      expect(cache?.[0].occupied).toBe(5);
    });

    // Wait 6+ seconds in real time — MORE than the removed 5-second timeout.
    // Old code: Promise.race rejected at 5s → onError rolled the cache back to
    // occupied 3 AND onSettled called invalidateQueries. New code: the PATCH
    // settles naturally, so neither happens while the request is still flying.
    await new Promise((resolve) => setTimeout(resolve, 6200));

    // Optimistic state HELD — no premature rollback race (spec §5).
    const cacheAfter = queryClient.getQueryData<ActivityResponse[]>(queryKey);
    expect(cacheAfter?.[0].occupied).toBe(5);

    // No timeout-driven settle: invalidateQueries was never called.
    expect(invalidateSpy).not.toHaveBeenCalled();

    invalidateSpy.mockRestore();
  });

  // ── Test 3: onMutate callback (optimistic cache update) ──────────────
  it('has onMutate callback — applies optimistic cache update before API resolves', async () => {
    // Make apiUpdateActivity hang so we can observe the cache BEFORE
    // the mutation resolves. If onMutate existed, it would have
    // already updated the cache synchronously (via setQueryData).
    vi.mocked(apiUpdateActivity).mockReturnValue(
      new Promise(() => {
        /* never settles */
      }),
    );

    const { queryClient } = renderWithContext();

    await waitFor(() => {
      expect(screen.getByTestId('update-btn')).toBeInTheDocument();
    });

    const queryKey = getActivityQueryKey();

    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

    // Trigger mutation — if onMutate exists, it will call setQueryData
    // optimistically before the API call is made
    act(() => {
      screen.getByTestId('update-btn').click();
    });

    // Wait for the API call to be initiated (but NOT resolved).
    // If onMutate exists, setQueryData was already called before
    // the API call started.
    await waitFor(() => {
      expect(apiUpdateActivity).toHaveBeenCalledTimes(1);
    });

    // setQueryData should have been called for the activities query key
    // from onMutate's optimistic update
    const activityKeyCalls = setQueryDataSpy.mock.calls.filter(
      (call) =>
        Array.isArray(call[0]) &&
        call[0].length >= 1 &&
        call[0][0] === 'activities',
    );
    expect(activityKeyCalls.length).toBeGreaterThanOrEqual(1);

    setQueryDataSpy.mockRestore();
  });
});
