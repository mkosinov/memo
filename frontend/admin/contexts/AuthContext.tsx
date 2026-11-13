'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  ApiError,
  ZodError,
  getMyWhoami,
  getMyStaffProfile,
  login as apiLogin,
  logout as apiLogout,
  setUnauthorizedHandler,
} from '@memo/api-client';
import type { AuthUser, MasterSnapshot, MyStaffProfile, MyWhoami, StaffBranch } from '@memo/api-client';
import { markForcedNavigation } from '@/lib/forcedNavigation';

export type AuthStatus = 'loading' | 'authenticated' | 'guest';

/** Snapshot applied by the bootstrap chain and refresh (#584 §5). */
interface StaffSnapshot {
  user: AuthUser;
  permissions: string[];
  master: MasterSnapshot | null;
  branch: StaffBranch;
}

interface AuthContextType {
  user: AuthUser | null;
  permissions: string[];
  master: MasterSnapshot | null | undefined;
  status: AuthStatus;
  /** #584 §5: the computed staff branch ("master" ∈ roles ? "master" :
   *  "admin") — the audience address for the staff profile / settings
   *  surface. null while unauthenticated. */
  branch: StaffBranch | null;
  login: (phone: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
  /** Re-fetch the session snapshot via the whoami chain. The user plate
   *  reads avatar/name from this snapshot STATE (not react-query), so
   *  MyDataModal calls refresh() after an avatar upload and after a
   *  successful save to keep the plate current. Error split (#480 §3.3 +
   *  #584 §5 matrix): a PARSE error anywhere in the chain is fail-closed
   *  (session reset, error rethrown); a 401 from the profile step (session
   *  died between the calls) drops to guest WITH the snapshot reset; any
   *  other failure (network blip, ApiError) keeps the existing snapshot —
   *  it must never log the user out. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// #584 §5: the branch is computed from the whoami role list — "master"
// membership wins over "admin" so a combined admin+master takes the master
// branch (its profile carries the master section, §4.3). A client-only list
// has no staff branch at all → null → guest.
function staffBranchFromRoles(roles: MyWhoami['roles']): StaffBranch | null {
  if (roles.includes('master')) return 'master';
  if (roles.includes('admin')) return 'admin';
  return null;
}

// Map the branch profile onto the shell snapshot. user_id is the account id.
// #584: the profile wire carries no master_id (the /auth/me legacy field);
// no admin-app consumer reads user.master_id — the plate uses the master
// snapshot below.
function staffSnapshotFromProfile(profile: MyStaffProfile, branch: StaffBranch): StaffSnapshot {
  return {
    user: {
      id: profile.user_id,
      phone: profile.phone,
      role: profile.role,
      master_id: null,
      email: profile.email,
    },
    permissions: profile.permissions,
    master: profile.master ?? null,
    branch,
  };
}

/**
 * The whoami chain (spec §5): getMyWhoami() → getMyStaffProfile(branch).
 * Failure matrix, by step:
 * - whoami 401 (resolved to null by the api-client) → null → guest;
 * - whoami 200 without a staff role → null → guest;
 * - profile 401 (session died between the calls) → rejects ApiError(401),
 *   handled by the caller (guest + snapshot reset);
 * - parse error at any step → throws ZodError (fail-closed, #480 §3.3);
 * - network error → throws (bootstrap → guest; refresh → keep snapshot).
 */
async function fetchStaffSnapshot(): Promise<StaffSnapshot | null> {
  const whoami = await getMyWhoami();
  if (!whoami) return null;
  const branch = staffBranchFromRoles(whoami.roles);
  if (!branch) return null;
  const profile = await getMyStaffProfile(branch);
  return staffSnapshotFromProfile(profile, branch);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [master, setMaster] = useState<MasterSnapshot | null | undefined>(undefined);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [branch, setBranch] = useState<StaffBranch | null>(null);
  // GH #262 T7 fix-round (issue 3): monotonic counter for refresh() — only
  // the LATEST call may write the snapshot, so overlapping refreshes
  // resolving out of order can never apply a stale chain response.
  const refreshSeq = useRef(0);

  // #480 §3.3 «Контракт отказа»: drop every piece of auth state to guest.
  // Used by logout (idempotent local discard) and by the fail-closed paths
  // — a broken auth contract or a dead cookie must never leave a trusted
  // snapshot (#584 §5: «мёртвой куке нельзя оставлять живую оболочку»).
  const resetSession = useCallback(() => {
    setUser(null);
    setPermissions([]);
    setMaster(undefined);
    setBranch(null);
    setStatus('guest');
  }, []);

  // Bootstrap (spec §5): the whoami chain on mount. Null (401 / no staff
  // role) resolves to guest, not an error. A failed request (network down,
  // server restarting) also lands as guest: the 401 interceptor re-prompts
  // on the next real 401. A PARSE error (#480 §3.3, fail-closed) lands as
  // guest the same way — there is no snapshot to keep at bootstrap, and the
  // login screen is the visible result.
  useEffect(() => {
    let cancelled = false;
    fetchStaffSnapshot()
      .then((snap) => {
        if (cancelled) return;
        if (snap) {
          setUser(snap.user);
          setPermissions(snap.permissions);
          setMaster(snap.master);
          setBranch(snap.branch);
          setStatus('authenticated');
        } else {
          resetSession();
        }
      })
      .catch(() => {
        if (!cancelled) resetSession();
      });
    return () => {
      cancelled = true;
    };
  }, [resetSession]);

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

  // login/logout are UNCHANGED (#584 §5) — the login response keeps the
  // AuthMe shape. The branch is derived from the login role (staff-only
  // surface: client accounts carry no password, so role ∈ master|admin).
  // A combined admin+master therefore starts on the admin branch here; the
  // next refresh() re-derives "master" from whoami. Both branches serve the
  // same account/rows (§4.4), so settings are unaffected.
  const login = useCallback(
    async (phone: string, password: string): Promise<AuthUser> => {
      try {
        const me = await apiLogin(phone, password);
        setUser(me.user);
        setPermissions(me.permissions);
        setMaster(me.master);
        setBranch(me.user.role === 'master' ? 'master' : 'admin');
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

  // GH #262 T7 (pinned decision): re-fetch the snapshot via the whoami
  // chain so the user plate (avatar + name) reflects an avatar upload /
  // profile save. Error split (#584 §5 matrix + #480 §3.3):
  // - chain resolves null (whoami 401 / no staff role) → guest, snapshot
  //   reset — a dead cookie keeps no live shell;
  // - profile 401 (ApiError, session died between the calls) → the same
  //   guest reset, no rethrow (the 401 interceptor handles the redirect);
  // - PARSE error at any step → fail-closed reset + rethrow so the caller
  //   shows it (a broken contract must not keep serving old rights);
  // - any other failure (network blip, ApiError) keeps the current
  //   snapshot — a network blip must never demote a user to guest.
  // Ordering guard (fix-round issue 3): each call takes a sequence number;
  // a response applies ONLY while it is still the latest — overlapping
  // refreshes resolving out of order can't apply stale data (the fail-closed
  // reset respects the same guard).
  const refresh = useCallback(async (): Promise<void> => {
    const seq = ++refreshSeq.current;
    try {
      const snap = await fetchStaffSnapshot();
      if (seq !== refreshSeq.current) return; // a newer refresh is in flight
      if (snap) {
        setUser(snap.user);
        setPermissions(snap.permissions);
        setMaster(snap.master);
        setBranch(snap.branch);
        setStatus('authenticated');
      } else {
        resetSession();
      }
    } catch (error) {
      if (seq !== refreshSeq.current) return;
      if (error instanceof ZodError) {
        // Fail-closed: discard the stale snapshot, then surface the error.
        resetSession();
        throw error;
      }
      if (error instanceof ApiError && error.status === 401) {
        // The session died between the chain calls → guest + reset (§5).
        resetSession();
        return;
      }
      // Non-parse, non-401 errors (network, ApiError): keep the snapshot.
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
    <AuthContext.Provider
      value={{ user, permissions, master, status, branch, login, logout, can, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
