import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getMe: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    setUnauthorizedHandler: vi.fn(),
  };
});

const replaceMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// The layout consumes auth — it is mounted under the global AuthProvider in
// providers.tsx. In unit tests we mock the context module (repo pattern).
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '@/contexts/AuthContext';
import { UIProvider } from '@/contexts/UIContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MainLayout from '../app/(main)/layout';

const mockUseAuth = vi.mocked(useAuth);

/** Matches AuthContextType minus the fields the guard doesn't read. */
function mockAuthState(status: string) {
  return {
    user: null,
    permissions: [] as string[],
    master: undefined,
    status,
    login: vi.fn(),
    logout: vi.fn(),
    can: vi.fn(() => false),
  } as React.ComponentProps<never> & ReturnType<typeof useAuth>;
}

function renderLayout(children: React.ReactNode) {
  // UIProvider: Menubar (sidebar/theme toggles) consumes it inside MainShell.
  // QueryClientProvider: Menubar/nav parts use react-query hooks.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <MainLayout>{children}</MainLayout>
      </UIProvider>
    </QueryClientProvider>,
  );
}

describe('(main)/layout auth guard (GH #247 §4.4)', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/schedule');
    replaceMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows a spinner shell while auth is loading, no content', () => {
    mockUseAuth.mockReturnValue(mockAuthState('loading'));
    renderLayout(<div>SECRET CONTENT</div>);
    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument();
  });

  it('redirects a guest to /login with returnTo and renders no content', async () => {
    mockUseAuth.mockReturnValue(mockAuthState('guest'));
    renderLayout(<div>SECRET CONTENT</div>);
    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith('/login?returnTo=%2Fschedule');
    });
    expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument();
  });

  it('renders children when authenticated', () => {
    mockUseAuth.mockReturnValue(mockAuthState('authenticated'));
    renderLayout(<div>SECRET CONTENT</div>);
    expect(screen.getByText('SECRET CONTENT')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
