/**
 * globalSetup.ts — Clean test data from test_memo.db before each E2E run.
 *
 * Removes all non-seed data (clients, records, payments, visits, activities)
 * so each test run starts with a clean state.
 */
import { execSync } from 'child_process';
import path from 'path';

export default function globalSetup() {
  const dbPath = process.env.TEST_DB_PATH
    || path.resolve(__dirname, '../../backend/test_memo.db');

  try {
    // Delete all non-seed data (seed IDs are short like c1, r1, v1, p1;
    // seed activities use ev_0..ev_44, so length ≤ 5).
    // Order: children first (payments → visits → records → activities → clients).
    execSync(`sqlite3 "${dbPath}" "
      DELETE FROM payments WHERE length(id) > 3;
      DELETE FROM visits WHERE length(id) > 3;
      DELETE FROM records WHERE length(id) > 3;
      DELETE FROM activities WHERE length(id) > 5;
      DELETE FROM clients WHERE length(id) > 3;
    "`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch {
    // If sqlite3 is not available or DB doesn't exist, skip silently
  }
}
