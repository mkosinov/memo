/**
 * globalSetup.ts — Clean test data before each E2E run.
 *
 * Per-shard mode (via test-all.sh):
 *   SHARD_ID is set → uses test_memo_shard{1-5}.db
 *
 * Standalone mode (manual playwright test):
 *   SHARD_ID not set → uses TEST_DB_PATH or default test_memo.db
 *
 * Removes all non-seed data (clients, records, payments, visits, activities,
 * visitors) and restores seed attributes (masters/locations sort_order) via
 * the shared canonical RESET_SQL (fixtures/seed-reset.ts, GH #252)
 * so each test run starts with a clean state.
 *
 * Seed IDs are short (c1..c5, r1..r6, v1..v10, p1..p6, ev_0..ev_44)
 * so length checks distinguish them from UUID test data.
 */
import path from 'path';
import { RESET_SQL } from './fixtures/seed-reset';
import { sqliteExecWithRetry } from './fixtures/sqlite-exec';
import { WARMUP_ROUTES } from './fixtures/warmup-routes';

export default async function globalSetup() {
  // Per-shard DB: test_memo_shard{id}.db
  // Falls back to TEST_DB_PATH or default test_memo.db for backwards compat.
  const shardId = process.env.SHARD_ID;
  const dbPath = shardId
    ? path.resolve(__dirname, `../../../backend/test_memo_shard${shardId}.db`)
    : process.env.TEST_DB_PATH
      || path.resolve(__dirname, '../../../backend/test_memo.db');

  console.log(`[globalSetup] Cleaning DB: ${dbPath}${shardId ? ` (shard ${shardId})` : ''}`);

  // Delete all non-seed data + restore seed attributes via the shared
  // canonical RESET_SQL (GH #252 — children first to respect FK constraints;
  // the exact statement lives in fixtures/seed-reset.ts and is also consumed
  // by the per-test reset fixture).
  try {
    sqliteExecWithRetry(`sqlite3 "${dbPath}" "${RESET_SQL}"`);
  } catch (err: any) {
    // Only swallow "no such table" (DB not yet created) or "no such file"
    const msg = String(err?.stderr || err?.message || '');
    if (msg.includes('no such table') || msg.includes('no such file') || msg.includes('unable to open database')) {
      console.warn(`[globalSetup] DB not ready or missing tables, skipping clean: ${msg.trim()}`);
      // Fall through to warmup below — DB-not-ready is not fatal, and
      // warmup runs regardless of the clean outcome (only a real error
      // that propagates as a throw should abort before warmup runs).
    } else {
      // Real errors should propagate (DB locked, permissions, etc.)
      console.error(`[globalSetup] ERROR cleaning DB: ${msg}`);
      throw err;
    }
  }

  // #152: diagnostic — assert seed contract before tests run. Two checks:
  // (a) reject if leftover seed rows exist (ev_*, r1-r6, etc.) — means the DB
  //     was not wiped + reseeded by scripts/e2e-shard-start.sh, likely a
  //     manual `npx playwright test` bypass. Abort with diagnostic.
  // (b) assert API returns ≥1 activity for the current week. Empty = seed
  //     did not populate (e.g., seed failure, week rollover against stale
  //     data, missing seed subprocess). Abort with diagnostic.

  // (a) Leftover seed rows check
  let leftoverSeedRows = 0;
  try {
    const result = sqliteExecWithRetry(`sqlite3 "${dbPath}" "SELECT COUNT(*) FROM (SELECT 1 FROM activities WHERE id LIKE 'ev_%' OR id LIKE 'ev_fixed_%' UNION SELECT 1 FROM records WHERE id IN ('r1','r2','r3','r4','r5','r6') UNION SELECT 1 FROM visits WHERE id IN ('v1','v2','v3','v4','v5','v6','v7','v8','v9','v10') UNION SELECT 1 FROM payments WHERE id IN ('p1','p2','p3','p4','p5','p6'))"`);
    leftoverSeedRows = parseInt(result, 10) || 0;
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || '');
    if (msg.includes('no such table') || msg.includes('no such file')) {
      // DB missing → probably first run, shard-start hasn't run yet. Fail loud too.
      throw new Error(`[#152] Test DB not initialized at ${dbPath}. The shard stack was not started via scripts/e2e-shard-start.sh. Run \`bash scripts/test-all.sh\` (CI/local) or \`SHARD_ID=N ... bash scripts/e2e-shard-start.sh\` (standalone), then retry playwright. Original error: ${msg.trim()}`);
    }
    throw err;
  }
  if (leftoverSeedRows === 0) {
    throw new Error(`[#152] Seed data is missing from ${dbPath}. Expected ev_*/ev_fixed_*/r1-r6/v1-v10/p1-p6 rows. The shard stack was not started via scripts/e2e-shard-start.sh (which wipes + reseeds the DB). Run \`bash scripts/test-all.sh\` or \`SHARD_ID=N ... bash scripts/e2e-shard-start.sh\`, then retry playwright.`);
  }

  // (b) Current-week activities check (with 5×1s retry for 503 race)
  // #153: use BACKEND_URL (exported by test-all.sh:181 and test.yml:152 as
  // http://127.0.0.1:8001/8002). Do NOT use SHARD_PORT — that's the Next.js
  // frontend port; /api/v1/* returns 404 from Next.js dev server.
  const backendBase = process.env.BACKEND_URL
    || `http://localhost:${process.env.BACKEND_PORT || '8001'}`;
  const today = new Date();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Mon=0
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const activitiesUrl = `${backendBase}/api/v1/activities?date_from=${fmt(monday)}&date_to=${fmt(sunday)}`;

  let activitiesResponse: Response | null = null;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      activitiesResponse = await fetch(activitiesUrl, { signal: AbortSignal.timeout(5000) });
      if (activitiesResponse.ok) break;
    } catch (err: any) {
      lastErr = err;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (!activitiesResponse || !activitiesResponse.ok) {
    throw new Error(`[#152] Backend /api/v1/activities not responding at ${activitiesUrl} after 5 retries. Last error: ${lastErr?.message || 'HTTP ' + activitiesResponse?.status}. Backend not started? Run \`bash scripts/test-all.sh\` to start the full stack.`);
  }
  const activitiesJson = await activitiesResponse.json() as any;
  // #182: activities list is paginated ({items,total,page,per_page}) — unwrap envelope
  const activitiesList: any[] = activitiesJson.items || activitiesJson;
  if (activitiesList.length === 0) {
    throw new Error(`[#152] No activities for the current week (${fmt(monday)} to ${fmt(sunday)}) at ${dbPath}. Seed did not populate — likely a stale DB or calendar week rollover without re-seed. Run \`bash scripts/test-all.sh\` or \`SHARD_ID=N ... bash scripts/e2e-shard-start.sh\` to wipe+reseed, then retry.`);
  }
  console.log(`[globalSetup] Seed contract verified: ${leftoverSeedRows} seed rows + ${activitiesList.length} activities for current week.`);

  // GH #247 T14: authenticate as the seeded admin ONCE per run and persist
  // the session cookie as a Playwright storageState file. Every project
  // then starts authenticated (cookie attached automatically); login-flow
  // specs opt out with `test.use({ storageState: { cookies: [], origins: [] } })`.
  // The login POST goes to the BACKEND origin — the cookie is issued for
  // that host and only flows on API calls, which is exactly what the specs
  // need. The session row is created here; RESET_SQL deliberately does NOT
  // touch users/sessions (GH #252 §3.1), so the cookie survives per-test
  // resets. HttpOnly is preserved in the storageState; SameSite=Lax holds
  // because the frontend baseURL is 127.0.0.1 (same site as the API).
  const { request: playwrightRequest } = await import('@playwright/test');
  const authDir = path.resolve(__dirname, '../../test-results/.auth');
  const storageStatePath = path.join(authDir, 'admin.json');
  const loginUrl = `${backendBase}/api/v1/auth/login`;
  const ctx = await playwrightRequest.newContext({
    baseURL: backendBase,
    extraHTTPHeaders: { Origin: backendBase.replace(/:\d+$/, ''), 'Sec-Fetch-Site': 'same-origin' },
  });
  try {
    const loginResp = await ctx.post(loginUrl, {
      data: { phone: '+79990000001', password: 'admin12345' },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!loginResp.ok()) {
      throw new Error(
        `[globalSetup] Admin login failed at ${loginUrl}: HTTP ${loginResp.status()} ${await loginResp.text()}`,
      );
    }
    const me = await loginResp.json() as { user?: { role?: string } };
    if (me.user?.role !== 'admin') {
      throw new Error(`[globalSetup] Login as seeded admin returned unexpected payload: ${JSON.stringify(me).slice(0, 200)}`);
    }
    // Persist in the STANDARD domain+path cookie form (ctx.storageState's
    // own output): browser contexts host-match `domain: 127.0.0.1` on any
    // port — same-site with both the frontend (127.0.0.1:{SHARD_PORT}) and
    // the API (BACKEND_URL is 127.0.0.1 too) — and request contexts
    // (factories via apiRequest.newContext) REQUIRE domain+path. (A
    // `url`-only cookie breaks request contexts; sameSite=Lax holds because
    // scheme+host match, ports are exempt from the site definition.)
    const fs = await import('fs');
    fs.mkdirSync(authDir, { recursive: true });
    await ctx.storageState({ path: storageStatePath });
    console.log(`[globalSetup] Admin storageState saved: ${storageStatePath}`);
  } finally {
    await ctx.dispose();
  }

  // #126: standalone mode has no shell warmup — pre-compile routes so the
  // first test doesn't race Next.js dev compilation (404 _next/static).
  if (!process.env.SHARD_ID) {
    const port = process.env.SHARD_PORT || '3002';
    console.log(`[globalSetup] Warming up ${WARMUP_ROUTES.length} routes on :${port} (standalone mode)`);
    for (const route of WARMUP_ROUTES) {
      try {
        await fetch(`http://localhost:${port}${route}`, { signal: AbortSignal.timeout(60_000) });
      } catch {
        // best-effort: request still triggers dev compile even on failure
      }
    }
  }
}
