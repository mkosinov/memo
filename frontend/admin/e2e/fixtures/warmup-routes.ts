/**
 * warmup-routes.ts — Canonical list of routes to warm up before E2E tests run.
 *
 * Keep in sync with `scripts/e2e-shard-start.sh:135-145` (shell can't import
 * TS, so that script keeps its own copy of this list — update both together).
 *
 * Used by `globalSetup.ts` to pre-compile routes in standalone mode (no
 * shell warmup there), so the first test doesn't race Next.js dev
 * compilation (which otherwise 404s the first `_next/static` chunk request
 * and hangs the page on "Загрузка").
 */
export const WARMUP_ROUTES = [
  '/',
  '/schedule',
  '/clients',
  '/records',
  '/services',
  '/masters',
  '/locations',
  '/tags',
  '/photos',
] as const;
