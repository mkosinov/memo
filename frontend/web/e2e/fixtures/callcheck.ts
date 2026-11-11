/**
 * callcheck.ts — #593 dev-transport helpers for the call-auth e2e specs.
 *
 * The dev transport (CALLCHECK_TRANSPORT=dev, ENV=development — the double
 * gate) hands out a FIXED fake number and confirms checks only via the
 * `POST /auth/call/dev-done` imitator. The frontend never renders the raw
 * one-time handle, so the specs capture it from the initiate RESPONSE in
 * the browser (`waitForResponse`) — the same wire the app itself uses.
 *
 * US-5 (window expiry) needs no backend seam: the dev provider's status()
 * answer is always `waiting`, so a dev check expires ONLY through the
 * LOCAL window check (`created_at` + 300 s in poll_auth_call_status). The
 * `backdateAuthCallWindow` helper time-travels the row's `created_at`
 * past the window but INSIDE the purge TTL (window 300 s + margin 60 s =
 * 360 s) — the semantic-time canon (never wait real seconds for a timer).
 *
 * LOCAL ITERATION BUDGET: the initiate gates are in-memory per backend
 * process (5 DISTINCT phones / IP / 15 min). One full suite run spends 3
 * fresh phones — a CI stack (fresh process) never trips; a long-lived
 * standalone backend saturates after ~2 consecutive local runs (429
 * AUTH_LOCKED_OUT on initiate) — restart it between full-suite reruns.
 */
import type { APIRequestContext, Page } from 'playwright/test';
import { queryDB, queryDBRow } from './db-query';
import { resolveBackendUrl } from '../lib/backend-url';
import { resolveWebPort } from '../lib/stack-port';

/** The dev transport's fixed fake number (callcheck_provider._DEV_CALL_PHONE). */
export const DEV_CALL_PHONE = '+78005553535';
/** Its pretty display form (domain.phones.pretty_phone). */
export const DEV_CALL_PRETTY = '+7 800 555-35-35';

/** The check window constant the backdate helper must respect
 * (backend/src/auth/callcheck_provider.py; the purge TTL is window+60 s). */
const CALLCHECK_WINDOW_SECONDS = 300;

/** e2e contact values (US-4): the same defaults `.env.test` ships — the
 * standalone run loads them into the playwright process (and the stack
 * script exports them for its own `next dev`). */
export const E2E_CONTACT_TELEGRAM =
  process.env.NEXT_PUBLIC_CONTACT_TELEGRAM || 'MemoE2eAdmin';
export const E2E_CONTACT_WHATSAPP =
  process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || '+79005550100';

const esc = (value: string): string => value.replace(/'/g, "''");

/** Synchronous sleep (the helpers run in sync contexts). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run one SQL WRITE against the shared test DB with lock backoff.
 *
 * The stack backend writes to the same SQLite file, and FastAPI commits
 * some transactions AFTER the response was sent (the get_db_session
 * teardown) — a CLI write can collide with an in-flight backend commit
 * ("database is locked"). The donor's 5×200 ms busy-wait is too tight
 * under that contention, so the callcheck writes carry their own budget:
 * 6 attempts with growing sleeps (~4.5 s total), then the caller's policy
 * (the backdate FAILS loud — it is the test path; the cleanup warns and
 * moves on — it must never mask a test result).
 */
function writeWithBackoff(sql: string, what: string): boolean {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      queryDB(sql);
      return true;
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      if (!msg.includes('database is locked')) throw err;
      sleepSync(200 * (attempt + 1));
    }
  }
  console.warn(`[callcheck] SQL write gave up on a locked DB (${what})`);
  return false;
}

/** A unique valid RU mobile per call — `+7` + `909` + 7 random digits
 * (11 digits after the plus, the canonical `+7XXXXXXXXXX` form). Random
 * phones never collide with the seed (staff silence skips staff numbers
 * only) and never hit the in-memory 5-initiates-per-phone gate across
 * spec reruns. */
export function uniqueTestPhone(): string {
  const digits = Math.floor(1_000_000 + Math.random() * 9_000_000);
  return `+7909${digits}`;
}

/** The initiate 202 body the app itself consumes (schemas.ts AuthCallInitiate). */
export interface CallInitiation {
  handle: string;
  call: { phone: string; pretty: string; expires_at: string };
}

/** Click «Подтвердить звонком» and capture the initiate response — the
 * RAW handle exists ONLY on this wire (the DB stores its HMAC digest),
 * so response interception is the only way the spec can imitate the call. */
export async function initiateViaUi(page: Page): Promise<CallInitiation> {
  const respPromise = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/auth/call/initiate') &&
      r.request().method() === 'POST',
  );
  await page.locator('[data-testid="auth-method-call"]').click();
  const resp = await respPromise;
  if (resp.status() !== 202) {
    throw new Error(
      `[callcheck] initiate answered HTTP ${resp.status()}: ${(await resp.text()).slice(0, 200)}`,
    );
  }
  const body = (await resp.json()) as Partial<CallInitiation>;
  if (!body.handle || !body.call) {
    // The silent staff skip — an indistinguishable empty 202 (nothing to poll).
    throw new Error(
      `[callcheck] initiate 202 body has no handle/call (staff skip?): ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return body as CallInitiation;
}

/** Await an initiate response around an action the spec itself triggers
 * (e.g. the «Позвонить ещё раз» button — not the picker's method button). */
export async function captureInitiate(page: Page): Promise<CallInitiation> {
  const resp = await page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/auth/call/initiate') &&
      r.request().method() === 'POST',
  );
  const body = (await resp.json()) as Partial<CallInitiation>;
  if (resp.status() !== 202 || !body.handle || !body.call) {
    throw new Error(
      `[callcheck] initiate answered HTTP ${resp.status()}: ${JSON.stringify(body).slice(0, 200)}`,
    );
  }
  return body as CallInitiation;
}

/** The dev call imitation: `POST /auth/call/dev-done` with the web Origin
 * (the route carries verify_origin — the header must be in the stack's
 * CORS list, exactly what the browser sends). 204 flips the check. */
export async function imitateDevCall(
  request: APIRequestContext,
  handle: string,
): Promise<void> {
  const origin = `http://127.0.0.1:${resolveWebPort()}`;
  const resp = await request.post(
    `${resolveBackendUrl()}/api/v1/auth/call/dev-done`,
    {
      data: { handle },
      headers: { Origin: origin, 'Content-Type': 'application/json' },
    },
  );
  if (resp.status() !== 204) {
    throw new Error(
      `[callcheck] dev-done answered HTTP ${resp.status()}: ${(await resp.text()).slice(0, 200)}`,
    );
  }
}

/**
 * Time-travel the phone's live check past the 300-s window (US-5).
 *
 * Default offset 320 s: beyond the window (expired) but inside the 360-s
 * purge TTL (the row survives `find_by_handle`'s purge-on-touch, so the
 * next browser poll — not a 404 — reports `expired` → «Время вышло»).
 * The dev provider always answers `waiting`, so this local-window path
 * is exactly how a real dev-transport check expires.
 */
export function backdateAuthCallWindow(phone: string): void {
  const ok = writeWithBackoff(
    `UPDATE auth_calls SET created_at = datetime('now', '-${CALLCHECK_WINDOW_SECONDS + 20} seconds') ` +
      `WHERE phone = '${esc(phone)}'`,
    `backdate auth_calls for ${phone}`,
  );
  if (!ok) {
    throw new Error(
      `[callcheck] could not backdate the check row for '${phone}' — the DB stayed locked`,
    );
  }
}

/** Assert the phone's check row exists and is still live (a purge would
 * turn the US-5 poll into the 404 dead end instead of «Время вышло»). */
export function readAuthCallRow(phone: string): Record<string, any> | null {
  return queryDBRow(`SELECT * FROM auth_calls WHERE phone = '${esc(phone)}'`);
}

/** Purge everything a callcheck spec created (Full Cycle cleanup):
 * the record chain (visits → records → client), the auth user the
 * finalizer find-or-created, and both auth_call tables. Lock-resilient
 * and BEST-EFFORT: a locked statement is skipped with a warning — a
 * cleanup failure must never mask the test's own result (the leftover
 * rows are inert: random phones, self-purging auth_calls). */
export function cleanupCallcheckData(phone: string): void {
  const p = esc(phone);
  writeWithBackoff(
    `DELETE FROM visits WHERE record_id IN ` +
      `(SELECT r.id FROM records r JOIN clients c ON r.client_id = c.id WHERE c.phone = '${p}')`,
    `visits for ${phone}`,
  );
  writeWithBackoff(
    `DELETE FROM records WHERE client_id IN (SELECT id FROM clients WHERE phone = '${p}')`,
    `records for ${phone}`,
  );
  writeWithBackoff(`DELETE FROM clients WHERE phone = '${p}'`, `client ${phone}`);
  writeWithBackoff(`DELETE FROM users WHERE phone = '${p}'`, `user ${phone}`);
  writeWithBackoff(`DELETE FROM auth_calls WHERE phone = '${p}'`, `auth_calls ${phone}`);
  writeWithBackoff(
    `DELETE FROM auth_call_attempts WHERE phone = '${p}'`,
    `auth_call_attempts ${phone}`,
  );
}
