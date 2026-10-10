/**
 * backend-url.ts — Single source of truth for the backend base URL (GH #387).
 *
 * Postmortem #387/#463: BACKEND_URL was read with a SILENT per-file default
 * at ~60 call sites with several DIFFERENT values (:8000, :8001, :8005 and a
 * localhost variant). A bare standalone run silently probed a port the
 * operator never chose — and could piggyback a foreign shard stack running
 * there. On top of that, .env.test's NEXT_PUBLIC_API_URL=localhost baked a
 * cross-site API origin into the browser bundle while the frontend baseURL
 * is 127.0.0.1: the SameSite=Lax memo_session cookie never reaches the API
 * (site = scheme + host; localhost ≠ 127.0.0.1 — GH #247 T14).
 *
 * Contract (same discipline as db-path.ts, GH #209/#336 — loud error over
 * silent default):
 *   - BACKEND_URL unset/empty → throw with the canonical standalone recipe;
 *   - NEXT_PUBLIC_API_URL unset/empty → throw (the browser bundle is baked
 *     from it — pin it together with BACKEND_URL);
 *   - the two HOSTS differ → throw: the storageState cookie is issued for
 *     BACKEND_URL's host and must match the API the browser calls (ports
 *     are exempt from the site definition, hosts are not);
 *   - otherwise return BACKEND_URL as-is.
 *
 * Shard/CI modes always export both vars with the same host
 * (test-all.sh, e2e-shard-start.sh, test.yml, visual-check.yml,
 * update-snapshots.yml) — the guard is a no-op there. Pinned by a unit
 * test in __tests__/backend-url.test.ts.
 */

/** The canonical standalone recipe — kept verbatim in one place and echoed
 * by the guard errors; the narrative version lives in docs/tests_workflow.md
 * ("How to run") and the dev-workflow skill (§2/§4). SHARD_PORT is pinned to
 * a NON-shard port: the default :3002 belongs to shard 1, and a running full
 * run would be silently reused (webServer reuseExistingServer) with ITS
 * baked API origin — the very foreign-stack piggyback this guard exists to
 * prevent. */
const CANONICAL_RECIPE = [
  '[backend-url] Standalone recipe (full version: docs/tests_workflow.md):',
  '  stack (once per DB lifetime / after a week rollover):',
  '    cd backend && rm -f test_memo.db test_memo.db-shm test_memo.db-wal',
  '    ENV_FILE=.env.test PYTHONPATH=src uv run uvicorn src.main:app --port 8000   # new terminal, keep running',
  '    DATABASE_URL="sqlite+aiosqlite:////$(pwd)/test_memo.db" PYTHONPATH=src uv run python -m seed.seed',
  '    cd .. && python3 scripts/gen_seed_canon.py backend/test_memo.db backend/test_memo.db.canon.sql',
  '  run:',
  '    cd frontend/admin && SHARD_PORT=3005 BACKEND_URL=http://127.0.0.1:8000 NEXT_PUBLIC_API_URL=http://127.0.0.1:8000 pnpm exec playwright test e2e/<spec>.ts',
  'Both URL vars, same host; SHARD_PORT keeps the page off the shard ports (3002/3003).',
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
      `[backend-url] ${missing.join(' and ')} not set — refusing to fall back to a silent default port ` +
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
      `[backend-url] BACKEND_URL/NEXT_PUBLIC_API_URL is not a valid absolute URL: ` +
        `'${backend}' / '${api}'.\n${CANONICAL_RECIPE}`,
    );
  }

  if (backendHost !== apiHost) {
    throw new Error(
      `[backend-url] BACKEND_URL host '${backendHost}' != NEXT_PUBLIC_API_URL host '${apiHost}' — ` +
        `the session cookie is issued for the backend host and is silently dropped on cross-site API ` +
        `calls (SameSite=Lax; localhost and 127.0.0.1 are different sites). Pin both to the same host.\n${CANONICAL_RECIPE}`,
    );
  }

  return backend;
}
