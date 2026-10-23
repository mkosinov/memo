/**
 * otp-code.ts — the #513 client-session SQL helper: read the pending
 * OTP login code for a phone DIRECTLY from the test DB.
 *
 * Modeled on the admin seed-ids.ts donor (one SQL implementation per
 * business key, loud failure on a missing row — GH #491 canon).
 *
 * Why brute-force: the backend NEVER persists the raw code — the
 * `otp_codes` row holds only `code_hash = HMAC-SHA-256(code,
 * OTP_PEPPER)` (backend/src/auth/otp.py, #499 §4.1: "the raw code never
 * touches the DB"). The code space is 10^6 six-digit strings, so with
 * the SAME pepper the backend used, the helper recovers the code from
 * the stored digest in ~1-2s — deterministic, no backend seam, and it
 * proves the row the login flow must consume actually exists.
 *
 * The pepper: the stack backend runs non-production, where an unset
 * OTP_PEPPER resolves to the fixed dev constant 'dev-otp-pepper'
 * (backend/src/core/config.py `_resolve_otp_pepper`). OTP_PEPPER env
 * overrides BOTH sides (the stack exports it when explicitly set).
 *
 * IMPORT-TIME RULE (seed-ids donor): never call at module scope —
 * resolve inside test/setup bodies only.
 */
import { createHmac } from 'crypto';
import { queryDBRow } from './db-query';

/** Mirrors the backend dev default (config.py `_resolve_otp_pepper`). */
const DEFAULT_DEV_OTP_PEPPER = 'dev-otp-pepper';

const esc = (value: string): string => value.replace(/'/g, "''");

function otpPepper(): string {
  return process.env.OTP_PEPPER || DEFAULT_DEV_OTP_PEPPER;
}

/** Synchronous sleep (the helper runs in sync globalSetup context). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * The pending 6-digit OTP code for `phone` (E.164, e.g. '+79001234567').
 *
 * The row read is a BUDGET-BASED POSITIVE WAIT (default 5s): FastAPI
 * ≥0.106 runs the `yield`-dependency teardown — where `get_db_session`
 * COMMITS — AFTER the 202 response is sent, so the row can land in the
 * WAL a beat after the fixture's request returns. Polling until the
 * budget expires, then failing loud (a stale phone must fail fast, not
 * cascade into "wrong code" confusion later).
 */
export function readOtpCode(phone: string, opts: { timeoutMs?: number } = {}): string {
  const deadline = Date.now() + (opts.timeoutMs ?? 5_000);
  let row = queryDBRow(
    `SELECT code_hash, expires_at FROM otp_codes WHERE phone = '${esc(phone)}'`,
  );
  while (!row && Date.now() < deadline) {
    sleepSync(100);
    row = queryDBRow(
      `SELECT code_hash, expires_at FROM otp_codes WHERE phone = '${esc(phone)}'`,
    );
  }
  if (!row) {
    throw new Error(
      `[otp-code] no otp_codes row for phone='${phone}' after ${opts.timeoutMs ?? 5_000}ms — ` +
        `the code request did not land in the test DB (wrong TEST_DB_PATH? code never requested? already consumed?)`,
    );
  }

  // TTL guard (5 minutes, #499 §4.1): an expired row is a failure, and
  // the caller must re-request rather than brute-force a dead code.
  // SQLite stores the naive-UTC datetime as 'YYYY-MM-DD HH:MM:SS…'.
  const rawExpiry = String(row.expires_at).trim();
  const expiryMs = Date.parse(
    rawExpiry.endsWith('Z') ? rawExpiry : `${rawExpiry.replace(' ', 'T')}Z`,
  );
  if (Number.isFinite(expiryMs) && Date.now() >= expiryMs) {
    throw new Error(
      `[otp-code] the otp_codes row for phone='${phone}' expired at ${rawExpiry} — re-request the code`,
    );
  }

  const codeHash = String(row.code_hash);
  const pepper = otpPepper();
  // 10^6 HMAC-SHA-256 candidates — the full 6-digit space (#499 §4.1).
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = i.toString().padStart(6, '0');
    if (createHmac('sha256', pepper).update(candidate).digest('hex') === codeHash) {
      return candidate;
    }
  }
  throw new Error(
    `[otp-code] no 6-digit code matches the stored code_hash for phone='${phone}' — ` +
      `the OTP_PEPPER used by this helper ('${pepper === DEFAULT_DEV_OTP_PEPPER ? 'dev default' : 'env override'}') ` +
      `differs from the stack backend's pepper`,
  );
}
