import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ApiError } from '@memo/api-client';

// Mock the api-client module (repo pattern: mock the boundary, not fetch)
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

import { getMe, login, logout, setUnauthorizedHandler } from '@memo/api-client';
import { AuthProvider, useAuth } from '../contexts/AuthContext';

const mockGetMe = vi.mocked(getMe);
const mockLogin = vi.mocked(login);
const mockLogout = vi.mocked(logout);
const mockSetUnauthorizedHandler = vi.mocked(setUnauthorizedHandler);

// Minimal real AuthMe payload (AuthMeSchema shape from packages/api-client)
const mockUser = {
  id: 'user-uuid-1',
  phone: '+79990000001',
  role: 'admin',
  master_id: null,
  email: null,
};

const mockAuthMe = {
  user: mockUser,
  permissions: ['*'],
  master: null,
};

/** Consumer exposing the context for assertions (UIContext.test.tsx pattern). */
function AuthConsumer() {
  const { user, permissions, master, status, login: doLogin, logout: doLogout, can } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
      <span data-testid="user-phone">{user?.phone ?? 'none'}</span>
      <span data-testid="permissions">{permissions.join(',')}</span>
      <span data-testid="master">{master ? `${master.first_name} ${master.last_name}` : 'none'}</span>
      <span data-testid="can-payments">{can('payments:read').toString()}</span>
      <span data-testid="can-materials">{can('materials:read').toString()}</span>
      <button data-testid="do-login" onClick={() => void doLogin('+79990000001', 'secret123')} />
      <button
        data-testid="do-login-return"
        onClick={() =>
          doLogin('+79990000001', 'secret123').then(
            (u) => {
              document.body.dataset.loginReturn = u.id;
            },
            (err: { code?: string }) => {
              document.body.dataset.loginError = err?.code ?? 'unknown';
            },
          )
        }
      />
      <button data-testid="do-logout" onClick={() => void doLogout()} />
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <AuthConsumer />
    </AuthProvider>,
  );
}

describe('AuthProvider', () => {
  afterEach(() => {
    delete document.body.dataset.loginReturn;
    delete document.body.dataset.loginError;
    vi.clearAllMocks();
  });

  it('throws when useAuth is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    function BrokenConsumer() {
      useAuth();
      return null;
    }
    expect(() => render(<BrokenConsumer />)).toThrow(
      'useAuth must be used within AuthProvider',
    );
    spy.mockRestore();
  });

  it('starts in loading status, then resolves to authenticated with user from getMe', async () => {
    mockGetMe.mockResolvedValue(mockAuthMe);
    renderAuth();
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(screen.getByTestId('user-id')).toHaveTextContent('user-uuid-1');
    expect(screen.getByTestId('user-phone')).toHaveTextContent('+79990000001');
    expect(screen.getByTestId('permissions')).toHaveTextContent('*');
  });

  it('resolves to guest when getMe returns 401 (null)', async () => {
    mockGetMe.mockResolvedValue(null);
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
    });
    expect(screen.getByTestId('user-id')).toHaveTextContent('none');
  });

  it('resolves to guest when getMe throws a non-401 error (degraded, not crash)', async () => {
    mockGetMe.mockRejectedValue(new TypeError('Failed to fetch'));
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
    });
  });

  it('registers a 401 handler on mount that redirects to /login with returnTo', async () => {
    // RTL's cleanup of the previous test (unmount → handler=null) fires after
    // the shared clearAllMocks — drop those stale calls before asserting.
    mockSetUnauthorizedHandler.mockClear();
    mockGetMe.mockResolvedValue(null);
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, pathname: '/schedule', search: '?tab=1' });
    renderAuth();
    await waitFor(() => {
      expect(mockSetUnauthorizedHandler).toHaveBeenCalledTimes(1);
    });
    const handler = mockSetUnauthorizedHandler.mock.calls[0][0] as () => void;
    act(() => {
      handler();
    });
    expect(assign).toHaveBeenCalledWith('/login?returnTo=%2Fschedule%3Ftab%3D1');
    vi.unstubAllGlobals();
  });

  describe('can()', () => {
    it('handles the "*" wildcard for admin', async () => {
      mockGetMe.mockResolvedValue({ ...mockAuthMe, permissions: ['*'] });
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });
      expect(screen.getByTestId('can-payments')).toHaveTextContent('true');
      expect(screen.getByTestId('can-materials')).toHaveTextContent('true');
    });

    it('checks explicit permission tokens for master', async () => {
      mockGetMe.mockResolvedValue({
        ...mockAuthMe,
        permissions: ['payments:read', 'clients:read'],
      });
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });
      expect(screen.getByTestId('can-payments')).toHaveTextContent('true');
      expect(screen.getByTestId('can-materials')).toHaveTextContent('false');
    });
  });

  describe('login()', () => {
    beforeEach(() => {
      mockGetMe.mockResolvedValue(null);
    });

    it('updates state to authenticated and returns the user', async () => {
      mockLogin.mockResolvedValue({ ...mockAuthMe, master: { first_name: 'Анна', last_name: 'Петрова' } });
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      act(() => {
        screen.getByTestId('do-login-return').click();
      });
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });
      expect(screen.getByTestId('user-id')).toHaveTextContent('user-uuid-1');
      expect(screen.getByTestId('master')).toHaveTextContent('Анна Петрова');
      expect(document.body.dataset.loginReturn).toBe('user-uuid-1');
      expect(mockLogin).toHaveBeenCalledWith('+79990000001', 'secret123');
    });

    it('rethrows the login error and stays guest', async () => {
      const err = new ApiError(401, 'Invalid phone or password', 'AUTH_INVALID_CREDENTIALS');
      mockLogin.mockRejectedValue(err);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      let caught: unknown = null;
      await act(async () => {
        screen.getByTestId('do-login-return').click();
      });
      await waitFor(() => {
        expect(document.body.dataset.loginError).toBe('AUTH_INVALID_CREDENTIALS');
      });
      expect(caught).toBeNull();
    });
  });

  describe('logout()', () => {
    it('calls the API and resets state to guest', async () => {
      mockGetMe.mockResolvedValue(mockAuthMe);
      mockLogout.mockResolvedValue(undefined);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });
      act(() => {
        screen.getByTestId('do-logout').click();
      });
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      expect(mockLogout).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('user-id')).toHaveTextContent('none');
    });
  });
});
