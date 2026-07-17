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

import path from 'path';
import { sqliteExecWithRetry } from './sqlite-exec';

/**
 * Resolve DB path: per-shard (test_memo_shard{id}.db) or fallback.
 * SHARD_ID is set by test-all.sh; falls back to TEST_DB_PATH or default.
 */
function resolveDBPath(): string {
  const shardId = process.env.SHARD_ID;
  if (shardId) {
    // Resolve relative to this file's location (frontend/admin/e2e/fixtures/)
    return path.resolve(__dirname, `../../../../backend/test_memo_shard${shardId}.db`);
  }
  return process.env.TEST_DB_PATH
    || path.resolve(__dirname, '../../../../backend/test_memo.db');
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
