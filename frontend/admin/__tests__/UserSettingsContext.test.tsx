/**
 * UserSettingsContext tests (GH #247 §4.6).
 *
 * Loading is auth-gated: the context must only call the user-settings API
 * once AuthContext reports `status === "authenticated"`. The auth boundary is
 * mocked (repo pattern — see MainLayoutGuard.test.tsx); the api-client
 * boundary is mocked so no network happens.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return {
    ...actual,
    getUserSettings: vi.fn(),
    createUserSettings: vi.fn(),
    patchUserSettings: vi.fn(),
  };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { getUserSettings, createUserSettings } from '@memo/api-client';
import { useAuth } from '@/contexts/AuthContext';
import { UserSettingsProvider, useUserSettings } from '../contexts/UserSettingsContext';

const mockGetUserSettings = vi.mocked(getUserSettings);
const mockCreateUserSettings = vi.mocked(createUserSettings);
const mockUseAuth = vi.mocked(useAuth);

const authUser = {
  id: 'user-uuid-1',
  phone: '+79990000001',
  role: 'admin' as const,
  master_id: null,
  email: null,
};

function mockAuthState(status: 'loading' | 'authenticated' | 'guest') {
  return {
    user: status === 'authenticated' ? { ...authUser } : null,
    permissions: ['*'],
    master: null,
    status,
    login: vi.fn(),
    logout: vi.fn(),
    can: vi.fn(() => true),
  } as unknown as ReturnType<typeof useAuth>;
}

const remoteSettings = {
  id: 'settings-1',
  user_id: authUser.id,
  theme: 'light' as const,
  language: 'ru' as const,
  column_order_masters: ['m1', 'm2'],
  column_order_locations: ['l1'],
  created_at: '2026-09-08T00:00:00Z',
  updated_at: '2026-09-08T00:00:00Z',
};

/** Consumer exposing the context for assertions (UIContext.test.tsx pattern). */
function SettingsConsumer() {
  const { settings, ready } = useUserSettings();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="theme">{settings.theme}</span>
      <span data-testid="col-masters">{settings.columnOrderMasters.join(',')}</span>
    </div>
  );
}

function renderConsumer() {
  return render(
    <UserSettingsProvider>
      <SettingsConsumer />
    </UserSettingsProvider>,
  );
}

describe('UserSettingsContext auth gating (GH #247 §4.6)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetUserSettings.mockReset();
    mockCreateUserSettings.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not call the settings API while auth status is "loading"', async () => {
    mockUseAuth.mockReturnValue(mockAuthState('loading'));
    renderConsumer();
    // Give any (incorrect) immediate load attempt time to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGetUserSettings).not.toHaveBeenCalled();
    expect(mockCreateUserSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  it('does not call the settings API while auth status is "guest"', async () => {
    mockUseAuth.mockReturnValue(mockAuthState('guest'));
    renderConsumer();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGetUserSettings).not.toHaveBeenCalled();
    expect(mockCreateUserSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  it('loads settings once auth resolves to "authenticated"', async () => {
    mockUseAuth.mockReturnValue(mockAuthState('authenticated'));
    mockGetUserSettings.mockResolvedValue(remoteSettings);
    renderConsumer();
    await waitFor(() => {
      expect(mockGetUserSettings).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('col-masters')).toHaveTextContent('m1,m2');
  });

  it('creates default settings with the session user id when none exist remotely (fresh user)', async () => {
    mockUseAuth.mockReturnValue(mockAuthState('authenticated'));
    mockGetUserSettings.mockRejectedValue(new Error('404'));
    mockCreateUserSettings.mockResolvedValue({
      ...remoteSettings,
      column_order_masters: [],
      column_order_locations: [],
    });    renderConsumer();
    await waitFor(() => {
      expect(mockCreateUserSettings).toHaveBeenCalledTimes(1);
    });
    // T11 flagged follow-through: the POST body carries the session user id
    // (backend still requires it on create; client schema made it optional).
    expect(mockCreateUserSettings).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: authUser.id }),
    );
    expect(screen.getByTestId('ready')).toHaveTextContent('true');
  });
});
