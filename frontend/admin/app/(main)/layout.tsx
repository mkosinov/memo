'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Menubar } from '../components/layout/Menubar';
import { NavigationProvider } from '@/contexts/NavigationContext';
import { useUI } from '@/contexts/UIContext';
import { useAuth } from '@/contexts/AuthContext';
import { ErrorBoundary } from '../components/error';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  // Client-side guard (GH #247 spec §4.4 — no middleware: the session cookie
  // is opaque and cannot be verified at the edge). loading → spinner shell;
  // guest → /login with the current location in returnTo; content is withheld
  // in both cases so nothing flashes before the redirect lands.
  React.useEffect(() => {
    if (status === 'guest') {
      const current = `${window.location.pathname}${window.location.search}`;
      router.replace(`/login?returnTo=${encodeURIComponent(current)}`);
    }
  }, [status, router]);

  if (status === 'loading') {
    return (
      <div
        data-testid="auth-loading"
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: 'var(--bg)' }}
      >
        <div
          className="w-8 h-8 rounded-full animate-spin"
          style={{
            border: '3px solid var(--line)',
            borderTopColor: 'var(--brand)',
          }}
        />
      </div>
    );
  }

  if (status === 'guest') {
    return null;
  }

  return <>{children}</>;
}

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
      <AuthGate>
        <NavigationProvider>
          <MainShell>{children}</MainShell>
        </NavigationProvider>
      </AuthGate>
    </ErrorBoundary>
  );
}
