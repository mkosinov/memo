'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

export interface UserSettings {
  theme: 'light' | 'dark';
  language: 'ru' | 'en';
  columnOrderMasters: string[];
  columnOrderLocations: string[];
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
};

// TODO: Replace with real user ID from auth context
const DEV_USER_ID = 'dev-user-001';

function loadFromStorage(): UserSettings | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
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
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function load() {
      // 1. Try localStorage first for instant render
      const cached = loadFromStorage();
      if (cached && mountedRef.current) {
        setSettings(cached);
        setReady(true);
      }

      // 2. Sync from backend (when API is available)
      try {
        const { getUserSettings, createUserSettings } = await import('@memo/api-client');
        try {
          const remote = await getUserSettings(DEV_USER_ID);
          const remoteSettings: UserSettings = {
            theme: remote.theme as 'light' | 'dark',
            language: remote.language as 'ru' | 'en',
            columnOrderMasters: remote.column_order_masters,
            columnOrderLocations: remote.column_order_locations,
          };
          if (mountedRef.current) {
            setSettings(remoteSettings);
            saveToStorage(remoteSettings);
            setReady(true);
          }
        } catch {
          // No remote settings — create defaults if nothing cached
          if (!cached && mountedRef.current) {
            try {
              const created = await createUserSettings({
                user_id: DEV_USER_ID,
                theme: DEFAULT_SETTINGS.theme,
                language: DEFAULT_SETTINGS.language,
                column_order_masters: DEFAULT_SETTINGS.columnOrderMasters,
                column_order_locations: DEFAULT_SETTINGS.columnOrderLocations,
              });
              const createdSettings: UserSettings = {
                theme: created.theme as 'light' | 'dark',
                language: created.language as 'ru' | 'en',
                columnOrderMasters: created.column_order_masters,
                columnOrderLocations: created.column_order_locations,
              };
              if (mountedRef.current) {
                setSettings(createdSettings);
                saveToStorage(createdSettings);
              }
            } catch {
              // Backend unavailable — use defaults
            }
            if (mountedRef.current) setReady(true);
          }
        }
      } catch {
        // api-client not available yet — use localStorage or defaults
        if (mountedRef.current) setReady(true);
      }
    }

    load();
    return () => { mountedRef.current = false; };
  }, []);

  const updateSettings = useCallback((partial: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveToStorage(next);
      // Optimistic backend update (fire-and-forget)
      import('@memo/api-client').then(({ patchUserSettings }) => {
        const apiPartial: Record<string, unknown> = {};
        if (partial.theme !== undefined) apiPartial.theme = partial.theme;
        if (partial.language !== undefined) apiPartial.language = partial.language;
        if (partial.columnOrderMasters !== undefined) apiPartial.column_order_masters = partial.columnOrderMasters;
        if (partial.columnOrderLocations !== undefined) apiPartial.column_order_locations = partial.columnOrderLocations;
        patchUserSettings(DEV_USER_ID, apiPartial).catch(() => {});
      }).catch(() => {});
      return next;
    });
  }, []);

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
