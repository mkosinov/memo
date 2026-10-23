/**
 * db-path.ts — Single source of truth for the web-e2e test-DB path.
 *
 * WEB adaptation of the admin donor (frontend/admin/e2e/lib/db-path.ts,
 * GH #209/#317). Deviation from the donor: the web project has NO shard
 * concept (single stack per run), so the SHARD_ID branch is gone; what
 * survives is the discipline:
 *   - SHARD_RUN_TAG (optional, exported by scripts/test-e2e.sh) must be
 *     exactly 6 lowercase hex chars — set-but-malformed is a LOUD error,
 *     never silently ignored (the tag lands in file paths);
 *   - a relative TEST_DB_PATH resolves against the REPO ROOT (never
 *     process.cwd(), which depends on the invocation directory);
 *   - no silent default when the stack runs: the stack exports
 *     TEST_DB_PATH=backend/test_memo_web_<tag>.db and the smoke specs'
 *     SQL helpers read exactly that file.
 *
 * Standalone fallback (no TEST_DB_PATH): backend/test_memo.db — the same
 * file the admin standalone recipe seeds, so a manual standalone stack
 * serves both projects.
 */
import path from 'path';

/** Repo root computed from THIS file's location: e2e/lib → e2e → web →
 *  frontend → root (same 4-up depth as the admin donor). */
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');

/** #317: a valid run tag is exactly 6 lowercase hex chars. */
const RUN_TAG_RE = /^[0-9a-f]{6}$/;

export function readShardRunTag(): string {
  const tag = process.env.SHARD_RUN_TAG || '';
  if (tag && !RUN_TAG_RE.test(tag)) {
    throw new Error(
      `[web-e2e db-path] Invalid SHARD_RUN_TAG='${tag}': must be 6 lowercase hex chars ([0-9a-f]{6}). ` +
        `Unset it for an untagged run, or use scripts/test-e2e.sh (it validates the tag).`,
    );
  }
  return tag;
}

export function resolveTestDbPath(opts: { testDbPath?: string }): string {
  const resolvedTestDbPath = opts.testDbPath
    ? path.resolve(REPO_ROOT, opts.testDbPath)
    : undefined;

  return resolvedTestDbPath || path.join(BACKEND_DIR, 'test_memo.db');
}
