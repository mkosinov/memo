'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { UIProvider } from '../contexts/UIContext';
import { ToastContainer } from './components/toast/ToastContainer';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 2,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        {children}
        <ToastContainer />
      </UIProvider>
    </QueryClientProvider>
  );
}
