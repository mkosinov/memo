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
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [master, setMaster] = useState<MasterSnapshot | null | undefined>(undefined);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  const can = useCallback(
    (permission: string): boolean => {
      // Spec §2.4: the matcher is exactly "*" in perms or perm in perms.
      return permissions.includes('*') || permissions.includes(permission);
    },
    [permissions],
  );

  return (
    <AuthContext.Provider value={{ user, permissions, master, status, login, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
