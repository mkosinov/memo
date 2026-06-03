/**
 * db-query.ts — Direct SQLite verification for Playwright E2E tests.
 *
 * Use when API verification is not enough — e.g., soft delete flags,
 * FK constraints, cascade behavior, payment totals.
 *
 * IMPORTANT: DB_PATH must point to the SAME database the backend uses.
 * In CI: set via TEST_DB_PATH environment variable.
 * Local: defaults to backend/memo.db relative to frontend/admin.
 */

import { execSync } from 'child_process';

const DB_PATH = process.env.TEST_DB_PATH || '../../backend/memo.db';

/**
 * Execute a SQL query and return raw output as string.
 *
 * Usage:
 *   const total = queryDB(`SELECT SUM(amount) FROM payments WHERE record_id='r1'`);
 *   expect(Number(total)).toBe(3500);
 */
export function queryDB(sql: string): string {
  try {
    return execSync(`sqlite3 "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
    }).trim();
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}

/**
 * Execute a SQL query and return first row as object.
 * Returns null if no rows.
 *
 * Usage:
 *   const row = queryDBRow(`SELECT is_active FROM records WHERE id='r1'`);
 *   expect(row!.is_active).toBe(0);  // SQLite stores bool as 0/1
 */
export function queryDBRow(sql: string): Record<string, any> | null {
  try {
    const output = execSync(`sqlite3 -json "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
    }).trim();
    if (!output || output === '[]') return null;
    const rows = JSON.parse(output);
    return rows[0] || null;
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}

/**
 * Execute a SQL query and return all rows as array of objects.
 *
 * Usage:
 *   const visits = queryDBRows(`SELECT * FROM visits WHERE record_id='r1'`);
 *   expect(visits.length).toBe(2);
 */
export function queryDBRows(sql: string): Record<string, any>[] {
  try {
    const output = execSync(`sqlite3 -json "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
    }).trim();
    if (!output || output === '[]') return [];
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`DB query failed: ${sql}\n${error}`);
  }
}
