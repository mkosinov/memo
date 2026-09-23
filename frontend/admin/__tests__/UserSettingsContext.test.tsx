/**
 * UserSettingsContext tests (GH #247 §4.6, GH #319 §5.6).
 *
 * Loading is auth-gated: the context must only call the user-settings API
 * once AuthContext reports `status === "authenticated"`. The auth boundary is
 * mocked (repo pattern — see MainLayoutGuard.test.tsx); the api-client
 * boundary is mocked so no network happens.
 *
 * GH #319 §5.6: the «GET error → POST create» fallback is gone — the read
 * self-heals server-side (get-or-create). `createUserSettings` lives in the
 * api-client mock ONLY as a tripwire: if the context ever calls it, tests fail.
 * Rule: the localStorage cache is a first-render accelerator and is always
 * overwritten by the GET response (incl. defaults after a DELETE reset).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const apiMocks = vi.hoisted(() => ({
  getUserSettings: vi.fn(),
  patchUserSettings: vi.fn(),
  // Tripwire (GH #319 §5.6): the POST-create fallback must never come back.
  createUserSettings: vi.fn(),
}));

vi.mock('@memo/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@memo/api-client')>();
  return { ...actual, ...apiMocks };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { getUserSettings, patchUserSettings } from '@memo/api-client';
import { useAuth } from '@/contexts/AuthContext';
import { UserSettingsProvider, useUserSettings } from '../contexts/UserSettingsContext';

const mockGetUserSettings = vi.mocked(getUserSettings);
const mockPatchUserSettings = vi.mocked(patchUserSettings);
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
  column_order_staff: ['m1', 'm2'],
  column_order_locations: ['l1'],
  show_archived_masters: true,
  show_archived_locations: false,
  created_at: '2026-09-08T00:00:00Z',
  updated_at: '2026-09-08T00:00:00Z',
};

/** Consumer exposing the context for assertions (UIContext.test.tsx pattern). */
function SettingsConsumer() {
  const { settings, ready, updateSettings } = useUserSettings();
  return (
    <div>
      <span data-testid="ready">{String(ready)}</span>
      <span data-testid="theme">{settings.theme}</span>
      <span data-testid="col-masters">{settings.columnOrderMasters.join(',')}</span>
      <span data-testid="archived-masters">{String(settings.showArchivedMasters)}</span>
      <span data-testid="archived-locations">{String(settings.showArchivedLocations)}</span>
      <button data-testid="toggle-archived-masters" onClick={() => updateSettings({ showArchivedMasters: false })}>
        toggle
      </button>
      <button data-testid="toggle-archived-locations" onClick={() => updateSettings({ showArchivedLocations: true })}>
        toggle
      </button>
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
    apiMocks.createUserSettings.mockReset();
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
    expect(apiMocks.createUserSettings).not.toHaveBeenCalled();
    expect(screen.getByTestId('ready')).toHaveTextContent('false');
  });

  it('does not call the settings API while auth status is "guest"', async () => {
    mockUseAuth.mockReturnValue(mockAuthState('guest'));
    renderConsumer();
    await new Promise((r) => setTimeout(r, 20));
    expect(mockGetUserSettings).not.toHaveBeenCalled();
    expect(apiMocks.createUserSettings).not.toHaveBeenCalled();
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
});

describe('UserSettingsContext read self-heals (GH #319 §5.6)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetUserSettings.mockReset();
    apiMocks.createUserSettings.mockReset();
    mockUseAuth.mockReturnValue(mockAuthState('authenticated'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT POST-create settings when GET fails and cache is empty', async () => {
    mockGetUserSettings.mockRejectedValue(new Error('network down'));
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    // The «read error → create» fallback is gone (GH #319 §5.6): read self-heals.
    expect(apiMocks.createUserSettings).not.toHaveBeenCalled();
    // Existing error path: fall back to defaults, never throw.
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('does NOT POST-create settings when GET fails and cache exists', async () => {
    localStorage.setItem(
      'memo-user-settings',
      JSON.stringify({ theme: 'dark', language: 'ru', columnOrderMasters: ['c1'], columnOrderLocations: [] }),
    );
    mockGetUserSettings.mockRejectedValue(new Error('500'));
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(apiMocks.createUserSettings).not.toHaveBeenCalled();
    // Error path: the cached first-render values stay.
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    expect(screen.getByTestId('col-masters')).toHaveTextContent('c1');
  });

  it('any GET response overwrites the localStorage cache (DELETE → GET defaults)', async () => {
    // Stale customized cache left over from before a server-side reset (DELETE
    // recreates the row with defaults on the next read — GH #319 §5.3).
    localStorage.setItem(
      'memo-user-settings',
      JSON.stringify({
        theme: 'dark',
        language: 'en',
        columnOrderMasters: ['stale1', 'stale2'],
        columnOrderLocations: ['staleL'],
        showArchivedMasters: false,
        showArchivedLocations: true,
      }),
    );
    // GET get-or-create returns the recreated defaults row.
    mockGetUserSettings.mockResolvedValue({
      ...remoteSettings,
      theme: 'light',
      language: 'ru',
      column_order_staff: [],
      column_order_locations: [],
      show_archived_masters: true,
      show_archived_locations: false,
    });
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });
    expect(screen.getByTestId('col-masters')).toHaveTextContent('');
    expect(screen.getByTestId('archived-masters')).toHaveTextContent('true');
    expect(screen.getByTestId('archived-locations')).toHaveTextContent('false');
    // The cache is always subordinate to the server response.
    const cached = JSON.parse(localStorage.getItem('memo-user-settings')!) as Record<string, unknown>;
    expect(cached.theme).toBe('light');
    expect(cached.language).toBe('ru');
    expect(cached.columnOrderMasters).toEqual([]);
    expect(cached.columnOrderLocations).toEqual([]);
    expect(cached.showArchivedMasters).toBe(true);
    expect(cached.showArchivedLocations).toBe(false);
    expect(apiMocks.createUserSettings).not.toHaveBeenCalled();
  });

  it('a customized GET response overwrites a defaults cache', async () => {
    localStorage.setItem(
      'memo-user-settings',
      JSON.stringify({
        theme: 'light',
        language: 'ru',
        columnOrderMasters: [],
        columnOrderLocations: [],
        showArchivedMasters: true,
        showArchivedLocations: false,
      }),
    );
    mockGetUserSettings.mockResolvedValue({
      ...remoteSettings,
      theme: 'dark',
      language: 'en',
      column_order_staff: ['m9'],
      column_order_locations: ['l9'],
      show_archived_masters: false,
      show_archived_locations: true,
    });
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });
    const cached = JSON.parse(localStorage.getItem('memo-user-settings')!) as Record<string, unknown>;
    expect(cached.theme).toBe('dark');
    expect(cached.language).toBe('en');
    expect(cached.columnOrderMasters).toEqual(['m9']);
    expect(cached.columnOrderLocations).toEqual(['l9']);
    expect(cached.showArchivedMasters).toBe(false);
    expect(cached.showArchivedLocations).toBe(true);
  });
});

describe('UserSettingsContext archived visibility (GH #267)', () => {
  beforeEach(() => {
    localStorage.clear();
    mockGetUserSettings.mockReset();
    apiMocks.createUserSettings.mockReset();
    mockPatchUserSettings.mockReset();
    mockPatchUserSettings.mockResolvedValue(remoteSettings);
    mockUseAuth.mockReturnValue(mockAuthState('authenticated'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to showArchivedMasters=true / showArchivedLocations=false on empty cache + API failure', async () => {
    mockGetUserSettings.mockRejectedValue(new Error('network down'));
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('archived-masters')).toHaveTextContent('true');
    expect(screen.getByTestId('archived-locations')).toHaveTextContent('false');
  });

  it('reads show_archived_* keys from remote settings', async () => {
    mockGetUserSettings.mockResolvedValue({
      ...remoteSettings,
      show_archived_masters: false,
      show_archived_locations: true,
    });
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('archived-masters')).toHaveTextContent('false');
    });
    expect(screen.getByTestId('archived-locations')).toHaveTextContent('true');
  });

  it('restores show_archived_* keys from localStorage cache (merge keeps defaults for missing keys)', async () => {
    mockGetUserSettings.mockRejectedValue(new Error('network down'));
    localStorage.setItem(
      'memo-user-settings',
      JSON.stringify({ theme: 'dark', language: 'ru', columnOrderMasters: [], columnOrderLocations: [] }),
    );
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    // Cached settings without the new keys → defaults apply (no flash of hidden masters).
    expect(screen.getByTestId('archived-masters')).toHaveTextContent('true');
    expect(screen.getByTestId('archived-locations')).toHaveTextContent('false');
  });

  it('restores persisted show_archived_* values present in the cache', async () => {
    mockGetUserSettings.mockRejectedValue(new Error('network down'));
    localStorage.setItem(
      'memo-user-settings',
      JSON.stringify({
        theme: 'dark',
        language: 'ru',
        columnOrderMasters: [],
        columnOrderLocations: [],
        showArchivedMasters: false,
        showArchivedLocations: true,
      }),
    );
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });
    expect(screen.getByTestId('archived-masters')).toHaveTextContent('false');
    expect(screen.getByTestId('archived-locations')).toHaveTextContent('true');
  });

  it('PATCHes show_archived_* wire keys when toggled', async () => {
    mockGetUserSettings.mockResolvedValue(remoteSettings);
    renderConsumer();
    await waitFor(() => {
      expect(screen.getByTestId('ready')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByTestId('toggle-archived-masters'));
    await waitFor(() => {
      expect(mockPatchUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({ show_archived_masters: false }),
      );
    });
    expect(screen.getByTestId('archived-masters')).toHaveTextContent('false');

    fireEvent.click(screen.getByTestId('toggle-archived-locations'));
    await waitFor(() => {
      expect(mockPatchUserSettings).toHaveBeenCalledWith(
        expect.objectContaining({ show_archived_locations: true }),
      );
    });
    expect(screen.getByTestId('archived-locations')).toHaveTextContent('true');
  });
});
