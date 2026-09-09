'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { UIProvider, useUI } from '../contexts/UIContext';
import { UserSettingsProvider } from '../contexts/UserSettingsContext';
import { PendingActionsProvider } from '../contexts/PendingActionsContext';
import { ErrorBoundary } from './components/error';
import { ToastContainer } from './components/toast/ToastContainer';
import { parseApiError } from './lib/api/parseApiError';
import { ServerEventsProvider } from './ServerEventsProvider';

function QueryClientWithErrorReporting({ children }: { children: React.ReactNode }) {
  const { showToast } = useUI();
  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({
      onError: (err, query) => {
        // Silent queries (meta.silent === true) skip the toast
        if ((query.meta as { silent?: boolean } | undefined)?.silent) return;
        console.error('[Query]', query.queryKey, err);
        const { message } = parseApiError(err);
        showToast(message, 'error');
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 2,
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
        <QueryClientWithErrorReporting>
          <PendingActionsProvider>
            <UserSettingsProvider>
              {children}
            </UserSettingsProvider>
          </PendingActionsProvider>
        </QueryClientWithErrorReporting>
        <ToastContainer />
      </UIProvider>
    </ErrorBoundary>
  );
}
