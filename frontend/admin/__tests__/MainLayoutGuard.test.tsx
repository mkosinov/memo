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
function mockAuthState(
  status: string,
  overrides?: { role?: string; permissions?: string[] },
) {
  return {
    user:
      overrides?.role !== undefined
        ? { id: 'u-1', phone: '+79990000002', role: overrides.role, master_id: 'm1', email: null }
        : null,
    permissions: overrides?.permissions ?? ([] as string[]),
    master: undefined,
    status,
    login: vi.fn(),
    logout: vi.fn(),
    can: vi.fn(
      (p: string) => overrides?.permissions?.includes('*') || overrides?.permissions?.includes(p) || false,
    ),
  } as unknown as ReturnType<typeof useAuth>;
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

// ─── GH #263 T9: master-role access guard ─────────────────────────────────
// An authenticated master hitting an admin-only section URL gets the
// NoAccessScreen INSTEAD of children — the URL stays (no redirect), so
// refresh lands in the same place.

describe('(main)/layout master access guard (GH #263 T9)', () => {
  beforeEach(() => {
    replaceMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /** Spec §3.5 master tokens: the dictionaries/read surface, no writes. */
  const MASTER_PERMS = [
    'records:read', 'records:write', 'visits:read', 'visits:write',
    'visitors:read', 'visitors:write', 'services:read', 'locations:read',
    'tags:read', 'masters:read', 'clients:read', 'payments:read',
  ];

  function mockMaster() {
    mockUseAuth.mockReturnValue(
      mockAuthState('authenticated', { role: 'master', permissions: MASTER_PERMS }),
    );
  }

  it.each(['/clients', '/locations', '/tags', '/staff', '/positions', '/audit'])(
    'shows NoAccessScreen for %s and withholds children (URL kept)',
    (section) => {
      window.history.replaceState(null, '', section);
      mockMaster();
      renderLayout(<div>SECRET CONTENT</div>);
      expect(screen.getByTestId('no-access')).toBeInTheDocument();
      expect(screen.getByText('Нет доступа к разделу')).toBeInTheDocument();
      expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument();
      // No redirect — the URL stays as-is.
      expect(replaceMock).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe(section);
    },
  );

  it('shows NoAccessScreen for admin-only sub-paths (e.g. /clients/123)', () => {
    window.history.replaceState(null, '', '/clients/123');
    mockMaster();
    renderLayout(<div>SECRET CONTENT</div>);
    expect(screen.getByTestId('no-access')).toBeInTheDocument();
    expect(screen.queryByText('SECRET CONTENT')).not.toBeInTheDocument();
  });

  it.each(['/schedule', '/records', '/services', '/photos'])(
    'renders children for master on allowed path %s',
    (section) => {
      window.history.replaceState(null, '', section);
      mockMaster();
      renderLayout(<div>SECRET CONTENT</div>);
      expect(screen.getByText('SECRET CONTENT')).toBeInTheDocument();
      expect(screen.queryByTestId('no-access')).not.toBeInTheDocument();
    },
  );

  it('admin is never blocked on admin-only sections', () => {
    window.history.replaceState(null, '', '/clients');
    mockUseAuth.mockReturnValue(
      mockAuthState('authenticated', { role: 'admin', permissions: ['*'] }),
    );
    renderLayout(<div>SECRET CONTENT</div>);
    expect(screen.getByText('SECRET CONTENT')).toBeInTheDocument();
    expect(screen.queryByTestId('no-access')).not.toBeInTheDocument();
  });
});
