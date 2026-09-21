import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServerEventsProvider } from '../app/ServerEventsProvider';
import { useUI } from '@/contexts/UIContext';
import { eventsUrl, getTabId } from '@memo/api-client';
import { createMockUIContext } from './helpers/mockContexts';
import { setChannelDown, isChannelDown } from '../app/lib/connectionHealth';

/**
 * Unit tests for ServerEventsProvider (GH #239, spec §4.2/§4.3/§5):
 * origin suppression, burst-collapse toast, reconnect blanket invalidation,
 * malformed-frame tolerance, unmount cleanup.
 *
 * GH #330 (spec §5.1/§5.2): connection-loss detection — 5 s debounce to a
 * single persistent toast, fatal CLOSED vs recoverable CONNECTING errors,
 * connectionHealth flag hygiene, toast/timer cleanup.
 */

// ─── Mocked EventSource (class capturing handlers) ─────────────────────────

type Handler = (ev: unknown) => void;

const READY_STATE_CONNECTING = 0;
const READY_STATE_CLOSED = 2;

class MockEventSource {
  static instances: MockEventSource[] = [];
  static CONNECTING = READY_STATE_CONNECTING;
  static CLOSED = READY_STATE_CLOSED;
  url: string;
  readyState: number = READY_STATE_CONNECTING;
  onopen: Handler | null = null;
  onerror: Handler | null = null;
  onmessage: Handler | null = null;
  listeners = new Map<string, Handler[]>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: Handler): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
    this.readyState = READY_STATE_CLOSED;
  }

  // Test drivers
  emit(type: string, data: string): void {
    for (const h of this.listeners.get(type) ?? []) h({ data });
  }

  open(): void {
    this.readyState = READY_STATE_CONNECTING;
    this.onopen?.({});
  }

  error(): void {
    this.onerror?.({});
  }

  /** Recoverable failure — browser will retry (spec §5.1 CONNECTING). */
  errorRecoverable(): void {
    this.readyState = READY_STATE_CONNECTING;
    this.onerror?.({});
  }

  /** Fatal closure — HTTP 401 / proxy refusal (spec §5.1 CLOSED). */
  errorFatal(): void {
    this.readyState = READY_STATE_CLOSED;
    this.onerror?.({});
  }
}

vi.mock('@memo/api-client', () => ({
  eventsUrl: 'http://test/api/v1/events',
  getTabId: vi.fn(() => 'me'),
}));

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
}));

import { invalidateEntities } from '@/lib/invalidate';

vi.mock('@/lib/invalidate', () => ({
  invalidateEntities: vi.fn(),
}));

const mockUseUI = vi.mocked(useUI);

function renderProvider() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const qcSpy = {
    invalidateQueries: vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(),
  };
  void qcSpy;
  // Real UIContext.showToast always returns a toast id — mirror the contract
  // (the provider stores it to hide exactly this toast later).
  const showToast = vi.fn(() => 'toast-id');
  const hideToast = vi.fn();
  mockUseUI.mockReturnValue(
    createMockUIContext({ showToast: showToast as never, hideToast: hideToast as never }),
  );
  const rendered = render(
    <QueryClientProvider client={qc}>
      <ServerEventsProvider>{null}</ServerEventsProvider>
    </QueryClientProvider>,
  );
  return { qc, showToast, hideToast, unmount: () => rendered.unmount() };
}

function lastInstance(): MockEventSource {
  return MockEventSource.instances[MockEventSource.instances.length - 1];
}

function invalidateFrame(
  entities: string[],
  origin: { type: string; id: string } | null,
): string {
  return JSON.stringify({ entities, origin });
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.clearAllMocks();
  vi.mocked(getTabId).mockReturnValue('me');
  vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
  setChannelDown(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ServerEventsProvider', () => {
  it('opens EventSource on the events URL', () => {
    renderProvider();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(lastInstance().url).toBe('http://test/api/v1/events');
  });

  it('own-origin event → invalidates families, NO toast', () => {
    const { showToast } = renderProvider();
    act(() => {
      lastInstance().emit('invalidate', invalidateFrame(['records'], { type: 'tab', id: 'me' }));
    });
    expect(invalidateEntities).toHaveBeenCalledWith(expect.anything(), ['records']);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('external origin (other tab) → invalidates AND shows info toast', () => {
    const { showToast } = renderProvider();
    act(() => {
      lastInstance().emit('invalidate', invalidateFrame(['records'], { type: 'tab', id: 'other' }));
    });
    expect(invalidateEntities).toHaveBeenCalledWith(expect.anything(), ['records']);
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('Данные обновлены', 'info');
  });

  it('null origin (API without tab header) → invalidates AND shows info toast', () => {
    const { showToast } = renderProvider();
    act(() => {
      lastInstance().emit('invalidate', invalidateFrame(['activities'], null));
    });
    expect(invalidateEntities).toHaveBeenCalledWith(expect.anything(), ['activities']);
    expect(showToast).toHaveBeenCalledWith('Данные обновлены', 'info');
  });

  it('burst of external events collapses into ONE toast', async () => {
    vi.useFakeTimers();
    const { showToast } = renderProvider();
    act(() => {
      const es = lastInstance();
      es.emit('invalidate', invalidateFrame(['records'], { type: 'tab', id: 'other' }));
      es.emit('invalidate', invalidateFrame(['tags'], { type: 'tab', id: 'other' }));
      es.emit('invalidate', invalidateFrame(['clients'], null));
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    // A new burst AFTER the collapse window fires a new toast
    act(() => {
      vi.advanceTimersByTime(1100);
      lastInstance().emit('invalidate', invalidateFrame(['records'], { type: 'tab', id: 'other' }));
    });
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it('burst within own-origin suppression never toasts', () => {
    vi.useFakeTimers();
    const { showToast } = renderProvider();
    act(() => {
      const es = lastInstance();
      es.emit('invalidate', invalidateFrame(['records'], { type: 'tab', id: 'me' }));
      es.emit('invalidate', invalidateFrame(['tags'], { type: 'tab', id: 'me' }));
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('reconnect (OPEN after error) → blanket invalidateQueries, NO toast', () => {
    const { qc, showToast } = renderProvider();
    act(() => {
      lastInstance().error();
    });
    act(() => {
      lastInstance().open();
    });
    expect(qc.invalidateQueries).toHaveBeenCalledWith(); // no args = blanket
    expect(showToast).not.toHaveBeenCalled();
  });

  it('error alone does not blanket-invalidate', () => {
    const { qc } = renderProvider();
    act(() => {
      lastInstance().error();
    });
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  it('malformed frame → no crash, no toast, no invalidation', () => {
    const { showToast } = renderProvider();
    expect(() =>
      act(() => {
        lastInstance().emit('invalidate', '{not json');
      }),
    ).not.toThrow();
    expect(showToast).not.toHaveBeenCalled();
    expect(invalidateEntities).not.toHaveBeenCalled();
  });

  it('unmount closes the EventSource', () => {
    const { unmount } = renderProvider();
    const es = lastInstance();
    unmount();
    expect(es.closed).toBe(true);
  });

  it('subscribes to the invalidate event by name', () => {
    renderProvider();
    expect(lastInstance().listeners.has('invalidate')).toBe(true);
  });
});

describe('ServerEventsProvider — connection loss (GH #330 §5.1/§5.2)', () => {
  it('mount resets the channel-down flag', () => {
    setChannelDown(true);
    renderProvider();
    expect(isChannelDown()).toBe(false);
  });

  it('recoverable error → flag down-state set, no toast before 5 s debounce', () => {
    vi.useFakeTimers();
    const { showToast } = renderProvider();
    act(() => {
      lastInstance().errorRecoverable();
    });
    expect(isChannelDown()).toBe(true);
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it('connection lost ≥ 5 s → exactly ONE persistent error toast', () => {
    vi.useFakeTimers();
    const { showToast } = renderProvider();
    act(() => {
      lastInstance().errorRecoverable();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    // showToast(message, kind, undo, countdownMs, action, persistent)
    expect(showToast).toHaveBeenCalledWith(
      'Нет соединения с сервером. Обновления приостановлены.',
      'error',
      undefined,
      undefined,
      undefined,
      true,
    );
    // Toast id must be captured for hideToast — simulate the provider wiring
    // by checking repeated errors never spawn a second toast.
    act(() => {
      lastInstance().errorRecoverable();
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('flap shorter than 5 s (error → open) → no toast, flag reset', () => {
    vi.useFakeTimers();
    const { showToast } = renderProvider();
    act(() => {
      lastInstance().errorRecoverable();
    });
    act(() => {
      vi.advanceTimersByTime(2000);
      lastInstance().open();
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(showToast).not.toHaveBeenCalled();
    expect(isChannelDown()).toBe(false);
  });

  it('reconnect after toast shown → hides the toast, resets flag, no second debounce', () => {
    vi.useFakeTimers();
    const { showToast, hideToast } = renderProvider();
    let toastId = 'unset';
    showToast.mockImplementation(() => {
      toastId = 'toast-from-show';
      return toastId;
    });
    act(() => {
      lastInstance().errorRecoverable();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    act(() => {
      lastInstance().open();
    });
    expect(hideToast).toHaveBeenCalledWith(toastId);
    expect(isChannelDown()).toBe(false);
    // Timer cancelled: no further toast without a new error.
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('fatal closure (readyState CLOSED, e.g. 401) → NO toast, flag stays up=false', () => {
    vi.useFakeTimers();
    const { showToast } = renderProvider();
    act(() => {
      lastInstance().errorRecoverable();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
      lastInstance().errorFatal();
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(showToast).not.toHaveBeenCalled();
    expect(isChannelDown()).toBe(false);
  });

  it('fatal closure after toast shown → hides the toast and resets flag', () => {
    vi.useFakeTimers();
    const { showToast, hideToast } = renderProvider();
    showToast.mockImplementation(() => 'toast-fatal-case');
    act(() => {
      lastInstance().errorRecoverable();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      lastInstance().errorFatal();
    });
    expect(hideToast).toHaveBeenCalledWith('toast-fatal-case');
    expect(isChannelDown()).toBe(false);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('repeated recoverable errors while down do not restart the debounce', () => {
    vi.useFakeTimers();
    const { showToast } = renderProvider();
    act(() => {
      lastInstance().errorRecoverable();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
      lastInstance().errorRecoverable();
    });
    // 3 s since the SECOND error would be < 5 s — but the debounce started
    // at the FIRST error, so the toast is already due at t=5 s from t0.
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it('unmount clears pending debounce timer and shown toast', () => {
    vi.useFakeTimers();
    const { showToast, hideToast, unmount } = renderProvider();
    showToast.mockImplementation(() => 'toast-unmount');
    // Pending debounce (not yet fired) + then a shown toast case:
    act(() => {
      lastInstance().errorRecoverable();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    // A second pending debounce window for the unmount cleanup check.
    act(() => {
      lastInstance().open();
    });
    act(() => {
      lastInstance().errorRecoverable();
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(showToast).toHaveBeenCalledTimes(1); // pending timer was cleared
    expect(hideToast).toHaveBeenCalledWith('toast-unmount'); // toast hidden
  });
});
