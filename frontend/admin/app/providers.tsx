'use client';

import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { UIProvider, useUI } from '../contexts/UIContext';
import { UserSettingsProvider } from '../contexts/UserSettingsContext';
import { ClientsProvider } from '../contexts/ClientsContext';
import { ErrorBoundary } from './components/error';
import { ToastContainer } from './components/toast/ToastContainer';
import { parseApiError } from './lib/api/parseApiError';

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
        throwOnError: false,
      },
    },
  }));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <UIProvider>
        <QueryClientWithErrorReporting>
          <ClientsProvider>
            <UserSettingsProvider>
              {children}
            </UserSettingsProvider>
          </ClientsProvider>
        </QueryClientWithErrorReporting>
        <ToastContainer />
      </UIProvider>
    </ErrorBoundary>
  );
}
