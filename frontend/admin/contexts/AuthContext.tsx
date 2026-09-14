'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getMe, login as apiLogin, logout as apiLogout, setUnauthorizedHandler } from '@memo/api-client';
import type { AuthUser, MasterSnapshot } from '@memo/api-client';

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

interface AuthContextType {
  user: AuthUser | null;
  permissions: string[];
  master: MasterSnapshot | null | undefined;
  status: AuthStatus;
  login: (phone: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  /** GH #262 T7 (pinned decision): re-fetch the /auth/me snapshot. The user
   *  plate reads avatar/name from this snapshot STATE (not react-query), so
   *  MyDataModal calls refresh() after a portrait upload and after a
   *  successful save to keep the plate current. A failed refresh keeps the
   *  existing snapshot (a network blip never logs the user out). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [master, setMaster] = useState<MasterSnapshot | null | undefined>(undefined);
  const [status, setStatus] = useState<AuthStatus>('loading');
  // GH #262 T7 fix-round (issue 3): monotonic counter for refresh() — only
  // the LATEST call may write the snapshot, so overlapping refreshes
  // resolving out of order can never apply a stale /auth/me response.
  const refreshSeq = useRef(0);

  // Bootstrap (spec §4.3): /me on mount — 401 resolves to null (guest), not an
  // error. A failed request (network down, server restarting) also lands as
  // guest: the 401 interceptor re-prompts on the next real 401.
  useEffect(() => {
    let cancelled = false;
    getMe()
      .then((me) => {
        if (cancelled) return;
        if (me) {
          setUser(me.user);
          setPermissions(me.permissions);
          setMaster(me.master);
          setStatus('authenticated');
        } else {
          setStatus('guest');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('guest');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 401 interceptor (spec §4.4): a mid-work session expiry sends the user to
  // /login with the current location encoded in returnTo. Accepted MVP
  // limitation: unsaved input at the moment of expiry is lost.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const current = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?returnTo=${encodeURIComponent(current)}`);
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(async (phone: string, password: string): Promise<AuthUser> => {
    const me = await apiLogin(phone, password);
    setUser(me.user);
    setPermissions(me.permissions);
    setMaster(me.master);
    setStatus('authenticated');
    return me.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } finally {
      // Idempotent on the client too: even if the API call fails (network
      // blip, already-expired session), the local session is discarded.
      setUser(null);
      setPermissions([]);
      setMaster(undefined);
      setStatus('guest');
    }
  }, []);

  // GH #262 T7 (pinned decision): re-fetch the master snapshot so the user
  // plate (avatar + name) reflects a portrait upload / profile save. Unlike
  // the mount bootstrap, a FAILED refresh keeps the current snapshot — a
  // network blip must never demote an authenticated user to guest. A null
  // response (session vanished server-side) is treated like the bootstrap:
  // drop to guest. Ordering guard (fix-round issue 3): each call takes a
  // sequence number; a response applies ONLY while it is still the latest —
  // overlapping refreshes resolving out of order can't apply stale data.
  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++refreshSeq.current;
    try {
      const me = await getMe();
      if (seq !== refreshSeq.current) return; // a newer refresh is in flight
      if (me) {
        setUser(me.user);
        setPermissions(me.permissions);
        setMaster(me.master);
        setStatus('authenticated');
      } else {
        setStatus('guest');
      }
    } catch {
      // Keep the existing snapshot on error.
    }
  }, []);

  const can = useCallback(
    (permission: string): boolean => {
      // Spec §2.4: the matcher is exactly "*" in perms or perm in perms.
      return permissions.includes('*') || permissions.includes(permission);
    },
    [permissions],
  );

  return (
    <AuthContext.Provider value={{ user, permissions, master, status, login, logout, can, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
