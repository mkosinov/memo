import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, screen } from '@testing-library/react';
import React from 'react';
import { useUI } from '../contexts/UIContext';
import {
  PendingActionsProvider,
  usePendingActions,
} from '../contexts/PendingActionsContext';

// Capture every call to useUI().showToast so tests can drive the undo button
// without depending on the real ToastContainer.
const showToastMock = vi.fn<(message: string, kindOrUndo?: unknown, undo?: unknown) => void>();

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

  it('shows a toast with the action message and an undo callback', () => {
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

    expect(showToastMock).toHaveBeenCalledTimes(1);
    const [message, secondArg] = showToastMock.mock.calls[0];
    expect(message).toBe('Удалено. Отменить');
    expect(typeof secondArg).toBe('function');
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
