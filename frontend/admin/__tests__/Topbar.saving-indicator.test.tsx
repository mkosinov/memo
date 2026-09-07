/**
 * Topbar saving indicator — REAL QueryClient integration (GH #141 spec §5).
 *
 * `__tests__/Topbar.test.tsx` mocks `useMutationState`, which cannot prove the
 * `select` callback matches TanStack v5's contract: `select` receives a Mutation
 * INSTANCE (`mutationId`/`state`/`options`/`gcTime`) — `isPending` does NOT exist
 * on it (that flag is derived in MutationObserver only). This suite drives a real
 * in-flight mutation on a real client so the chip's appearance is observable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Topbar } from '../app/components/layout/Topbar';
import { NavigationProvider } from '../contexts/NavigationContext';
import { SCHEDULE_ACTIVITY_MUTATION_KEY } from '@/contexts/schedule/ScheduleDataContext';

vi.mock('@/contexts/schedule/ScheduleDataContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/schedule/ScheduleDataContext')>();
  return {
    ...actual,
    useScheduleData: vi.fn(() => ({
      masters: [], services: [], locations: [], activities: [],
      scheduleIndex: { byId: new Map(), byDate: new Map(), byMasterId: new Map(), byLocation: { all: { byDate: new Map(), byServiceId: new Map() } } },
      loading: false, error: null,
      addActivity: vi.fn(), updateActivity: vi.fn(), deleteActivity: vi.fn(), copyLastWeek: vi.fn(),
      gridStartMinutes: 540, gridEndMinutes: 1260,
    })),
  };
});

vi.mock('@/contexts/schedule/ScheduleViewContext', () => ({
  useScheduleView: vi.fn(() => ({
    viewMode: 'week', setViewMode: vi.fn(),
    selectedDay: new Date(), setSelectedDay: vi.fn(),
    columnMode: 'masters', setColumnMode: vi.fn(),
    filterMasterIds: [], filterLocationIds: [],
    setFilterMasterIds: vi.fn(), setFilterLocationIds: vi.fn(),
    stamp: { masterId: null, serviceId: null, locations: new Set(), ready: false },
    setStamp: vi.fn(),
    currentWeek: new Date('2026-06-01'), setCurrentWeek: vi.fn(),
    prevPeriod: vi.fn(), nextPeriod: vi.fn(),
  })),
}));

vi.mock('@/contexts/schedule/GridSettingsContext', () => ({
  useGridSettings: vi.fn(() => ({
    cellHeight: 50, setCellHeight: vi.fn(),
    gridFrequency: 30, setGridFrequency: vi.fn(),
    workingHoursStart: 9, setWorkingHoursStart: vi.fn(),
    workingHoursEnd: 21, setWorkingHoursEnd: vi.fn(),
  })),
}));

describe('Topbar — saving indicator with a real QueryClient', () => {
  let client: QueryClient;
  let resolveMutation: () => void = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    resolveMutation = () => {};
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    client.clear();
    resolveMutation();
    vi.restoreAllMocks();
  });

  function renderTopbar() {
    return render(
      <QueryClientProvider client={client}>
        <NavigationProvider>
          <Topbar />
        </NavigationProvider>
      </QueryClientProvider>,
    );
  }

  it('shows the chip while a schedule-activity mutation is really pending, hides it on settle', async () => {
    renderTopbar();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    // A genuine in-flight mutation carrying the shared mutation key.
    const gate = new Promise<void>((resolve) => { resolveMutation = resolve; });
    act(() => {
      client
        .getMutationCache()
        .build(client, {
          mutationKey: SCHEDULE_ACTIVITY_MUTATION_KEY,
          mutationFn: () => gate,
        })
        .execute(undefined);
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Сохраняем');
    });

    await act(async () => { resolveMutation(); });
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
  });

  it('ignores mutations that do not carry the schedule-activity key', async () => {
    renderTopbar();

    const gate = new Promise<void>((resolve) => { resolveMutation = resolve; });
    act(() => {
      client
        .getMutationCache()
        .build(client, { mutationKey: ['something-else'], mutationFn: () => gate })
        .execute(undefined);
    });

    await waitFor(() => {
      expect(client.getMutationCache().findAll({ mutationKey: ['something-else'] })).toHaveLength(1);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
