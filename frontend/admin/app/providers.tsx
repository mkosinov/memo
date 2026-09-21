'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { UIProvider, useUI } from '../contexts/UIContext';
import { AuthProvider } from '../contexts/AuthContext';
import { UserSettingsProvider } from '../contexts/UserSettingsContext';
import { PendingActionsProvider } from '../contexts/PendingActionsContext';
import { ErrorBoundary } from './components/error';
import { ToastContainer } from './components/toast/ToastContainer';
import { parseApiError, isNetworkError, isAbortClass } from './lib/api/parseApiError';
import { isChannelDown } from './lib/connectionHealth';
import { ServerEventsProvider } from './ServerEventsProvider';

function QueryClientWithErrorReporting({ children }: { children: React.ReactNode }) {
  const { showToast } = useUI();
  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        // Silent queries (meta.silent === true) skip the toast
        if ((query.meta as { silent?: boolean } | undefined)?.silent) return;
        console.error('[Query]', query.queryKey, err);
        // GH #330 §5.4: while the SSE channel is down, the persistent
        // connection-loss toast is already on screen — a per-query
        // transport toast would duplicate it. Suppress ONLY transport-class
        // errors (TypeError/Timeout/Abort); ApiError (4xx/5xx, incl.
        // 401/403) is never a connection loss and always keeps its toast.
        // The gate sits AFTER console.error — diagnostics are not muted.
        if (isNetworkError(err) && isChannelDown()) return;
        const { message } = parseApiError(err);
        showToast(message, 'error');
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // GH #330 §5.7: aborted/timed-out requests are NOT retried — each
        // retry would get a fresh timeout window and drag the eventual
        // error toast out to ~90–95 s. TypeError (network blip) keeps the
        // old < 2 retries: blip + retry delay closes the dedup-gate race
        // window (R3). Same numeric budget as the previous `retry: 2`.
        retry: (failureCount, error) => failureCount < 2 && !isAbortClass(error),
        refetchOnWindowFocus: false,
        // GH #239: reconnect convergence is owned by the SSE channel
        // (ServerEventsProvider blanket-invalidates on reconnect). TanStack's
        // own onlineManager refetch would converge data even with a dead
        // channel and mask channel failures — disabled so the channel is
        // genuinely the mechanism (spec §4.2/§5). Residual uncovered case: a
        // network blip while the SSE channel is dead/unrecoverable (REST
        // works, EventSource never reopens) — no auto-convergence until
        // remount/manual invalidation; accepted spec trade-off (channel
        // failure must not be masked).
        refetchOnReconnect: false,
        throwOnError: false,
      },
    },
  }));
  return (
    // GH #239: SSE consumer lives INSIDE the QueryClientProvider subtree
    // (useQueryClient) and BELOW UIProvider (useUI → showToast).
    <QueryClientProvider client={queryClient}>
      <ServerEventsProvider>
        {children}
      </ServerEventsProvider>
    </QueryClientProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <UIProvider>
        {/* GH #247 §4.3: AuthProvider INSIDE UIProvider (its 401 handler +
            future consumers may toast) and ABOVE UserSettingsProvider (T13
            reads the session user from inside UserSettingsContext). */}
        <AuthProvider>
          <QueryClientWithErrorReporting>
            <PendingActionsProvider>
              <UserSettingsProvider>
                {children}
              </UserSettingsProvider>
            </PendingActionsProvider>
          </QueryClientWithErrorReporting>
          <ToastContainer />
        </AuthProvider>
      </UIProvider>
    </ErrorBoundary>
  );
}
