/**
 * #138 Task 2 — mock of `next/navigation` for unit tests that render the REAL
 * URL-backed hooks (useScheduleView → ScheduleViewProvider → …).
 *
 * Unlike a static mock, `push`/`replace` UPDATE the mocked search params and
 * notify subscribers, so components re-render with the new URL — mirroring the
 * App Router. Tests drive navigation through the real UI (e.g. nextPeriod)
 * instead of hand-poking context state.
 *
 * #138 Task 4 — pathname support: layout-level components (Menubar →
 * MiniCalendar) branch on the CURRENT page, so the mock tracks a pathname
 * (default `/schedule`). `write()` records the full URL of the last
 * push/replace for push-target assertions.
 *
 * Usage in a test file:
 * ```ts
 * vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
 * import { __resetNavigation, __currentQuery } from './helpers/nextNavigationMock';
 * beforeEach(() => __resetNavigation());          // '' = no params, /schedule
 * __resetNavigation('?date=2026-09-16');          // seed a viewed week
 * __resetNavigation('?from=2026-09-01&to=2026-09-10', '/records'); // per-page state
 * __setPathname('/records');                      // switch page mid-test
 * __lastPushedUrl();                              // last push/replace target
 * ```
 */
import { useEffect, useReducer } from 'react';

let params = new URLSearchParams();
let pathname = '/schedule';
let lastUrl: string | null = null;
const listeners = new Set<() => void>();

function notifyAll(): void {
  listeners.forEach((notify) => notify());
}

function setParams(qs: string): void {
  params = new URLSearchParams(qs);
  notifyAll();
}

/**
 * Reset the mocked URL (and pathname); call in beforeEach.
 * NOTE: listeners are NOT cleared here — RTL unmounts between tests and the
 * effect cleanups unsubscribe, while a MID-test `__resetNavigation` (or
 * `__setPathname`) must still notify a mounted component to simulate a real
 * navigation re-render.
 */
export function __resetNavigation(query = '', path = '/schedule'): void {
  pathname = path;
  lastUrl = null;
  setParams(query);
}

/** Switch the mocked pathname mid-test (notifies subscribers). */
export function __setPathname(path: string): void {
  pathname = path;
  notifyAll();
}

/** The full URL of the last push/replace, or null if none since reset. */
export function __lastPushedUrl(): string | null {
  return lastUrl;
}

/** Read the mocked query string as it would appear after location.search. */
export function __currentQuery(): string {
  return params.toString() ? `?${params.toString()}` : '';
}

/** Read the mocked pathname. */
export function __currentPathname(): string {
  return pathname;
}

export function useSearchParams(): URLSearchParams {
  const [, force] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    const notify = () => force();
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, [force]);
  return params;
}

function write(url: string): void {
  lastUrl = url;
  // URLs are written as `/schedule?view=…` — keep only the query part.
  const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  setParams(qs);
}

export function useRouter(): {
  push: (url: string) => void;
  replace: (url: string) => void;
  back: () => void;
  forward: () => void;
  refresh: () => void;
  prefetch: (href: string) => void;
} {
  return {
    push: write,
    replace: write,
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => {},
  };
}

export function usePathname(): string {
  const [, force] = useReducer((c: number) => c + 1, 0);
  useEffect(() => {
    const notify = () => force();
    listeners.add(notify);
    return () => {
      listeners.delete(notify);
    };
  }, [force]);
  return pathname;
}

export function useParams(): Record<string, string> {
  return {};
}
