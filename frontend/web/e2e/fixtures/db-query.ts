/**
 * db-query.ts — Direct SQLite access for web Playwright E2E (web copy of
 * the admin donor, fed by the web db-path resolver).
 *
 * The #513 client-session fixture reads the pending OTP code row from
 * the SAME database the stack backend serves (TEST_DB_PATH exported by
 * scripts/e2e-stack.sh); later cabinet specs verify deep state the same
 * way (the admin DB-verification decision table).
 *
 * Retries on "database is locked" to handle concurrent backend writes.
 */
import { sqliteExecWithRetry } from './sqlite-exec';
import { resolveTestDbPath } from '../lib/db-path';

const DB_PATH = resolveTestDbPath({ testDbPath: process.env.TEST_DB_PATH });

function escapeSql(sql: string): string {
  return sql.replace(/"/g, '\\"');
}

/** Execute a SQL query and return raw output as string. */
export function queryDB(sql: string): string {
  try {
    return sqliteExecWithRetry(`sqlite3 "${DB_PATH}" "${escapeSql(sql)}"`);
  } catch (error) {
    throw new Error(`DB query failed (${DB_PATH}): ${sql}\n${error}`);
  }
}

/** Execute a SQL query and return first row as object (null if no rows). */
export function queryDBRow(sql: string): Record<string, any> | null {
  try {
    const output = sqliteExecWithRetry(`sqlite3 -json "${DB_PATH}" "${escapeSql(sql)}"`);
    if (!output || output === '[]') return null;
    const rows = JSON.parse(output);
    return rows[0] || null;
  } catch (error) {
    throw new Error(`DB query failed (${DB_PATH}): ${sql}\n${error}`);
  }
}

/** Execute a SQL query and return all rows as array of objects. */
export function queryDBRows(sql: string): Record<string, any>[] {
  try {
    const output = sqliteExecWithRetry(`sqlite3 -json "${DB_PATH}" "${escapeSql(sql)}"`);
    if (!output || output === '[]') return [];
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`DB query failed (${DB_PATH}): ${sql}\n${error}`);
  }
}
