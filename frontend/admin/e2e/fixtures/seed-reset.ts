/**
 * seed-reset.ts — Shared canonical reset-to-seed SQL for E2E (GH #252).
 *
 * ONE merged statement (spec §3.1, rev 2) consumed by BOTH:
 *   - `globalSetup.ts` (boot-time safety net, before any test runs)
 *   - the per-test wrapper fixture (Task 2 — reset before EVERY test)
 *
 * Merged from the two historical variants:
 *   - `globalSetup.ts` inline DELETEs (children-first)
 *   - the former manual per-test cleanup in `helpers.ts` (deleted in
 *     Task 3 — this reset supersedes it) — stricter prefix-based
 *     activities filter (NOT
 *     length-based: any `evt_*` id must go, `ev_*`/`ev_fixed_*` seed ids
 *     must stay) + sort_order CASE-restores for masters/locations, which
 *     dayview-column-reorder's permanent reorder writes would otherwise
 *     corrupt for every later visual baseline.
 *
 * The DELETE order is children-first incl. visitors BEFORE clients
 * (visitors → clients FK). `PRAGMA busy_timeout=5000` gives this CLI
 * subprocess the same lock patience backend connections have — required
 * in the per-test regime where the backend is LIVE while we reset.
 *
 * Seed IDs are short (c1..c5, r1..r6, v1..v10, p1..p6, ev_0..ev_44) so
 * length checks distinguish them from UUID test data. Seed generation is
 * NOT duplicated here (D3): edited/deleted seed rows are not restored —
 * tests must not mutate seed rows.
 */
import fs from 'fs';
import path from 'path';

import { sqliteExecWithRetry } from './sqlite-exec';

/**
 * The canonical reset statement — copied VERBATIM from spec §3.1
 * (sort_order CASE values are the former manual-cleanup ones).
 */
export const RESET_SQL = `
  PRAGMA busy_timeout=5000;
  DELETE FROM payments  WHERE length(id) > 3;
  DELETE FROM visits     WHERE length(id) > 3;
  DELETE FROM records    WHERE length(id) > 3;
  DELETE FROM activities WHERE id NOT LIKE 'ev\\_%' ESCAPE '\\' AND id NOT LIKE 'ev_fixed_%';
  DELETE FROM visitors   WHERE length(id) > 5;
  DELETE FROM clients    WHERE length(id) > 3;
  UPDATE masters   SET sort_order = CASE id WHEN 'm1' THEN 0 WHEN 'm2' THEN 1 WHEN 'm3' THEN 2 WHEN 'm4' THEN 3 WHEN 'm5' THEN 4 WHEN 'm7' THEN 5 ELSE sort_order END WHERE id IN ('m1','m2','m3','m4','m5','m7');
  UPDATE locations SET sort_order = CASE id WHEN 'alpika' THEN 0 WHEN 'grand' THEN 1 WHEN 'p1389' THEN 2 ELSE sort_order END WHERE id IN ('alpika','grand','p1389');
`;

/**
 * Resolve the test DB path AT CALL TIME — never at module load (env vars
 * are set by the shard script / test runner and may change between
 * import and call). Same rules as `globalSetup.ts`:
 *   SHARD_ID set       → backend/test_memo_shard{id}.db
 *   else TEST_DB_PATH  → as-is, relative resolved against process CWD
 *                        (pass-through, 1:1 with globalSetup)
 *   else               → backend/test_memo.db
 */
export function resolveSeedDbPath(): string {
  const shardId = process.env.SHARD_ID;
  return shardId
    ? path.resolve(__dirname, `../../../../backend/test_memo_shard${shardId}.db`)
    : process.env.TEST_DB_PATH
      || path.resolve(__dirname, '../../../../backend/test_memo.db');
}

/**
 * Reset the test DB to canonical seed state by executing RESET_SQL through
 * the shared busy-wait retry wrapper (same lock-retry semantics as every
 * other sqlite3 CLI call in the suite). Exported for the per-test wrapper
 * fixture (spec §3.2) and reused by globalSetup.
 */
export function resetToSeed(): string {
  return sqliteExecWithRetry(`sqlite3 "${resolveSeedDbPath()}" "${RESET_SQL}"`);
}

/**
 * Structural subset of Playwright's `TestInfo` — pass the fixture's
 * `testInfo` directly (spec §3.2 calls `await snapshotDb(testInfo)`).
 * Exported so the fixture (and tests) can depend on it.
 */
export interface SnapshotDbTestInfo {
  outputDir: string;
}

/**
 * Save a consistent DB snapshot into `testInfo.outputDir` (spec D7 / §3.2):
 * on a retry attempt the fixture snapshots the DB BEFORE resetting, so the
 * pre-reset state survives forensics even though the next reset wipes it.
 * `.backup` is consistent under WAL. Synchronous — the fixture awaits it.
 *
 * @param testInfo Playwright TestInfo-compatible object; its outputDir
 *                 is created if missing
 */
export function snapshotDb(testInfo: SnapshotDbTestInfo): string {
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  const snapshotPath = path.join(testInfo.outputDir, 'db-before-reset.sqlite');
  return sqliteExecWithRetry(
    `sqlite3 "${resolveSeedDbPath()}" ".backup '${snapshotPath}'"`,
  );
}
