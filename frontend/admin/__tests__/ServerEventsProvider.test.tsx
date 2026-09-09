import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServerEventsProvider } from '../app/ServerEventsProvider';
import { useUI } from '@/contexts/UIContext';
import { eventsUrl, getTabId } from '@memo/api-client';
import { createMockUIContext } from './helpers/mockContexts';

/**
 * Unit tests for ServerEventsProvider (GH #239, spec §4.2/§4.3/§5):
 * origin suppression, burst-collapse toast, reconnect blanket invalidation,
 * malformed-frame tolerance, unmount cleanup.
 */

// ─── Mocked EventSource (class capturing handlers) ─────────────────────────

type Handler = (ev: unknown) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
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
  }

  // Test drivers
  emit(type: string, data: string): void {
    for (const h of this.listeners.get(type) ?? []) h({ data });
  }

  open(): void {
    this.onopen?.({});
  }

  error(): void {
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
  const showToast = vi.fn();
  mockUseUI.mockReturnValue(
    createMockUIContext({ showToast: showToast as never }),
  );
  const rendered = render(
    <QueryClientProvider client={qc}>
      <ServerEventsProvider>{null}</ServerEventsProvider>
    </QueryClientProvider>,
  );
  return { qc, showToast, unmount: () => rendered.unmount() };
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
