/**
 * db-query.ts — Direct SQLite verification for Playwright E2E tests.
 *
 * Use when API verification is not enough — e.g., soft delete flags,
 * FK constraints, cascade behavior, payment totals.
 *
 * IMPORTANT: DB_PATH must point to the SAME database the backend uses.
 *
 * Per-shard mode (via test-all.sh):
 *   SHARD_ID is set → uses test_memo_shard{id}.db
 *
 * Standalone mode:
 *   Falls back to TEST_DB_PATH or default test_memo.db.
 *
 * Retries on "database is locked" to handle concurrent backend writes.
 */

import { sqliteExecWithRetry } from './sqlite-exec';
import { resolveTestDbPath } from '../lib/db-path';

/**
 * Resolve DB path via the shared GH #209 resolver (e2e/lib/db-path.ts):
 * SHARD_ID → canonical shard DB; a SHARD_ID × TEST_DB_PATH conflict is a
 * loud error (no silent precedence).
 */
function resolveDBPath(): string {
  return resolveTestDbPath({
    shardId: process.env.SHARD_ID,
    testDbPath: process.env.TEST_DB_PATH,
  });
}

const DB_PATH = resolveDBPath();

function escapeSql(sql: string): string {
  return sql.replace(/"/g, '\\"');
}

/**
 * Execute a SQL query and return raw output as string.
 */
export function queryDB(sql: string): string {
  try {
    return sqliteExecWithRetry(`sqlite3 "${DB_PATH}" "${escapeSql(sql)}"`);
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}

/**
 * Execute a SQL query and return first row as object.
 * Returns null if no rows.
 */
export function queryDBRow(sql: string): Record<string, any> | null {
  try {
    const output = sqliteExecWithRetry(`sqlite3 -json "${DB_PATH}" "${escapeSql(sql)}"`);
    if (!output || output === '[]') return null;
    const rows = JSON.parse(output);
    return rows[0] || null;
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}

/**
 * Execute a SQL query and return all rows as array of objects.
 */
export function queryDBRows(sql: string): Record<string, any>[] {
  try {
    const output = sqliteExecWithRetry(`sqlite3 -json "${DB_PATH}" "${escapeSql(sql)}"`);
    if (!output || output === '[]') return [];
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}
