import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import React from 'react';
import { ApiError } from '@memo/api-client';
import { useUI } from '../contexts/UIContext';
import {
  PendingActionsProvider,
  usePendingActions,
} from '../contexts/PendingActionsContext';

// Capture every call to useUI().showToast so tests can drive the undo button
// without depending on the real ToastContainer.
// #94: arity matches UIContext.showToast — (message, kindOrUndo, undoOrCountdownMs, countdownMs).
const showToastMock = vi.fn<
  (message: string, kindOrUndo?: unknown, undoOrCountdownMs?: unknown, countdownMs?: number) => void
>();

vi.mock('../contexts/UIContext', async () => {
  const actual = await vi.importActual<typeof import('../contexts/UIContext')>('../contexts/UIContext');
  return {
    ...actual,
    useUI: () => ({
      showToast: showToastMock,
      hideToast: vi.fn(),
    }),
  };
});

interface HarnessProps {
  onReady: (api: ReturnType<typeof usePendingActions>) => void;
}

function Harness({ onReady }: HarnessProps) {
  const api = usePendingActions();
  // Expose the hook value to the test via the ref-callback prop pattern.
  React.useEffect(() => {
    onReady(api);
  });
  return null;
}

function renderProvider() {
  const ref: { current: ReturnType<typeof usePendingActions> | null } = { current: null };
  const onReady = (a: ReturnType<typeof usePendingActions>) => {
    ref.current = a;
  };
  const utils = render(
    <PendingActionsProvider>
      <Harness onReady={onReady} />
    </PendingActionsProvider>,
  );
  if (!ref.current) throw new Error('Hook did not initialise');
  return { api: ref.current, ...utils };
}

beforeEach(() => {
  showToastMock.mockReset();
  showToastMock.mockImplementation(() => {});
  // Throw away the auto-generated id check by checking call order only.
  // We do NOT call vi.useFakeTimers() here so the static tests don't tick.
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PendingActionsContext', () => {
  it('exposes enqueuePendingAction from usePendingActions', () => {
    const { api } = renderProvider();
    expect(typeof api.enqueuePendingAction).toBe('function');
  });

  it('shows a toast with the action message, undo callback, and the countdown window', () => {
    const { api } = renderProvider();
    const undo = vi.fn();
    const commit = vi.fn().mockResolvedValue(undefined);

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
      });
    });

    // #94: enqueuePendingAction hands the undo window (delayMs) to the toast as
    // `countdownMs` (4th arg). 3rd arg stays undefined — the kind slot is unused
    // on the kindless-undo path. Both consumers (visits/payments) use 5000.
    expect(showToastMock).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(
      'Удалено. Отменить',
      expect.any(Function),
      undefined,
      5000,
    );
  });

  it('calls commit after the delay has elapsed (no undo)', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    const commit = vi.fn().mockResolvedValue(undefined);
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
      });
    });

    expect(commit).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
  });

  it('invoking the undo callback cancels commit and restores state', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    const commit = vi.fn().mockResolvedValue(undefined);
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
      });
    });

    // Grab the undo callback the provider handed to showToast
    const undoCb = showToastMock.mock.calls[0][1] as () => void;

    act(() => {
      undoCb();
    });

    expect(undo).toHaveBeenCalledTimes(1);

    // Even if we advance past the original delay, commit must NOT run.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(commit).not.toHaveBeenCalled();
  });

  it('enqueueing the same id twice cancels the first timer (commit called once)', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    const commit1 = vi.fn().mockResolvedValue(undefined);
    const commit2 = vi.fn().mockResolvedValue(undefined);
    const undo1 = vi.fn();
    const undo2 = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit: commit1,
        undo: undo1,
      });
    });

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1', // same id — first timer must be cancelled
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit: commit2,
        undo: undo2,
      });
    });

    // Only the second toast should be live.
    expect(showToastMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(commit1).not.toHaveBeenCalled();
    expect(commit2).toHaveBeenCalledTimes(1);
  });

  it('the timer survives across re-renders of consumers (provider is app-level)', async () => {
    vi.useFakeTimers();
    let setTick: (n: number) => void = () => {};
    const { api } = renderProvider();

    function Flapper() {
      const [, setN] = React.useState(0);
      setTick = setN;
      return <div data-testid="flap">flap</div>;
    }

    render(
      <PendingActionsProvider>
        <Harness onReady={() => {}} />
        <Flapper />
      </PendingActionsProvider>,
    );

    // Bypass the first render: use the api we already have.
    const commit = vi.fn().mockResolvedValue(undefined);

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-2',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo: vi.fn(),
      });
    });

    // Force a re-render
    act(() => {
      setTick(1);
    });

    expect(screen.getByTestId('flap')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('throws when usePendingActions is used outside the provider', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Broken() {
      usePendingActions();
      return null;
    }
    expect(() => render(<Broken />)).toThrow(
      'usePendingActions must be used within PendingActionsProvider',
    );
    errSpy.mockRestore();
  });
});

// ── #285 D4 (rev8): commit failure handling in the shared pipeline ──────────
describe('PendingActionsContext commit error handling (#285 D4)', () => {
  beforeEach(() => {
    showToastMock.mockReset();
    showToastMock.mockImplementation(() => {});
  });

  it('(а) commit resolves — nothing happens (no undo, no error toast)', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    const commit = vi.fn().mockResolvedValue(undefined);
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(commit).toHaveBeenCalledTimes(1);
    expect(undo).not.toHaveBeenCalled();
    // Only the enqueue-time undo toast — no error toast afterwards.
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });

  it('(б) commit throws ApiError 404 — quiet success: no undo, no error toast', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    const commit = vi.fn().mockRejectedValue(new ApiError(404, 'not found'));
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // 404 = the record is already deleted by a competitor — the commit goal is
    // achieved. No undo, no toast, no unhandled rejection.
    expect(undo).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });

  it('(в) commit throws ApiError 500 — default path: undo + error toast', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    const commit = vi.fn().mockRejectedValue(new ApiError(500, 'boom'));
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(undo).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(
      'Не удалось удалить. Изменение отменено',
      'error',
    );
  });

  it('(д) commit throws non-ApiError (no server response) — undo + honest toast «Не удалось подтвердить удаление»', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    // Network failure / abort / timeout — the server never answered, so the
    // deletion outcome is unknown (#243 S3): the row returns, but the text
    // must NOT claim «Изменение отменено».
    const commit = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(undo).toHaveBeenCalledTimes(1);
    expect(showToastMock).toHaveBeenCalledWith(
      'Не удалось подтвердить удаление',
      'error',
    );
    expect(showToastMock).not.toHaveBeenCalledWith(
      'Не удалось удалить. Изменение отменено',
      'error',
    );
  });

  it('(г) action with custom onError — onError receives the raw error; default path suppressed', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    const failure = new Error('boom');
    const commit = vi.fn().mockRejectedValue(failure);
    const onError = vi.fn();
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
        onError,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(failure);
    // Default handling (undo + error toast) must NOT run.
    expect(undo).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });

  it('(rev8) custom onError does not fire on 404 — quiet success is domain-independent', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    const commit = vi.fn().mockRejectedValue(new ApiError(404, 'not found'));
    const onError = vi.fn();
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
        onError,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // D4 rev8: 404 = the commit goal is achieved regardless of onError —
    // neither the custom handler nor the default path runs.
    expect(onError).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });

  it('(rev8) undo is gated during an in-flight commit: undo after commit started is a no-op', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    let resolveCommit!: () => void;
    const commit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve;
        }),
    );
    const undo = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit,
        undo,
      });
    });

    // Fire the timer: the pending entry is removed BEFORE commit() is awaited,
    // so the commit DELETE is now in flight while the toast is still visible.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(commit).toHaveBeenCalledTimes(1);

    // The user clicks «Отменить» while the commit is in flight. The server has
    // (or will have) deleted the row — a local undo would resurrect it.
    const undoCb = showToastMock.mock.calls[0][1] as () => void;
    act(() => {
      undoCb();
    });

    expect(undo).not.toHaveBeenCalled();

    // The in-flight commit finishes without error — no default error path.
    await act(async () => {
      resolveCommit();
    });
    expect(showToastMock).toHaveBeenCalledTimes(1);
  });

  it('(rev8) re-enqueue after a commit started gets a fresh undo window', async () => {
    vi.useFakeTimers();
    const { api } = renderProvider();
    let resolveFirst!: () => void;
    const commit1 = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    const undo1 = vi.fn();
    const commit2 = vi.fn().mockResolvedValue(undefined);
    const undo2 = vi.fn();

    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit: commit1,
        undo: undo1,
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(commit1).toHaveBeenCalledTimes(1);

    // Same id re-enqueued while the first commit is still in flight — the new
    // action gets its own entry and its own working undo.
    act(() => {
      api.enqueuePendingAction({
        id: 'rec-1',
        kind: 'delete',
        message: 'Удалено. Отменить',
        delayMs: 5000,
        commit: commit2,
        undo: undo2,
      });
    });

    const undoCb2 = showToastMock.mock.calls[1][1] as () => void;
    act(() => {
      undoCb2();
    });
    expect(undo2).toHaveBeenCalledTimes(1);

    // The cancelled second timer never fires its commit.
    await act(async () => {
      resolveFirst();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(commit2).not.toHaveBeenCalled();
  });
});
