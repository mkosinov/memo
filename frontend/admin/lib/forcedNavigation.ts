/**
 * #397 §5.3 — system-forced navigation flag.
 *
 * A mid-work session expiry (401) forces a full navigation to /login. The
 * beforeunload guard (see `hooks/useUnsavedChangesGuard.ts`, wired in a
 * follow-up task) must NOT show the "leave site?" dialog for such
 * system-forced redirects: refusing would trap the user on a page where
 * every request answers 401. The auth layer calls `markForcedNavigation()`
 * right before `window.location.assign('/login?…')`; the guard reads the
 * flag via `isForcedNavigation()` and lets the navigation pass silently
 * (pending deletions are quietly cancelled — the safe "don't delete"
 * outcome).
 *
 * Deliberately framework-free: module-scoped state, no React, no reset
 * export — the flag lives exactly one full navigation, after which the
 * module re-evaluates fresh on the /login document.
 */

let forced = false;

/** Set the flag: the next full navigation is system-forced (401 → /login). */
export function markForcedNavigation(): void {
  forced = true;
}

/** Read the flag: true while a forced full navigation is in flight. */
export function isForcedNavigation(): boolean {
  return forced;
}
