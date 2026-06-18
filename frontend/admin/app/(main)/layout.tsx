'use client';

import React from 'react';
import { Menubar } from '../components/layout/Menubar';
import { NavigationProvider } from '@/contexts/NavigationContext';
import { useUI } from '@/contexts/UIContext';
import { ErrorBoundary } from '../components/error';

function MainShell({ children }: { children: React.ReactNode }) {
  const { sidebarCollapsed } = useUI();

  return (
    <div className="flex h-screen overflow-hidden">
      <Menubar />
      <div
        data-testid="center-content"
        className="flex-1 flex flex-col min-w-0 transition-all duration-300"
        style={{
          marginLeft: sidebarCollapsed
            ? 'var(--sidebar-collapsed-w)'
            : 'var(--sidebar-w)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <NavigationProvider>
        <MainShell>{children}</MainShell>
      </NavigationProvider>
    </ErrorBoundary>
  );
}
