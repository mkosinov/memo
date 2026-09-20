import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { ApiError } from '@memo/api-client';
import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { useUI } from '@/contexts/UIContext';
import { createMockUIContext } from './helpers/mockContexts';
import { setChannelDown } from '../app/lib/connectionHealth';

/**
 * GH #330 Task 5 — behaviour of the app QueryClient configured in
 * app/providers.tsx (spec §5.4 dedup gate, §5.7 retry predicate):
 *
 * - transport-error toast (TypeError / TimeoutError / AbortError) is
 *   suppressed while the SSE channel is down; the console.error diagnostic
 *   still fires (the gate sits AFTER it);
 * - ApiError toasts (incl. 401/403) are NEVER suppressed (isNetworkError is
 *   false for ApiError by the Task 1 contract);
 * - meta.silent queries stay fully silent (pre-existing, pinned);
 * - retry: failureCount < 2 && !isAbortClass(error) — aborted/timed-out
 *   fetches are not retried (each retry would get a fresh timeout window
 *   and drag the toast out to ~90–95 s); TypeError keeps the old retries
 *   (network blip + delay closes the dedup race window, spec R3).
 *
 * The client is exercised the way the real tree mounts it: render
 * QueryClientWithErrorReporting from providers.tsx (ServerEventsProvider
 * stubbed into a pass-through — its behaviour is covered by
 * ServerEventsProvider.test.tsx) and capture the created QueryClient via
 * useQueryClient(). Sibling context/component mocks exist because
 * providers.tsx imports them at module level (they mount only under the
 * full Providers tree).
 *
 * connectionHealth is the REAL module (plain module flag) — flipped via
 * setChannelDown exactly like ServerEventsProvider does in production.
 */

vi.mock('@/contexts/UIContext', () => ({
  useUI: vi.fn(),
  UIProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../contexts/UserSettingsContext', () => ({
  UserSettingsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../contexts/PendingActionsContext', () => ({
  PendingActionsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../app/ServerEventsProvider', () => ({
  ServerEventsProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../app/components/error', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../app/components/toast/ToastContainer', () => ({
  ToastContainer: () => null,
}));

import { Providers } from '../app/providers';

const mockUseUI = vi.mocked(useUI);

function timeoutError(): Error {
  const err = new Error('Signal timed out');
  err.name = 'TimeoutError';
  return err;
}

function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

async function renderTree(): Promise<QueryClient> {
  let qc!: QueryClient;
  function Probe() {
    qc = useQueryClient();
    return null;
  }
  render(
    <Providers>
      <Probe />
    </Providers>,
  );
  await waitFor(() => expect(qc).toBeTruthy());
  return qc;
}

/** fetchQuery that fails fast: per-call retry:false skips retry delays. */
function failFetch(
  qc: QueryClient,
  key: string,
  err: Error,
  meta?: Record<string, unknown>,
): Promise<unknown> {
  return qc
    .fetchQuery({
      queryKey: [key],
      queryFn: () => Promise.reject(err),
      retry: false,
      ...(meta ? { meta } : {}),
    })
    .catch(() => undefined);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  setChannelDown(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  setChannelDown(false);
});

describe('QueryClient transport-toast dedup gate (GH #330 §5.4)', () => {
  it('TypeError + channel down → NO toast, console.error still fires', async () => {
    const showToast = vi.fn();
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: showToast as never }));
    const qc = await renderTree();

    setChannelDown(true);
    await failFetch(qc, 'gate-1', new TypeError('Failed to fetch'));
    await waitFor(() => expect(console.error).toHaveBeenCalled());

    expect(console.error).toHaveBeenCalledWith(
      '[Query]',
      ['gate-1'],
      expect.any(TypeError),
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it('TimeoutError + channel down → NO toast, console.error still fires', async () => {
    const showToast = vi.fn();
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: showToast as never }));
    const qc = await renderTree();

    setChannelDown(true);
    await failFetch(qc, 'gate-2', timeoutError());
    await waitFor(() => expect(console.error).toHaveBeenCalled());

    expect(showToast).not.toHaveBeenCalled();
  });

  it('TypeError + channel UP → toast IS shown (gate inactive)', async () => {
    const showToast = vi.fn();
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: showToast as never }));
    const qc = await renderTree();

    await failFetch(qc, 'gate-3', new TypeError('Failed to fetch'));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Ошибка сети', 'error'));
  });

  it('ApiError (403) + channel down → toast STILL shown (never gated)', async () => {
    const showToast = vi.fn();
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: showToast as never }));
    const qc = await renderTree();

    setChannelDown(true);
    await failFetch(qc, 'gate-4', new ApiError(403, 'Insufficient rights'));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Insufficient rights', 'error'),
    );
  });

  it('meta.silent → no console.error, no toast', async () => {
    const showToast = vi.fn();
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: showToast as never }));
    const qc = await renderTree();

    await failFetch(qc, 'gate-5', new TypeError('Failed to fetch'), { silent: true });

    expect(showToast).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });
});

describe('QueryClient retry predicate (GH #330 §5.7)', () => {
  type RetryFn = (failureCount: number, error: unknown) => boolean;

  async function retryFn(): Promise<RetryFn> {
    const qc = await renderTree();
    const retry = qc.getDefaultOptions().queries?.retry;
    expect(typeof retry, 'retry must be a predicate function').toBe('function');
    return retry as RetryFn;
  }

  it('AbortError → never retried, even at failureCount 0', async () => {
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: vi.fn() as never }));
    const retry = await retryFn();
    expect(retry(0, abortError())).toBe(false);
    expect(retry(1, abortError())).toBe(false);
  });

  it('TimeoutError → never retried, even at failureCount 0', async () => {
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: vi.fn() as never }));
    const retry = await retryFn();
    expect(retry(0, timeoutError())).toBe(false);
    expect(retry(1, timeoutError())).toBe(false);
  });

  it('TypeError → retried while failureCount < 2 (boundary at 2)', async () => {
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: vi.fn() as never }));
    const retry = await retryFn();
    expect(retry(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retry(1, new TypeError('Failed to fetch'))).toBe(true);
    expect(retry(2, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('ApiError → retried while failureCount < 2, same as before', async () => {
    mockUseUI.mockReturnValue(createMockUIContext({ showToast: vi.fn() as never }));
    const retry = await retryFn();
    expect(retry(0, new ApiError(500, 'Server error'))).toBe(true);
    expect(retry(1, new ApiError(500, 'Server error'))).toBe(true);
    expect(retry(2, new ApiError(500, 'Server error'))).toBe(false);
  });
});
