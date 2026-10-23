/**
 * backend-url.ts — Single source of truth for the backend base URL.
 *
 * WEB port of the admin donor (frontend/admin/e2e/lib/backend-url.ts,
 * GH #387): identical contract — loud error over silent default.
 *   - BACKEND_URL unset/empty → throw with the canonical web recipe;
 *   - NEXT_PUBLIC_API_URL unset/empty → throw (the browser bundle is
 *     baked from it — pin it together with BACKEND_URL);
 *   - the two HOSTS differ → throw: the `memo_client_session` cookie is
 *     issued for BACKEND_URL's host (HttpOnly, SameSite=Lax) and is
 *     silently dropped on cross-site API calls (site = scheme + host;
 *     localhost ≠ 127.0.0.1; ports are exempt from the site definition).
 *
 * The web-e2e stack (scripts/test-e2e.sh → scripts/e2e-stack.sh) exports
 * both vars with the run's dynamic 127.0.0.1 ports — the guard is a
 * no-op there.
 */

/** The canonical web-e2e recipe — echoed by the guard errors. The stack
 *  script owns the port window (28000-32700, dev-workflow canon); the
 *  standalone fallback mirrors the admin standalone recipe (backend
 *  :8000), with CORS extended to the web port or the client-session
 *  cookie never reaches cross-origin credentialed fetches. */
const CANONICAL_RECIPE = [
  '[web-e2e] Stack recipe (simplest reliable path):',
  '  cd frontend/web && pnpm run test:e2e:stack   # scripts/test-e2e.sh: tag + 4 dynamic ports + stack + playwright + teardown',
  '',
  '  Manual standalone stack (mirror of the admin recipe, dev-workflow §4):',
  '    cd backend && rm -f test_memo.db test_memo.db-shm test_memo.db-wal',
  '    ENV_FILE=.env.test PYTHONPATH=src CORS_ORIGINS="http://localhost:3007,http://127.0.0.1:3007" OTP_TRANSPORT=dev \\',
  '      uv run uvicorn src.main:app --port 8000   # new terminal, keep running',
  '    DATABASE_URL="sqlite+aiosqlite:////$(pwd)/test_memo.db" PYTHONPATH=src uv run python -m seed.seed',
  '  run:',
  '    cd frontend/web && WEB_PORT=3007 BACKEND_URL=http://127.0.0.1:8000 NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 \\',
  '      TEST_DB_PATH=backend/test_memo.db pnpm exec playwright test',
  'Both URL vars, same host; WEB_PORT stays off the admin shard ports (3002-3005),',
  'the notify pair (3006/8005), the playground (3100/3101) and legacy dev (3000/8000) front ports.',
  'OTP_TRANSPORT=dev is REQUIRED: without a transport the code request is fail-closed 503 (#499 §4.2).',
].join('\n');

export function resolveBackendUrl(): string {
  const backend = (process.env.BACKEND_URL || '').trim();
  const api = (process.env.NEXT_PUBLIC_API_URL || '').trim();

  const missing = [
    ...(backend ? [] : ['BACKEND_URL']),
    ...(api ? [] : ['NEXT_PUBLIC_API_URL']),
  ];
  if (missing.length > 0) {
    throw new Error(
      `[web-e2e] ${missing.join(' and ')} not set — refusing to fall back to a silent default port ` +
        `(a bare run could piggyback a foreign stack, GH #387/#463).\n${CANONICAL_RECIPE}`,
    );
  }

  let backendHost: string;
  let apiHost: string;
  try {
    backendHost = new URL(backend).hostname;
    apiHost = new URL(api).hostname;
  } catch {
    throw new Error(
      `[web-e2e] BACKEND_URL/NEXT_PUBLIC_API_URL is not a valid absolute URL: ` +
        `'${backend}' / '${api}'.\n${CANONICAL_RECIPE}`,
    );
  }

  if (backendHost !== apiHost) {
    throw new Error(
      `[web-e2e] BACKEND_URL host '${backendHost}' != NEXT_PUBLIC_API_URL host '${apiHost}' — ` +
        `the client session cookie is issued for the backend host and is silently dropped on cross-site ` +
        `API calls (SameSite=Lax; localhost and 127.0.0.1 are different sites). Pin both to the same host.\n${CANONICAL_RECIPE}`,
    );
  }

  return backend;
}
