/**
 * globalSetup.ts — #513 web-e2e boot: verify the stack, then log the
 * seed client in via the REAL #523 OTP flow and persist the session.
 *
 * WEB adaptation of the admin donor (frontend/admin/e2e/globalSetup.ts).
 * Deviations from the donor, each forced by the client-auth flow:
 *   - the login is the #523 OTP flow (phone → code → verify), not a
 *     password POST; the code is read DIRECTLY from the test DB
 *     (fixtures/otp-code.ts — the spec's "SQL-хелперы по образцу
 *     seed-ids" requirement), NOT from the response's dev_code echo;
 *   - the seed-contract check is the #513 delta (c1+c2 clients, a
 *     NON-public photo), not the admin volume contract — a foreign or
 *     un-delta'd DB aborts loud before any browser opens;
 *   - no canon reset here: the smoke specs are read-only plus the OTP
 *     login itself; per-test seed resets arrive with the C-scenarios
 *     (Tasks 7-10) if their specs need them.
 */
import fs from 'fs';
import path from 'path';
import { clientAuthStatePath } from './fixtures/client-auth-state';
import { readOtpCode } from './fixtures/otp-code';
import { queryDBRow } from './fixtures/db-query';
import { resolveBackendUrl } from './lib/backend-url';
import { resolveWebPort } from './lib/stack-port';
import { resolveTestDbPath } from './lib/db-path';

/** Seed client c1 «Анна Иванова» — the cabinet's first user (#513 seed
 *  delta; phone is the stable business key, GH #491 canon). */
const SEED_CLIENT_C1_PHONE = '+79001234567';

/**
 * The #513 seed-delta contract: both cabinet clients present AND at
 * least one NON-public photo (ph_c1_private — the С3 fixture). Catches a
 * foreign DB, an unseeded stack, or a stale seed WITHOUT the delta
 * BEFORE the login burns a rate-limit slot on a wrong backend.
 */
function assertSeedDelta(dbPath: string): void {
  let row: Record<string, any> | null = null;
  try {
    row = queryDBRow(
      `SELECT (SELECT COUNT(*) FROM clients WHERE phone IN ('+79001234567', '+79002345678')) AS cabinet_clients,` +
        ` (SELECT COUNT(*) FROM photos WHERE is_public = 0) AS non_public_photos`,
    );
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.includes('no such table') || msg.includes('unable to open database')) {
      throw new Error(
        `[#513] Test DB not initialized at ${dbPath}. The web-e2e stack was not started. ` +
          `Run \`cd frontend/web && pnpm run test:e2e:stack\` (scripts/test-e2e.sh) or follow the ` +
          `standalone recipe in e2e/lib/backend-url.ts. Original error: ${msg.trim()}`,
      );
    }
    throw err;
  }
  const clients = Number(row?.cabinet_clients ?? 0);
  const nonPublic = Number(row?.non_public_photos ?? 0);
  if (clients < 2 || nonPublic < 1) {
    throw new Error(
      `[#513] Seed delta missing from ${dbPath}: cabinet_clients=${clients} (want ≥2: c1+c2), ` +
        `non_public_photos=${nonPublic} (want ≥1: ph_c1_private). The stack seeded a stale seed or a ` +
        `foreign DB — restart it via scripts/test-e2e.sh.`,
    );
  }
  console.log(`[web-e2e globalSetup] Seed delta OK: cabinet_clients=${clients}, non_public_photos=${nonPublic}`);
}

/** Wait for the backend's /docs (the stack script's own readiness probe). */
async function waitForBackend(backendBase: string): Promise<void> {
  let lastErr: string = '';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await fetch(`${backendBase}/docs`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) return;
      lastErr = `HTTP ${resp.status}`;
    } catch (err: any) {
      lastErr = String(err?.message || err);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `[#513] Backend not responding at ${backendBase}/docs after 5 retries (${lastErr}). ` +
      `Start the web-e2e stack: cd frontend/web && pnpm run test:e2e:stack`,
  );
}

/**
 * The client-session fixture: request an OTP code for c1's phone, read
 * the code from the test DB, verify, and persist the `memo_client_session`
 * cookie as a Playwright storageState file (the admin donor's
 * loginAndSaveStorageState shape, OTP flow substituted for the login).
 */
async function loginClientAndSaveStorageState(
  backendBase: string,
  webOrigin: string,
  phone: string,
  storageStatePath: string,
): Promise<void> {
  const { request: playwrightRequest } = await import('playwright/test');
  // Origin = the WEB origin (exactly what the browser sends): the OTP
  // routes carry verify_origin (#499 §4.2) — the header must be in the
  // stack's CORS list, which lists the web origins.
  const ctx = await playwrightRequest.newContext({
    baseURL: backendBase,
    extraHTTPHeaders: { Origin: webOrigin },
  });
  try {
    const requestResp = await ctx.post('/api/v1/auth/otp/request', {
      data: { phone },
      headers: { 'Content-Type': 'application/json' },
    });
    if (requestResp.status() !== 202) {
      throw new Error(
        `[web-e2e globalSetup] OTP request for ${phone} failed: HTTP ${requestResp.status()} ` +
          `${(await requestResp.text()).slice(0, 200)} — is the stack backend running with OTP_TRANSPORT=dev?`,
      );
    }

    // The code comes from the TEST DB (spec-mandated), never from the
    // response's dev_code echo — this also proves the otp_codes row
    // landed where the verify flow will consume it.
    const code = readOtpCode(phone);
    console.log(`[web-e2e globalSetup] OTP code for ${phone} recovered from the test DB`);

    const verifyResp = await ctx.post('/api/v1/auth/otp/verify', {
      data: { phone, code },
      headers: { 'Content-Type': 'application/json' },
    });
    if (!verifyResp.ok()) {
      throw new Error(
        `[web-e2e globalSetup] OTP verify for ${phone} failed: HTTP ${verifyResp.status()} ` +
          `${(await verifyResp.text()).slice(0, 200)}`,
      );
    }
    const me = (await verifyResp.json()) as { phone?: string };
    if (me.phone !== phone) {
      throw new Error(
        `[web-e2e globalSetup] OTP verify returned unexpected payload: ${JSON.stringify(me).slice(0, 200)}`,
      );
    }

    // Persist in the STANDARD domain+path cookie form (ctx.storageState's
    // own output): browser contexts host-match `domain: 127.0.0.1` on any
    // port — same site as both the web app (127.0.0.1:WEB_PORT) and the
    // API (BACKEND_URL host) — and request contexts REQUIRE domain+path
    // (the admin donor's storageState note).
    fs.mkdirSync(path.dirname(storageStatePath), { recursive: true });
    await ctx.storageState({ path: storageStatePath });
    console.log(`[web-e2e globalSetup] Client storageState saved: ${storageStatePath}`);
  } finally {
    await ctx.dispose();
  }
}

export default async function globalSetup() {
  const dbPath = resolveTestDbPath({ testDbPath: process.env.TEST_DB_PATH });
  const backendBase = resolveBackendUrl();
  const webPort = resolveWebPort();

  assertSeedDelta(dbPath);
  await waitForBackend(backendBase);
  await loginClientAndSaveStorageState(
    backendBase,
    `http://127.0.0.1:${webPort}`,
    SEED_CLIENT_C1_PHONE,
    clientAuthStatePath(),
  );

  // Warm up the cabinet routes so the first spec doesn't race the Next
  // dev-server's on-demand compilation (the admin WARMUP_ROUTES lesson —
  // /cabinet plus the #513 Task 7 records section).
  for (const route of ['/cabinet', '/cabinet/records']) {
    try {
      await fetch(`http://127.0.0.1:${webPort}${route}`, { signal: AbortSignal.timeout(60_000) });
      console.log(`[web-e2e globalSetup] Warmed up ${route} on :${webPort}`);
    } catch {
      // best-effort: the request still triggered the dev compile
    }
  }
}
