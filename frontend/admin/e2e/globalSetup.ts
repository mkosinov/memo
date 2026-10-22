/**
 * globalSetup.ts — Clean test data before each E2E run.
 *
 * Per-shard mode (via test-all.sh):
 *   SHARD_ID is set → uses test_memo_shard{1,2}.db, plus an optional
 *   _${SHARD_RUN_TAG} suffix when the run tag is set (#317: test-all.sh
 *   tags every run's DB/files/build dirs for parallel-run isolation)
 *
 * Standalone mode (manual playwright test):
 *   SHARD_ID not set → uses TEST_DB_PATH or default test_memo.db
 *
 * GH #310: applies the canonical seed-reset script (generated at stack
 * startup by scripts/gen_seed_canon.py — total restore of every table
 * except audit_logs/sessions, see fixtures/seed-reset.ts), sanity-checks
 * the canon against the live schema, then verifies the seed contract
 * (#152) and logs in admin+master. The per-test fixture applies the same
 * canon before every test.
 */
import path from 'path';
import fs from 'fs';
import { resolveTestDbPath } from './lib/db-path';
import { resolveBackendUrl } from './lib/backend-url';
import { masterAuthStatePath, resolveAuthStatePath } from './fixtures/auth-state';
import { resetToSeed, resolveSeedCanonPath, wipeAvatarsDir } from './fixtures/seed-reset';
import { sqliteExecWithRetry } from './fixtures/sqlite-exec';
import { SEED_WEEK_MONDAY, SEED_WEEK_SUNDAY } from './fixtures/seed-week';
import { WARMUP_ROUTES } from './fixtures/warmup-routes';

/**
 * GH #263 T8 — issue ONE API login and persist the session cookie as a
 * Playwright storageState file. Shared by the admin block (GH #247 T14)
 * and the master block below: both roles' files are written per run so
 * master-role specs opt in via `useMasterSession()` with a live token.
 */
async function loginAndSaveStorageState(
  backendBase: string,
  phone: string,
  password: string,
  expectedRole: string,
  storageStatePath: string,
): Promise<void> {
  const { request: playwrightRequest } = await import('@playwright/test');
  const loginUrl = `${backendBase}/api/v1/auth/login`;
  const ctx = await playwrightRequest.newContext({
    baseURL: backendBase,
    // Full origin incl. port (same as auth-session.spec's API login): CORS
    // echoes the request Origin and the CSRF line checks Sec-Fetch-Site —
    // the port is part of the origin and must not be stripped.
    extraHTTPHeaders: { Origin: backendBase, 'Sec-Fetch-Site': 'same-origin' },
  });
  try {
    const loginResp = await ctx.post(loginUrl, {
      data: { phone, password },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!loginResp.ok()) {
      throw new Error(
        `[globalSetup] Login as ${phone} failed at ${loginUrl}: HTTP ${loginResp.status()} ${await loginResp.text()}`,
      );
    }
    const me = await loginResp.json() as { user?: { role?: string } };
    if (me.user?.role !== expectedRole) {
      throw new Error(`[globalSetup] Login as ${phone} returned unexpected payload: ${JSON.stringify(me).slice(0, 200)}`);
    }
    // Persist in the STANDARD domain+path cookie form (ctx.storageState's
    // own output): browser contexts host-match `domain: 127.0.0.1` on any
    // port — same-site with both the frontend (127.0.0.1:{SHARD_PORT}) and
    // the API (BACKEND_URL is 127.0.0.1 too) — and request contexts
    // (factories via apiRequest.newContext) REQUIRE domain+path. (A
    // `url`-only cookie breaks request contexts; sameSite=Lax holds because
    // scheme+host match, ports are exempt from the site definition.)
    const fs = await import('fs');
    fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
    await ctx.storageState({ path: storageStatePath });
    console.log(`[globalSetup] ${expectedRole} storageState saved: ${storageStatePath}`);
  } finally {
    await ctx.dispose();
  }
}

/** Tables the canonical reset deliberately never touches (GH #310). */
const CANON_EXCEPTIONS = new Set([
  'audit_logs',
  'sessions',
  // #482 §5 — nondeterministic notify journal chain (audit_logs precedent),
  // mirrors BLACKLIST_TABLES in scripts/gen_seed_canon.py (notify_templates
  // is NOT excepted — deterministic seed, stays in the canon):
  'domain_events',
  'notify_tasks',
  'notify_task_attempts',
]);

/**
 * GH #310 — sanity-check the canon file against the live schema: non-empty,
 * and it must DELETE every table except the two by-design exceptions. An
 * empty / truncated / foreign / pre-migration canon would otherwise
 * silently become the "restored" state of the whole run.
 */
function sanityCheckCanon(dbPath: string): void {
  const canonPath = resolveSeedCanonPath();
  let canon = '';
  try {
    canon = fs.readFileSync(canonPath, 'utf-8');
  } catch (err: any) {
    // A missing canon on a not-yet-initialized DB stays non-fatal here —
    // the #152 check below owns the loud "stack was not started" error.
    const msg = String(err?.message || '');
    if (msg.includes('ENOENT')) {
      console.warn(`[globalSetup] Canon file not found (non-fatal, #152 check will fail loud if the DB is real): ${canonPath}`);
      return;
    }
    throw err;
  }
  if (canon.length < 100) {
    throw new Error(`[#310] Canon file looks empty/truncated (${canon.length} bytes): ${canonPath}. Regenerate by restarting the shard stack (scripts/e2e-shard-start.sh).`);
  }
  const deleted = new Set(Array.from(canon.matchAll(/DELETE FROM "([^"]+)"/g), (m) => m[1]));
  const schemaTables = sqliteExecWithRetry(
    `sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"`,
  )
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const expected = schemaTables.filter((t) => !CANON_EXCEPTIONS.has(t));
  const missing = expected.filter((t) => !deleted.has(t));
  if (missing.length > 0) {
    throw new Error(
      `[#310] Canon file ${canonPath} does not cover schema table(s): ${missing.join(', ')}. ` +
        `It was likely generated before a schema change — restart the shard stack to regenerate.`,
    );
  }
  console.log(`[globalSetup] Canon sanity OK: ${deleted.size} tables covered, exceptions: ${Array.from(CANON_EXCEPTIONS).join(', ')}.`);
}

export default async function globalSetup() {
  // Per-shard DB via the shared GH #209 resolver (e2e/lib/db-path.ts):
  // SHARD_ID → canonical shard DB; a SHARD_ID × TEST_DB_PATH conflict is
  // a loud error; otherwise TEST_DB_PATH or the default test_memo.db.
  const shardId = process.env.SHARD_ID;
  const dbPath = resolveTestDbPath({
    shardId,
    testDbPath: process.env.TEST_DB_PATH,
  });

  console.log(`[globalSetup] Cleaning DB: ${dbPath}${shardId ? ` (shard ${shardId})` : ''}`);

  // GH #310 — boot application of the canonical seed-reset script. The canon
  // (generated by gen_seed_canon.py at stack startup, right after the seed)
  // restores EVERY table except audit_logs/sessions. On a long-lived stack a
  // later run starts on a garbage DB from the previous run: applying the
  // canon here brings it back to seed BEFORE the #152 seed-contract check
  // below and the storageState logins after it (their session rows live in
  // the `sessions` exception and survive every reset, GH #252 §3.1).
  try {
    resetToSeed();
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

  // GH #310 — canon sanity: the file must be non-empty and must carry a
  // DELETE for every schema table except the two by-design exceptions
  // (audit_logs, sessions). Catches an empty / truncated / foreign / stale
  // canon (e.g. generated before a migration added a table) BEFORE it
  // silently becomes the "restored" state of the whole run.
  sanityCheckCanon(dbPath);

  // GH #262 §6 — wipe the test-scoped avatars dir together with the DB so a
  // portrait uploaded by an earlier run never leaks into this one (seed users
  // carry no avatars; the canonical post-reset state is an empty dir). The
  // backend re-creates it on the next upload/boot. Best-effort: a missing dir
  // is not an error (rmSync force:true).
  try {
    wipeAvatarsDir();
  } catch (err: any) {
    console.warn(`[globalSetup] Could not wipe avatars dir (non-fatal): ${String(err?.message || '').trim()}`);
  }

  // #152: diagnostic — assert seed contract before tests run. Two checks:
  // (a) assert the seeded volume is present (55 activities / 6 records /
  //     10 visits / 6 payments) — means the DB was wiped + reseeded by
  //     scripts/e2e-shard-start.sh; a manual `npx playwright test` bypass
  //     on a foreign DB aborts with a diagnostic. (Count-based since
  //     GH #491: seed ids are UUIDs, there is no id pattern to grep.)
  // (b) assert API returns ≥1 activity for the seed REFERENCE week
  //     (GH #422: the seed pins functional weeks to fixed dates — the
  //     reference week is 2026-06-01…07, not the current calendar week).
  //     Empty = seed did not populate (e.g., seed failure, stale DB or
  //     canon, missing seed subprocess). Abort with diagnostic.

  // (a) Seeded-volume presence check
  let seedVolume: { activities: number; records: number; visits: number; payments: number } | null = null;
  try {
    const result = sqliteExecWithRetry(`sqlite3 -json "${dbPath}" "SELECT (SELECT COUNT(*) FROM activities) AS activities, (SELECT COUNT(*) FROM records) AS records, (SELECT COUNT(*) FROM visits) AS visits, (SELECT COUNT(*) FROM payments) AS payments"`);
    seedVolume = JSON.parse(result)[0] ?? null;
  } catch (err: any) {
    const msg = String(err?.stderr || err?.message || '');
    if (msg.includes('no such table') || msg.includes('no such file')) {
      // DB missing → probably first run, shard-start hasn't run yet. Fail loud too.
      throw new Error(`[#152] Test DB not initialized at ${dbPath}. The shard stack was not started via scripts/e2e-shard-start.sh. Run \`bash scripts/test-all.sh\` (CI/local) or \`SHARD_ID=N ... bash scripts/e2e-shard-start.sh\` (standalone), then retry playwright. Original error: ${msg.trim()}`);
    }
    throw err;
  }
  const volume = seedVolume && {
    activities: Number(seedVolume.activities),
    records: Number(seedVolume.records),
    visits: Number(seedVolume.visits),
    payments: Number(seedVolume.payments),
  };
  if (
    !volume ||
    volume.activities < 55 ||
    volume.records < 6 ||
    volume.visits < 10 ||
    volume.payments < 6
  ) {
    throw new Error(`[#152] Seed data is missing from ${dbPath}. Expected the seeded volume (55 activities / 6 records / 10 visits / 6 payments), got ${JSON.stringify(volume)}. The shard stack was not started via scripts/e2e-shard-start.sh (which wipes + reseeds the DB). Run \`bash scripts/test-all.sh\` or \`SHARD_ID=N ... bash scripts/e2e-shard-start.sh\`, then retry playwright.`);
  }

  // (b) Seed reference-week activities check (with 5×1s retry for 503 race)
  // #153: use BACKEND_URL (exported by test-all.sh and test.yml as
  // http://127.0.0.1:8001/8002). Do NOT use SHARD_PORT — that's the Next.js
  // frontend port; /api/v1/* returns 404 from Next.js dev server.
  // GH #387: single resolver — no silent default port, host must match
  // NEXT_PUBLIC_API_URL (loud error with the standalone recipe otherwise).
  // GH #422: the week under check is imported from fixtures/seed-week.ts —
  // the SINGLE TS-side source of the reference date (guard, navigation
  // defaults and factory dates must not drift apart). date_from/date_to
  // are derived from the constant itself, never serialized from the real
  // clock, so the guard stays deterministic on any run date.
  const backendBase = resolveBackendUrl();
  const activitiesUrl = `${backendBase}/api/v1/activities?date_from=${SEED_WEEK_MONDAY}&date_to=${SEED_WEEK_SUNDAY}`;

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
    throw new Error(`[#152] No activities for the seed reference week (${SEED_WEEK_MONDAY} to ${SEED_WEEK_SUNDAY}) at ${dbPath}. сид не в опорной неделе — перезапусти стек (канон пуст или устарел).`);
  }
  console.log(`[globalSetup] Seed contract verified: ${JSON.stringify(volume)} + ${activitiesList.length} activities for the seed reference week.`);

  // GH #247 T14: authenticate as the seeded admin ONCE per run and persist
  // the session cookie as a Playwright storageState file. Every project
  // then starts authenticated (cookie attached automatically); login-flow
  // specs opt out with `test.use({ storageState: { cookies: [], origins: [] } })`.
  // The login POST goes to the BACKEND origin — the cookie is issued for
  // that host and only flows on API calls, which is exactly what the specs
  // need. The session rows created here live in the `sessions` canon
  // exception (GH #252 §3.1 / GH #310) and survive every per-test reset;
  // `users` IS restored, but seed users return with the same ids, so the
  // session→user references stay valid. HttpOnly is preserved in the storageState; SameSite=Lax holds
  // because the frontend baseURL is 127.0.0.1 (same site as the API).
  // The filename is shard-scoped (shared helper — playwright.config.ts
  // derives the SAME admin path, fixtures/master-session.ts the SAME
  // master path): parallel shards must not read each other's
  // foreign-DB tokens.
  await loginAndSaveStorageState(
    backendBase,
    '+79990000001',
    'admin12345',
    'admin',
    resolveAuthStatePath(),
  );

  // GH #263 T8: second login — the seeded DEMO MASTER (#247 §3.11). The
  // token lands in a separate shard-scoped file; master-role specs (T9/T10)
  // opt in via `useMasterSession()` (fixtures/master-session.ts). Admin
  // projects and login-flow specs are unaffected. Failures abort the run
  // loudly, same as the admin login above.
  await loginAndSaveStorageState(
    backendBase,
    '+79990000002',
    'master12345',
    'master',
    masterAuthStatePath(),
  );

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
