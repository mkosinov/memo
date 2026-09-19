/**
 * db-path.ts — Single source of truth for the test-DB path (GH #209).
 *
 * Postmortem #209: SHARD_ID × TEST_DB_PATH were resolved independently at
 * six call sites with DIFFERENT precedence (visual-compliance-checks.spec.ts
 * had TEST_DB_PATH-wins, the rest shard-wins) — a silent mismatch could make
 * tests verify a different database than the one the backend serves.
 * Contract now: a CONFLICT is a loud error (precedent: #149 loud-error-over-
 * silent-priority for filters).
 *
 * Resolution rules (spec 2026-09-18-e2e-env-guardrails §2):
 *   - relative testDbPath resolves against the REPO ROOT (never process.cwd(),
 *     which depends on the invocation directory);
 *   - shardId set  → canonical <root>/backend/test_memo_shard{id}.db;
 *   - both set and their absolute resolutions DIFFER → throw, naming
 *     SHARD_ID, the derived path, TEST_DB_PATH and the fix hint
 *     ("remove one of the variables");
 *   - both set and matching (a relative view of the same file counts) → pass;
 *   - a single variable (or neither) → legacy behavior.
 */
import path from 'path';

/** Repo root computed from THIS file's location: e2e/lib → e2e → admin →
 *  frontend → root (same 4-up depth style as fixtures/factories.ts). */
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');

export function resolveTestDbPath(opts: { shardId?: string; testDbPath?: string }): string {
  const { shardId, testDbPath } = opts;
  const defaultPath = path.join(BACKEND_DIR, 'test_memo.db');

  // Relative TEST_DB_PATH anchors at the repo root, not process.cwd().
  const resolvedTestDbPath = testDbPath ? path.resolve(REPO_ROOT, testDbPath) : undefined;

  if (shardId) {
    const shardPath = path.join(BACKEND_DIR, `test_memo_shard${shardId}.db`);
    if (resolvedTestDbPath && resolvedTestDbPath !== shardPath) {
      throw new Error(
        `[db-path] Conflicting test-DB configuration: SHARD_ID='${shardId}' derives ` +
          `"${shardPath}", but TEST_DB_PATH='${testDbPath}' resolves to ` +
          `"${resolvedTestDbPath}". Remove one of the variables ` +
          `(unset SHARD_ID or TEST_DB_PATH) so exactly one source defines the DB.`,
      );
    }
    return shardPath;
  }

  return resolvedTestDbPath || defaultPath;
}
