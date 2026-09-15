/**
 * useSavingToast — REAL QueryClient integration (spec 2026-09-14-saving-toast D2).
 *
 * The hook watches schedule-activity mutations via `useMutationState` and
 * shows exactly one `loading` toast («Сохраняем…») for the whole in-flight
 * batch, removing it when the last mutation settles (success or error).
 * Drives a real mutation cache (built via `client.getMutationCache().build`)
 * so the status transitions are genuine TanStack v5 behavior. The harness
 * renders the hook next to the real ToastContainer — the same composition
 * Topbar provides in the app.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UIProvider, useUI } from '../contexts/UIContext';
import { SCHEDULE_ACTIVITY_MUTATION_KEY } from '@/contexts/schedule/ScheduleDataContext';
import { useSavingToast } from '../hooks/useSavingToast';
import { ToastContainer } from '../app/components/toast/ToastContainer';

vi.mock('@/contexts/schedule/ScheduleDataContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/schedule/ScheduleDataContext')>();
  return {
    ...actual,
    // Only the mutation key is needed; keep it real.
    useScheduleData: vi.fn(),
  };
});

// Harness component: renders the hook + real ToastContainer; captures the
// ids of the toasts currently in the stack (for the «new id» assertion).
let liveToastIds: string[] = [];

function HookHarness() {
  useSavingToast();
  const { toasts } = useUI();
  liveToastIds = toasts.map((t) => t.id);
  return <ToastContainer />;
}

// Conditional-render host: keeps UIProvider mounted while unmounting only
// the hook-bearing subtree (test е — non-vacuous unmount-cleanup pin).
function HookHostToggle() {
  const [mounted, setMounted] = React.useState(true);
  if (!mounted) return null;
  return (
    <>
      <HookHostMounter />
      <button data-testid="unmount-hook-host" onClick={() => setMounted(false)} />
    </>
  );
}

function HookHostMounter() {
  useSavingToast();
  return null;
}

describe('useSavingToast', () => {
  let client: QueryClient;
  const resolvers: Array<() => void> = [];
  const rejecters: Array<() => void> = [];

  function buildPendingMutation(key: readonly unknown[]): { resolve: () => void; reject: () => void } {
    let resolveFn: () => void = () => {};
    let rejectFn: () => void = () => {};
    const gate = new Promise<void>((resolve, reject) => { resolveFn = resolve; rejectFn = reject; });
    resolvers.push(resolveFn);
    rejecters.push(rejectFn);
    act(() => {
      client
        .getMutationCache()
        .build(client, { mutationKey: key, mutationFn: () => gate })
        .execute(undefined)
        // Expected in (г): a rejected mutation must not surface as an
        // unhandled rejection — the hook's rejection path is the subject.
        .catch(() => undefined);
    });
    return { resolve: resolveFn, reject: rejectFn };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resolvers.length = 0;
    rejecters.length = 0;
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  });

  afterEach(() => {
    // Settle any still-pending gate promises so nothing leaks between tests.
    resolvers.splice(0).forEach((resolve) => resolve());
    client.clear();
    vi.restoreAllMocks();
  });

  function renderHarness() {
    return render(
      <QueryClientProvider client={client}>
        <UIProvider>
          <HookHarness />
        </UIProvider>
      </QueryClientProvider>,
    );
  }

  it('(а) shows exactly one toast-loading while a schedule mutation is pending', async () => {
    renderHarness();
    expect(screen.queryByTestId('toast-loading')).not.toBeInTheDocument();

    buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);

    await waitFor(() => {
      expect(screen.getByTestId('toast-loading')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('toast-loading')).toHaveLength(1);
  });

  it('(б) shows still one toast for two parallel pending mutations', async () => {
    renderHarness();

    buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);
    buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);

    await waitFor(() => {
      expect(screen.getByTestId('toast-loading')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('toast-loading')).toHaveLength(1);
  });

  it('(в) removes the toast when all pending mutations resolve', async () => {
    renderHarness();

    const first = buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);
    const second = buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);
    await waitFor(() => {
      expect(screen.getByTestId('toast-loading')).toBeInTheDocument();
    });

    await act(async () => { first.resolve(); });
    // Second mutation still pending → toast stays.
    expect(screen.getByTestId('toast-loading')).toBeInTheDocument();

    await act(async () => { second.resolve(); });
    await waitFor(() => {
      expect(screen.queryByTestId('toast-loading')).not.toBeInTheDocument();
    });
  });

  it('(г) removes the toast when a mutation rejects', async () => {
    renderHarness();

    const failing = buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);
    await waitFor(() => {
      expect(screen.getByTestId('toast-loading')).toBeInTheDocument();
    });

    await act(async () => { failing.reject(); });
    await waitFor(() => {
      expect(screen.queryByTestId('toast-loading')).not.toBeInTheDocument();
    });
  });

  it('(д) shows a new toast (new id) for a fresh batch after settle', async () => {
    renderHarness();

    const first = buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);
    await waitFor(() => {
      expect(screen.getByTestId('toast-loading')).toBeInTheDocument();
    });
    const firstToastId = liveToastIds[0];

    await act(async () => { first.resolve(); });
    await waitFor(() => {
      expect(screen.queryByTestId('toast-loading')).not.toBeInTheDocument();
    });

    buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);
    await waitFor(() => {
      expect(screen.getByTestId('toast-loading')).toBeInTheDocument();
    });
    expect(liveToastIds[0]).toBeTruthy();
    expect(liveToastIds[0]).not.toBe(firstToastId);
  });

  it('(е) removes the toast when only the hook unmounts while a mutation is live', async () => {
    // ONE UIProvider stays mounted for the whole test — only the hook-hosting
    // child unmounts (state-driven conditional render). A loading toast has no
    // auto-dismiss timer, so it would linger forever without the hook's
    // unmount-cleanup effect; the fresh-provider probe would hide that.
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <UIProvider>
          <ToastContainer />
          <HookHostToggle />
        </UIProvider>
      </QueryClientProvider>,
    );

    buildPendingMutation(SCHEDULE_ACTIVITY_MUTATION_KEY);
    await waitFor(() => {
      expect(screen.getByTestId('toast-loading')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('unmount-hook-host'));
    await waitFor(() => {
      expect(screen.queryByTestId('toast-loading')).not.toBeInTheDocument();
    });

    unmount();
  });

  it('(ж) ignores mutations that do not carry the schedule-activity key', async () => {
    renderHarness();

    buildPendingMutation(['something-else']);
    await waitFor(() => {
      expect(client.getMutationCache().findAll({ mutationKey: ['something-else'] })).toHaveLength(1);
    });

    expect(screen.queryByTestId('toast-loading')).not.toBeInTheDocument();
  });
});
