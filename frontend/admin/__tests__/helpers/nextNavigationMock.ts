/**
 * #138 Task 2 — mock of `next/navigation` for unit tests that render the REAL
 * URL-backed hooks (useScheduleView → ScheduleViewProvider → …).
 *
 * Unlike a static mock, `push`/`replace` UPDATE the mocked search params and
 * notify subscribers, so components re-render with the new URL — mirroring the
 * App Router. Tests drive navigation through the real UI (e.g. nextPeriod)
 * instead of hand-poking context state.
 *
 * Usage in a test file:
 * ```ts
 * vi.mock('next/navigation', async () => await import('./helpers/nextNavigationMock'));
 * import { __resetNavigation, __currentQuery } from './helpers/nextNavigationMock';
 * beforeEach(() => __resetNavigation());          // '' = no params
 * __resetNavigation('?date=2026-09-16');          // seed a viewed week
 * ```
 */
import { useEffect, useReducer } from 'react';

let params = new URLSearchParams();
const listeners = new Set<() => void>();

function setParams(qs: string): void {
  params = new URLSearchParams(qs);
  listeners.forEach((notify) => notify());
}

/** Reset the mocked URL; call in beforeEach. */
export function __resetNavigation(query = ''): void {
  listeners.clear();
  setParams(query);
}

/** Read the mocked query string as it would appear after location.search. */
export function __currentQuery(): string {
  return params.toString() ? `?${params.toString()}` : '';
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
  return '/schedule';
}

export function useParams(): Record<string, string> {
  return {};
}
