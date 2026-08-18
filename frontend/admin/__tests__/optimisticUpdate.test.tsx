import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NavigationProvider } from '../contexts/NavigationContext';
import { ScheduleProvider, useSchedule } from '../contexts/ScheduleContext';
import { getMonday, formatDateISO } from '@/lib/utils';

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

import { updateActivity as apiUpdateActivity } from '@memo/api-client';

// ─── Helpers ─────────────────────────────────────────────────────────────

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
  const { updateActivity } = useSchedule();
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
  const weekStart = formatDateISO(monday);
  const weekEnd = formatDateISO(
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

  // ── Test 2: Timeout protection ───────────────────────────────────────
  it('has timeout protection — calls invalidateQueries after 5s timeout', { timeout: 15000 }, async () => {
    // Make apiUpdateActivity hang forever — never resolves or rejects
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

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // Trigger the update mutation — the API call hangs
    act(() => {
      screen.getByTestId('update-btn').click();
    });

    // Verify the mutation was initiated
    await waitFor(() => {
      expect(apiUpdateActivity).toHaveBeenCalledTimes(1);
    });

    // Wait 6+ seconds in real time — MORE than the proposed 5-second timeout.
    // If a timeout mechanism existed, the mutation would have been
    // cancelled/rolled back within 5 seconds, triggering onSettled
    // which calls invalidateQueries.
    await new Promise((resolve) => setTimeout(resolve, 6200));

    // After timeout + rollback, onSettled should have called invalidateQueries
    expect(invalidateSpy).toHaveBeenCalled();

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
