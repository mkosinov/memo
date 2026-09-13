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
 * Seed staff ids preserved by the #266 migration (m6 never existed) and the
 * seed positions dictionary (built-ins «master»/«admin» + user-defined «smm»).
 * Kept as named lists so the IN-clauses below stay in sync with seed.py.
 */
const SEED_STAFF = ['m1', 'm2', 'm3', 'm4', 'm5', 'm7'];
const SEED_POSITIONS = ['master', 'admin', 'smm'];
const inList = (ids: string[]) => ids.map((id) => `'${id}'`).join(',');

/**
 * The canonical reset statement (spec §3.1 + GH #266 «Тестирование»:
 * full rewrite of the staff domain across the FOUR restructured tables —
 * staff / masters / positions / staff_positions — back to seed).
 *
 * Delete order is CHILDREN-FIRST so the statement is FK-clean even though the
 * `sqlite3` CLI runs with `foreign_keys=OFF` (it would neither enforce nor
 * cascade — so dangling references are avoided explicitly, not relied upon):
 *
 *   1. transactional rows (payments…clients) — unchanged from §3.1;
 *   2. master_tags of NON-seed masters (child of masters; the DB-level
 *      ON DELETE CASCADE does NOT fire under the CLI, so delete the join rows
 *      explicitly before their masters row);
 *   3. staff_positions wiped whole, then the 6 canonical seed links re-inserted
 *      («восстановление позиций сида»);
 *   4. users.staff_id DETACHED for non-seed cards — users/sessions are NEVER
 *      deleted (the auth cookie must survive per-test resets, #252 §3.1), but
 *      a dangling staff_id would be FK-unclean once its card is deleted;
 *   5. masters (non-seed) → staff (non-seed) → positions (non-seed);
 *   6. restore seed invariants: staff.sort_order (m1–m5=0–4, m7=5 — the
 *      dayview-column-reorder spec permanently reorders these), positions
 *      title/is_system (a spec may rename «master» or flip is_system), and
 *      locations.sort_order (unchanged).
 *
 * The seed rows themselves are matched by their SHORT literal ids (m1…m7 /
 * master/admin/smm); every test-created row carries a UUID, so `NOT IN` cleanly
 * separates seed from test data.
 */
export const RESET_SQL = `
  PRAGMA busy_timeout=5000;
  DELETE FROM payments  WHERE length(id) > 3;
  DELETE FROM visits     WHERE length(id) > 3;
  DELETE FROM records    WHERE length(id) > 3;
  DELETE FROM activities WHERE id NOT LIKE 'ev\\_%' ESCAPE '\\' AND id NOT LIKE 'ev_fixed_%';
  DELETE FROM visitors   WHERE length(id) > 5;
  DELETE FROM clients    WHERE length(id) > 3;
  DELETE FROM master_tags      WHERE master_id NOT IN (${inList(SEED_STAFF)});
  DELETE FROM staff_positions;
  UPDATE users SET staff_id = NULL WHERE staff_id IS NOT NULL AND staff_id NOT IN (${inList(SEED_STAFF)});
  DELETE FROM masters   WHERE staff_id NOT IN (${inList(SEED_STAFF)});
  DELETE FROM staff     WHERE id NOT IN (${inList(SEED_STAFF)});
  DELETE FROM positions WHERE id NOT IN (${inList(SEED_POSITIONS)});
  INSERT OR IGNORE INTO staff_positions (staff_id, position_id) VALUES ('m1','master'),('m2','master'),('m3','master'),('m4','master'),('m5','master'),('m7','master');
  UPDATE staff     SET sort_order = CASE id WHEN 'm1' THEN 0 WHEN 'm2' THEN 1 WHEN 'm3' THEN 2 WHEN 'm4' THEN 3 WHEN 'm5' THEN 4 WHEN 'm7' THEN 5 ELSE sort_order END WHERE id IN (${inList(SEED_STAFF)});
  UPDATE positions SET title = CASE id WHEN 'master' THEN 'Мастер' WHEN 'admin' THEN 'Администратор' WHEN 'smm' THEN 'СММ' ELSE title END, is_system = CASE id WHEN 'master' THEN 1 WHEN 'admin' THEN 1 WHEN 'smm' THEN 0 ELSE is_system END WHERE id IN (${inList(SEED_POSITIONS)});
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
