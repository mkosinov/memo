'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';

export interface UserSettings {
  theme: 'light' | 'dark';
  language: 'ru' | 'en';
  columnOrderMasters: string[];
  columnOrderLocations: string[];
  showArchivedMasters: boolean;
  showArchivedLocations: boolean;
}

interface UserSettingsContextType {
  settings: UserSettings;
  updateSettings: (partial: Partial<UserSettings>) => void;
  setColumnOrder: (mode: 'masters' | 'locations', order: string[]) => void;
  getColumnOrder: (mode: 'masters' | 'locations') => string[];
  ready: boolean;
}

const STORAGE_KEY = 'memo-user-settings';

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  language: 'ru',
  columnOrderMasters: [],
  columnOrderLocations: [],
  showArchivedMasters: true,
  showArchivedLocations: false,
};

// GH #247 §3.8/§4.6: user-settings are session-scoped — the server derives
// the user, so GET/PUT/PATCH carry no user id. GH #319 §5.6: the read
// self-heals server-side (get-or-create) — the «GET error → POST create»
// fallback is gone; the localStorage cache is a first-render accelerator and
// is always overwritten by any successful GET response (incl. defaults after
// a DELETE reset). Loading is auth-gated: the API is only touched once
// AuthContext reports `authenticated`.

function loadFromStorage(): UserSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    // GH #267: defaults spread first — keys missing from an older cached
    // object (pre-archived-visibility) fall back to defaults instead of
    // `undefined`, so the first frame never flashes with archived masters
    // hidden.
    const cached = JSON.parse(raw) as Partial<UserSettings>;
    return { ...DEFAULT_SETTINGS, ...cached };
  } catch {
    return null;
  }
}

function saveToStorage(settings: UserSettings) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore quota errors */ }
}

const UserSettingsContext = createContext<UserSettingsContextType | null>(null);

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const { status, user, branch } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    // GH #247 §4.6: settings load only after auth resolves to
    // `authenticated` — the session cookie must exist before the API call,
    // otherwise every page load fires a doomed 401 for guests. #584 §5: the
    // branch must be resolved too — the staff settings instance lives under
    // /my/{branch}/settings (same account, same rows; the branch is the
    // audience address).
    if (status !== 'authenticated' || branch === null) return;
    mountedRef.current = true;
    // Capture the narrowed branch for the hoisted async closure below.
    const targetBranch = branch;

    async function load() {
      // 1. Try localStorage first for instant render
      const cached = loadFromStorage();
      if (cached && mountedRef.current) {
        setSettings(cached);
        setReady(true);
      }

      // 2. Sync from backend (when API is available)
      try {
        const { getUserSettings } = await import('@memo/api-client');
        const remote = await getUserSettings(targetBranch);
        const remoteSettings: UserSettings = {
          theme: remote.theme as 'light' | 'dark',
          language: remote.language as 'ru' | 'en',
          // GH #266 Gap C: wire field renamed column_order_masters →
          // column_order_staff (migration step 7). Internal name stays
          // `columnOrderMasters` — the schedule UI «Мастер» column term
          // is unchanged (D2); only the persisted key moved.
          columnOrderMasters: remote.column_order_staff,
          columnOrderLocations: remote.column_order_locations,
          // GH #267: archived-visibility toggles.
          showArchivedMasters: remote.show_archived_masters,
          showArchivedLocations: remote.show_archived_locations,
        };
        if (mountedRef.current) {
          setSettings(remoteSettings);
          saveToStorage(remoteSettings);
          setReady(true);
        }
      } catch {
        // GH #319 §5.6: read self-heals server-side (get-or-create) — the old
        // «GET error → POST create» fallback is gone. On any failure (API
        // unreachable, api-client not loaded yet) stay on the cache
        // (first-render accelerator) or defaults; the cache stays subordinate
        // to any successful GET response.
        if (mountedRef.current) setReady(true);
      }
    }

    load();
    return () => { mountedRef.current = false; };
  }, [status, user?.id, branch]);

  const updateSettings = useCallback((partial: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveToStorage(next);
      // Optimistic backend update (fire-and-forget). #584 §5: rides the
      // computed branch — captured per render via a ref-free closure over
      // the current branch (updates only fire from authenticated screens).
      const targetBranch = branch;
      import('@memo/api-client').then(({ patchUserSettings }) => {
        if (targetBranch === null) return;
        const apiPartial: Record<string, unknown> = {};
        if (partial.theme !== undefined) apiPartial.theme = partial.theme;
        if (partial.language !== undefined) apiPartial.language = partial.language;
        if (partial.columnOrderMasters !== undefined) apiPartial.column_order_staff = partial.columnOrderMasters;
        if (partial.columnOrderLocations !== undefined) apiPartial.column_order_locations = partial.columnOrderLocations;
        // GH #267: archived-visibility toggles.
        if (partial.showArchivedMasters !== undefined) apiPartial.show_archived_masters = partial.showArchivedMasters;
        if (partial.showArchivedLocations !== undefined) apiPartial.show_archived_locations = partial.showArchivedLocations;
        patchUserSettings(targetBranch, apiPartial).catch(() => {});
      }).catch(() => {});
      return next;
    });
  }, [branch]);

  const setColumnOrder = useCallback((mode: 'masters' | 'locations', order: string[]) => {
    const key = mode === 'masters' ? 'columnOrderMasters' : 'columnOrderLocations';
    updateSettings({ [key]: order });
  }, [updateSettings]);

  const getColumnOrder = useCallback((mode: 'masters' | 'locations'): string[] => {
    return mode === 'masters' ? settings.columnOrderMasters : settings.columnOrderLocations;
  }, [settings]);

  const contextValue = React.useMemo(
    () => ({ settings, updateSettings, setColumnOrder, getColumnOrder, ready }),
    [settings, updateSettings, setColumnOrder, getColumnOrder, ready],
  );

  return (
    <UserSettingsContext.Provider value={contextValue}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettings() {
  const ctx = useContext(UserSettingsContext);
  if (!ctx) throw new Error('useUserSettings must be used within UserSettingsProvider');
  return ctx;
}
