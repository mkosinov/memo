import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { ApiError, UserRoleSchema, ZodError } from '@memo/api-client';

// Mock the api-client module (repo pattern: mock the boundary, not fetch).
// #584 §5: the bootstrap/refresh surface is the whoami chain —
// getMyWhoami() → getMyStaffProfile(branch) — plus the unchanged
// login/logout. getMe() is gone (/auth/me deleted, §4.5).
vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getMyWhoami: vi.fn(),
    getMyStaffProfile: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    setUnauthorizedHandler: vi.fn(),
  };
});

import {
  getMyWhoami,
  getMyStaffProfile,
  login,
  logout,
  setUnauthorizedHandler,
} from '@memo/api-client';
import type { AuthMe, MyStaffProfile, MyWhoami } from '@memo/api-client';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { createMockMyStaffProfile, mockMyStaffProfileMaster } from './helpers/mockData';

const mockGetMyWhoami = vi.mocked(getMyWhoami);
const mockGetMyStaffProfile = vi.mocked(getMyStaffProfile);
const mockLogin = vi.mocked(login);
const mockLogout = vi.mocked(logout);
const mockSetUnauthorizedHandler = vi.mocked(setUnauthorizedHandler);

// ─── Chain fixtures (#584 §4.1/§4.3 wire shapes) ────────────────────────────

const whoamiMaster: MyWhoami = {
  id: 'user-uuid-1',
  phone: '+79990000001',
  email: null,
  roles: ['master'],
};
const whoamiAdmin: MyWhoami = { ...whoamiMaster, roles: ['admin'] };
// Combined admin+master — §5: "master" ∈ roles wins → master branch.
const whoamiCombined: MyWhoami = { ...whoamiMaster, roles: ['admin', 'master'] };

const staffProfileMaster = mockMyStaffProfileMaster;

const staffProfileAdmin = createMockMyStaffProfile({
  role: 'admin',
  has_master: false,
  specialties: null,
  master_section: null,
  master: null,
});

const loginMeAdmin: AuthMe = {
  user: {
    id: 'user-uuid-1',
    phone: '+79990000001',
    role: 'admin',
    master_id: null,
    email: null,
  },
  permissions: ['*'],
  master: null,
};

const loginMeMaster: AuthMe = {
  ...loginMeAdmin,
  user: { ...loginMeAdmin.user, role: 'master' },
  master: { first_name: 'Анна', last_name: 'Петрова' },
};

/** Wire the happy chain: whoami → profile (spec §5 success path). */
function mockChain(whoami: MyWhoami, profile: MyStaffProfile = staffProfileMaster) {
  mockGetMyWhoami.mockResolvedValue(whoami);
  mockGetMyStaffProfile.mockResolvedValue(profile);
}

/** Consumer exposing the context for assertions (UIContext.test.tsx pattern). */
function AuthConsumer() {
  const {
    user,
    permissions,
    master,
    status,
    branch,
    login: doLogin,
    logout: doLogout,
    can,
    refresh,
  } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="user-id">{user?.id ?? 'none'}</span>
      <span data-testid="user-phone">{user?.phone ?? 'none'}</span>
      <span data-testid="permissions">{permissions.join(',')}</span>
      <span data-testid="master">{master ? `${master.first_name} ${master.last_name}` : 'none'}</span>
      <span data-testid="master-avatar">{master?.avatar_url ?? 'none'}</span>
      <span data-testid="branch">{branch ?? 'none'}</span>
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
      <button
        data-testid="do-refresh"
        onClick={() => {
          // Record the rejection name (if any) — fail-closed refresh must
          // surface its error visibly (#480 §3.3), not swallow it.
          delete document.body.dataset.refreshError;
          refresh().catch((err: unknown) => {
            document.body.dataset.refreshError = err instanceof Error ? err.name : 'unknown';
          });
        }}
      />
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

describe('AuthProvider — whoami bootstrap chain (#584 §5)', () => {
  afterEach(() => {
    delete document.body.dataset.loginReturn;
    delete document.body.dataset.loginError;
    delete document.body.dataset.refreshError;
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

  it('bootstraps via the chain: master role → master-branch profile on the plate', async () => {
    mockChain(whoamiMaster);
    renderAuth();
    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(mockGetMyWhoami).toHaveBeenCalledTimes(1);
    expect(mockGetMyStaffProfile).toHaveBeenCalledWith('master');
    expect(screen.getByTestId('user-id')).toHaveTextContent('user-uuid-1');
    expect(screen.getByTestId('user-phone')).toHaveTextContent('+79990000001');
    expect(screen.getByTestId('permissions')).toHaveTextContent('*');
    expect(screen.getByTestId('master')).toHaveTextContent('Ольга Середа');
    expect(screen.getByTestId('branch')).toHaveTextContent('master');
  });

  it('combined admin+master resolves to the master branch ("master" ∈ roles wins)', async () => {
    mockChain(whoamiCombined);
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(mockGetMyStaffProfile).toHaveBeenCalledWith('master');
    expect(screen.getByTestId('branch')).toHaveTextContent('master');
  });

  it('admin-only roles resolve to the admin branch', async () => {
    mockChain(whoamiAdmin, staffProfileAdmin);
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(mockGetMyStaffProfile).toHaveBeenCalledWith('admin');
    expect(screen.getByTestId('branch')).toHaveTextContent('admin');
    // The admin branch carries no master section → no plate snapshot.
    expect(screen.getByTestId('master')).toHaveTextContent('none');
  });

  it('whoami 401 (null) → guest; the profile step never fires', async () => {
    mockGetMyWhoami.mockResolvedValue(null);
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
    });
    expect(screen.getByTestId('user-id')).toHaveTextContent('none');
    expect(screen.getByTestId('branch')).toHaveTextContent('none');
    expect(mockGetMyStaffProfile).not.toHaveBeenCalled();
  });

  it('whoami without a staff role (client-only) → guest; profile never fires', async () => {
    mockGetMyWhoami.mockResolvedValue({ ...whoamiMaster, roles: ['client'] });
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
    });
    expect(mockGetMyStaffProfile).not.toHaveBeenCalled();
  });

  it('whoami parse error at bootstrap → guest (no half-trusted state)', async () => {
    mockGetMyWhoami.mockRejectedValue(
      UserRoleSchema.safeParse('superuser').error!,
    );
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
    });
  });

  it('profile parse error at bootstrap → guest', async () => {
    mockGetMyWhoami.mockResolvedValue(whoamiMaster);
    mockGetMyStaffProfile.mockRejectedValue(
      UserRoleSchema.safeParse('superuser').error!,
    );
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
    });
  });

  it('network error at bootstrap → guest (degraded, not crash)', async () => {
    mockGetMyWhoami.mockRejectedValue(new TypeError('Failed to fetch'));
    renderAuth();
    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
    });
  });

  it('registers a 401 handler on mount that redirects to /login with returnTo', async () => {
    // RTL's cleanup of the previous test (unmount → handler=null) fires after
    // the shared clearAllMocks — drop those stale calls before asserting.
    mockSetUnauthorizedHandler.mockClear();
    mockGetMyWhoami.mockResolvedValue(null);
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
      mockChain(whoamiMaster, { ...staffProfileMaster, permissions: ['*'] });
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });
      expect(screen.getByTestId('can-payments')).toHaveTextContent('true');
      expect(screen.getByTestId('can-materials')).toHaveTextContent('true');
    });

    it('checks explicit permission tokens for master', async () => {
      mockChain(whoamiMaster, {
        ...staffProfileMaster,
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

  describe('login() — unchanged flow, branch derived from the login role', () => {
    beforeEach(() => {
      mockGetMyWhoami.mockResolvedValue(null);
    });

    it('updates state to authenticated and derives the master branch', async () => {
      mockLogin.mockResolvedValue(loginMeMaster);
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
      expect(screen.getByTestId('branch')).toHaveTextContent('master');
      expect(document.body.dataset.loginReturn).toBe('user-uuid-1');
      expect(mockLogin).toHaveBeenCalledWith('+79990000001', 'secret123');
    });

    it('admin login derives the admin branch', async () => {
      mockLogin.mockResolvedValue(loginMeAdmin);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      act(() => {
        screen.getByTestId('do-login-return').click();
      });
      await waitFor(() => {
        expect(screen.getByTestId('branch')).toHaveTextContent('admin');
      });
    });

    it('rethrows the login error and stays guest', async () => {
      const err = new ApiError(401, 'Invalid phone or password', 'AUTH_INVALID_CREDENTIALS');
      mockLogin.mockRejectedValue(err);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      await act(async () => {
        screen.getByTestId('do-login-return').click();
      });
      await waitFor(() => {
        expect(document.body.dataset.loginError).toBe('AUTH_INVALID_CREDENTIALS');
      });
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
    });

    it('parse error: rethrown visibly and no authenticated state is written', async () => {
      mockLogin.mockRejectedValue(UserRoleSchema.safeParse('superuser').error!);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      await act(async () => {
        screen.getByTestId('do-login-return').click();
      });
      // ZodError carries no `code` — the login page sees the raw parse error.
      await waitFor(() => {
        expect(document.body.dataset.loginError).toBe('unknown');
      });
      expect(screen.getByTestId('status')).toHaveTextContent('guest');
      expect(screen.getByTestId('user-id')).toHaveTextContent('none');
    });
  });

  describe('logout()', () => {
    it('calls the API and resets state to guest (branch dropped)', async () => {
      mockChain(whoamiMaster);
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
      expect(screen.getByTestId('branch')).toHaveTextContent('none');
    });
  });

  // GH #262 T7 pinned decision: the plate reads avatar/name from the master
  // snapshot (useState, fetched by the chain). MyDataModal calls refresh()
  // after an avatar upload / profile save to keep the plate current.
  describe('refresh()', () => {
    it('re-runs the chain and updates the master snapshot', async () => {
      mockChain(whoamiMaster, createMockMyStaffProfile({
        master: { first_name: 'Ольга', last_name: 'Середа', avatar_url: null },
      }));
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });
      expect(screen.getByTestId('master-avatar')).toHaveTextContent('none');

      // Server now returns an uploaded avatar + a new name.
      mockGetMyStaffProfile.mockResolvedValue({
        ...staffProfileMaster,
        master: { first_name: 'Ольга', last_name: 'Новая', avatar_url: '/api/v1/files/avatar/n.png' },
      });
      mockGetMyWhoami.mockClear();
      mockGetMyStaffProfile.mockClear();
      await act(async () => {
        screen.getByTestId('do-refresh').click();
      });

      expect(mockGetMyWhoami).toHaveBeenCalledTimes(1);
      expect(mockGetMyStaffProfile).toHaveBeenCalledWith('master');
      await waitFor(() => {
        expect(screen.getByTestId('master-avatar')).toHaveTextContent('/api/v1/files/avatar/n.png');
        expect(screen.getByTestId('master')).toHaveTextContent('Ольга Новая');
      });
    });

    it('whoami turning null (session died) → guest WITH the snapshot reset', async () => {
      mockChain(whoamiMaster);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      mockGetMyWhoami.mockResolvedValue(null);
      await act(async () => {
        screen.getByTestId('do-refresh').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      // §5 row 4 rationale: a dead cookie must not keep a live shell.
      expect(screen.getByTestId('user-id')).toHaveTextContent('none');
      expect(screen.getByTestId('permissions')).toHaveTextContent('');
      expect(screen.getByTestId('branch')).toHaveTextContent('none');
    });

    it('profile 401 (session died between the calls) → guest with the snapshot reset', async () => {
      mockChain(whoamiMaster);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      mockGetMyStaffProfile.mockReset().mockRejectedValueOnce(
        new ApiError(401, 'Session expired'),
      );
      await act(async () => {
        screen.getByTestId('do-refresh').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      expect(screen.getByTestId('user-id')).toHaveTextContent('none');
      expect(screen.getByTestId('permissions')).toHaveTextContent('');
      expect(screen.getByTestId('branch')).toHaveTextContent('none');
    });

    it('network error keeps the existing snapshot (never demotes to guest)', async () => {
      mockChain(whoamiMaster);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });
      mockGetMyWhoami.mockRejectedValue(new TypeError('Failed to fetch'));
      await act(async () => {
        screen.getByTestId('do-refresh').click();
      });
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('user-id')).toHaveTextContent('user-uuid-1');
      expect(screen.getByTestId('branch')).toHaveTextContent('master');
    });

    it('an ApiError that is not 401 keeps the snapshot', async () => {
      mockChain(whoamiMaster);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });
      mockGetMyWhoami.mockRejectedValueOnce(new ApiError(503, 'Backend restarting'));
      await act(async () => {
        screen.getByTestId('do-refresh').click();
      });
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('user-id')).toHaveTextContent('user-uuid-1');
      expect(document.body.dataset.refreshError).toBeUndefined();
    });

    // #480 §3.3 fail-closed, now per chain step: a parse error anywhere in
    // the chain resets the session and rethrows — a broken contract must not
    // keep serving old rights invisibly.
    it('parse error (whoami step) resets the session and rethrows', async () => {
      mockChain(whoamiMaster);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      mockGetMyWhoami.mockReset().mockRejectedValueOnce(
        UserRoleSchema.safeParse('superuser').error!,
      );
      await act(async () => {
        screen.getByTestId('do-refresh').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      expect(screen.getByTestId('user-id')).toHaveTextContent('none');
      expect(screen.getByTestId('permissions')).toHaveTextContent('');
      await waitFor(() => {
        expect(document.body.dataset.refreshError).toBe('ZodError');
      });
    });

    it('parse error (profile step) resets the session and rethrows', async () => {
      mockChain(whoamiMaster);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      mockGetMyStaffProfile.mockReset().mockRejectedValueOnce(
        UserRoleSchema.safeParse('superuser').error!,
      );
      await act(async () => {
        screen.getByTestId('do-refresh').click();
      });

      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('guest');
      });
      expect(screen.getByTestId('user-id')).toHaveTextContent('none');
      expect(screen.getByTestId('permissions')).toHaveTextContent('');
      await waitFor(() => {
        expect(document.body.dataset.refreshError).toBe('ZodError');
      });
    });

    // GH #262 T7 fix-round issue 3: two overlapping refresh() calls resolving
    // OUT OF ORDER must not let the older snapshot overwrite the newer one.
    it('an older refresh cannot overwrite a newer snapshot (out-of-order resolution)', async () => {
      mockChain(whoamiMaster);
      renderAuth();
      await waitFor(() => {
        expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
      });

      // Two controllable whoami responses: call #1 (older) and #2 (newer);
      // each chain fetches its profile right after its whoami resolves.
      let resolveWhoami1!: (v: MyWhoami) => void;
      let resolveWhoami2!: (v: MyWhoami) => void;
      const first = new Promise<MyWhoami>((r) => {
        resolveWhoami1 = r;
      });
      const second = new Promise<MyWhoami>((r) => {
        resolveWhoami2 = r;
      });
      mockGetMyWhoami
        .mockReset()
        .mockImplementationOnce(() => first)
        .mockImplementationOnce(() => second);
      // NOTE: the profile once-impls are consumed in WHOAMI-RESOLUTION order
      // (each chain fetches its profile right after its whoami resolves):
      // chain #2 resolves first → gets «Новая», the stale chain #1 gets «Старая».
      mockGetMyStaffProfile
        .mockReset()
        .mockImplementationOnce(async () => ({
          ...staffProfileMaster,
          master: { first_name: 'Новая', last_name: 'Ф', avatar_url: null },
        }))
        .mockImplementationOnce(async () => ({
          ...staffProfileMaster,
          master: { first_name: 'Старая', last_name: 'Ф', avatar_url: null },
        }));

      // Fire two overlapping refreshes (both call getMyWhoami synchronously).
      act(() => {
        screen.getByTestId('do-refresh').click();
        screen.getByTestId('do-refresh').click();
      });

      // The NEWER chain resolves first → state becomes «Новая».
      await act(async () => {
        resolveWhoami2(whoamiMaster);
      });
      // Then the OLDER (stale) chain resolves → it must be ignored.
      await act(async () => {
        resolveWhoami1(whoamiMaster);
      });

      // Final state = the LATER call's snapshot, not the stale earlier one.
      await waitFor(() => {
        expect(screen.getByTestId('master')).toHaveTextContent('Новая Ф');
      });
    });
  });
});
