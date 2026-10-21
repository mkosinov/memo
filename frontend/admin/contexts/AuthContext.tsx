'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getMe, login as apiLogin, logout as apiLogout, setUnauthorizedHandler, ZodError } from '@memo/api-client';
import type { AuthUser, MasterSnapshot } from '@memo/api-client';
import { markForcedNavigation } from '@/lib/forcedNavigation';

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
   *  successful save to keep the plate current. Error split (#480 §3.3):
   *  a PARSE error of the auth response is fail-closed (session reset, error
   *  rethrown); any other failure (network blip, ApiError) keeps the
   *  existing snapshot — it must never log the user out. */
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

  // #480 §3.3 «Контракт отказа»: drop every piece of auth state to guest.
  // Used by logout (idempotent local discard) and by the fail-closed parse
  // path — a broken auth contract must never leave a trusted snapshot.
  const resetSession = useCallback(() => {
    setUser(null);
    setPermissions([]);
    setMaster(undefined);
    setStatus('guest');
  }, []);

  // Bootstrap (spec §4.3): /me on mount — 401 resolves to null (guest), not an
  // error. A failed request (network down, server restarting) also lands as
  // guest: the 401 interceptor re-prompts on the next real 401. A PARSE
  // error (#480 §3.3, fail-closed) lands as guest the same way — there is no
  // snapshot to keep at bootstrap, and the login screen is the visible result.
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
  // /login with the current location encoded in returnTo. #397 §5.3: the
  // redirect is system-forced — markForcedNavigation() lets the
  // beforeunload guard (useUnsavedChangesGuard) skip the confirm dialog;
  // pending deletions are quietly cancelled (safe "don't delete" outcome).
  // Accepted MVP limitation: unsaved input at the moment of expiry is lost.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const current = `${window.location.pathname}${window.location.search}`;
      markForcedNavigation();
      window.location.assign(`/login?returnTo=${encodeURIComponent(current)}`);
    });
    return () => {
      setUnauthorizedHandler(null);
    };
  }, []);

  const login = useCallback(
    async (phone: string, password: string): Promise<AuthUser> => {
      try {
        const me = await apiLogin(phone, password);
        setUser(me.user);
        setPermissions(me.permissions);
        setMaster(me.master);
        setStatus('authenticated');
        return me.user;
      } catch (error) {
        // Fail-closed (#480 §3.3): a parse error of the login response means
        // the auth contract is broken — reset the session (never leave a
        // half-trusted state) and rethrow so the login page shows the error.
        // Other errors (ApiError 401, network) keep the previous behavior:
        // no state written, the error propagates as-is.
        if (error instanceof ZodError) resetSession();
        throw error;
      }
    },
    [resetSession],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiLogout();
    } finally {
      // Idempotent on the client too: even if the API call fails (network
      // blip, already-expired session), the local session is discarded.
      resetSession();
    }
  }, [resetSession]);

  // GH #262 T7 (pinned decision): re-fetch the master snapshot so the user
  // plate (avatar + name) reflects a portrait upload / profile save. Error
  // split (#480 §3.3 «Контракт отказа»): a PARSE error of the /auth/me
  // response is fail-closed — the session resets and the STALE role/
  // permissions snapshot is discarded (a broken contract must not keep
  // serving old rights invisibly); the error rethrows so the caller shows
  // it. Every other failure (network blip, ApiError) keeps the current
  // snapshot — a network blip must never demote an authenticated user to
  // guest. A null response (session vanished server-side) is treated like
  // the bootstrap: drop to guest. Ordering guard (fix-round issue 3): each
  // call takes a sequence number; a response applies ONLY while it is still
  // the latest — overlapping refreshes resolving out of order can't apply
  // stale data (the fail-closed reset respects the same guard).
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
    } catch (error) {
      if (error instanceof ZodError) {
        // Fail-closed: discard the stale snapshot, then surface the error.
        if (seq === refreshSeq.current) resetSession();
        throw error;
      }
      // Non-parse errors (network, ApiError): keep the existing snapshot.
    }
  }, [resetSession]);

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
