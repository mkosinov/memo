/**
 * sqlite-exec.ts — Shared busy-wait retry helper for `sqlite3` CLI invocations.
 *
 * Extracted from `db-query.ts` so `globalSetup.ts` and `seed-reset.ts`
 * can reuse the SAME lock-retry semantics instead of each having their
 * own (inconsistent) handling of "database is locked".
 */

import { execSync } from 'child_process';

export const MAX_RETRIES = 5;
export const RETRY_DELAY_MS = 200;

/**
 * Execute a shell command with retry on "database is locked" errors.
 *
 * Retries up to MAX_RETRIES times with a synchronous busy-wait of
 * RETRY_DELAY_MS between attempts. Any other error (or the lock
 * persisting past the last attempt) is thrown immediately.
 */
export function sqliteExecWithRetry(cmd: string): string {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return execSync(cmd, { encoding: 'utf-8' }).trim();
    } catch (err: any) {
      const msg = String(err?.stderr || err?.message || '');
      if (msg.includes('database is locked') && attempt < MAX_RETRIES - 1) {
        lastError = err;
        // Busy wait — simple synchronous delay
        const start = Date.now();
        while (Date.now() - start < RETRY_DELAY_MS) {
          // spin
        }
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
