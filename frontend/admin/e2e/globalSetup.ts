/**
 * globalSetup.ts — Clean test data before each E2E run.
 *
 * Per-shard mode (via test-all.sh):
 *   SHARD_ID is set → uses test_memo_shard{1-5}.db
 *
 * Standalone mode (manual playwright test):
 *   SHARD_ID not set → uses TEST_DB_PATH or default test_memo.db
 *
 * Removes all non-seed data (clients, records, payments, visits, activities)
 * so each test run starts with a clean state.
 *
 * Seed IDs are short (c1..c5, r1..r6, v1..v10, p1..p6, ev_0..ev_44)
 * so length checks distinguish them from UUID test data.
 */
import { execSync } from 'child_process';
import path from 'path';

export default function globalSetup() {
  // Per-shard DB: test_memo_shard{id}.db
  // Falls back to TEST_DB_PATH or default test_memo.db for backwards compat.
  const shardId = process.env.SHARD_ID;
  const dbPath = shardId
    ? path.resolve(__dirname, `../../../backend/test_memo_shard${shardId}.db`)
    : process.env.TEST_DB_PATH
      || path.resolve(__dirname, '../../../backend/test_memo.db');

  console.log(`[globalSetup] Cleaning DB: ${dbPath}${shardId ? ` (shard ${shardId})` : ''}`);

  // Delete all non-seed data (children first to respect FK constraints).
  // Order: payments → visits → records → activities → clients.
  try {
    execSync(`sqlite3 "${dbPath}" "
      DELETE FROM payments WHERE length(id) > 3;
      DELETE FROM visits WHERE length(id) > 3;
      DELETE FROM records WHERE length(id) > 3;
      DELETE FROM activities WHERE length(id) > 5 AND id NOT LIKE 'ev_fixed_%';
      DELETE FROM clients WHERE length(id) > 3;
    "`, { encoding: 'utf-8', stdio: 'pipe' });
  } catch (err: any) {
    // Only swallow "no such table" (DB not yet created) or "no such file"
    const msg = String(err?.stderr || err?.message || '');
    if (msg.includes('no such table') || msg.includes('no such file') || msg.includes('unable to open database')) {
      console.warn(`[globalSetup] DB not ready or missing tables, skipping clean: ${msg.trim()}`);
      return;
    }
    // Real errors should propagate (DB locked, permissions, etc.)
    console.error(`[globalSetup] ERROR cleaning DB: ${msg}`);
    throw err;
  }
}
