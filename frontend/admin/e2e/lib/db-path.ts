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
 *   - a single variable (or neither) → legacy behavior;
 *   - TEST_DB_PATH='' (empty string) counts as unset (GH #336).
 *
 * GH #317 (spec §3.4, 2026-10-09-shard-stack-dynamic-ports): an optional
 * SHARD_RUN_TAG (env, exported by scripts/test-all.sh next to TEST_DB_PATH)
 * extends the canonical shard path to test_memo_shard{id}_{tag}.db.
 *   - the tag is read from env INSIDE this resolver so every call site
 *     (db-query, factories, globalSetup, seed-reset) inherits it without
 *     per-caller changes;
 *   - a tag on one side only (env tag set × untagged TEST_DB_PATH, or a
 *     tagged TEST_DB_PATH × empty env tag) is a CONFLICT — same loud error;
 *   - a set-but-malformed tag is a loud error (never silently untagged);
 *   - empty/unset tag → paths byte-identical to the pre-#317 canon (CI,
 *     standalone stacks — zero workflow changes).
 */
import path from 'path';

/** Repo root computed from THIS file's location: e2e/lib → e2e → admin →
 *  frontend → root (same 4-up depth style as fixtures/factories.ts). */
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');

/** #317: a valid run tag is exactly 6 lowercase hex chars (spec §3.1 —
 *  `openssl rand -hex 3`; the strict format keeps `/`, `*`, `..`, spaces
 *  and uppercase out of paths and cleanup globs). */
const RUN_TAG_RE = /^[0-9a-f]{6}$/;

/** Canonical tagged basename — test_memo_shard{id}_{tag}.db — used only to
 *  DETECT a tag on the TEST_DB_PATH side of a conflict (never to parse it). */
const TAGGED_SHARD_DB_RE = /^test_memo_shard\d+_[0-9a-f]{6}\.db$/;

/**
 * Read and validate SHARD_RUN_TAG at call time (GH #317 spec §3.4).
 * Unset/empty → '' (untagged run — legacy names, byte-identical). Set but
 * malformed → LOUD error naming the variable and the expected format: the
 * tag is part of file paths and cleanup globs, so it is never silently
 * ignored (same loud-error-over-silent-priority precedent as #209).
 */
export function readShardRunTag(): string {
  const tag = process.env.SHARD_RUN_TAG || '';
  if (tag && !RUN_TAG_RE.test(tag)) {
    throw new Error(
      `[db-path] Invalid SHARD_RUN_TAG='${tag}': must be 6 lowercase hex chars ([0-9a-f]{6}). ` +
        `Unset it for an untagged run, or re-run scripts/test-all.sh (it generates a valid tag).`,
    );
  }
  return tag;
}

export function resolveTestDbPath(opts: { shardId?: string; testDbPath?: string }): string {
  const { shardId, testDbPath } = opts;
  const defaultPath = path.join(BACKEND_DIR, 'test_memo.db');

  // Relative TEST_DB_PATH anchors at the repo root, not process.cwd().
  const resolvedTestDbPath = testDbPath ? path.resolve(REPO_ROOT, testDbPath) : undefined;

  // #317: read from env here (not opts) so EVERY call site inherits the
  // tag-aware canonical without per-caller changes. Validated on every
  // call — an env-poisoned tag is an error even if unused this call.
  const runTag = readShardRunTag();

  if (shardId) {
    const shardPath = path.join(
      BACKEND_DIR,
      `test_memo_shard${shardId}${runTag ? `_${runTag}` : ''}.db`,
    );
    if (resolvedTestDbPath && resolvedTestDbPath !== shardPath) {
      // A tag on either side only is a special case of "both set and
      // diverged" (spec §3.4); the detail line names SHARD_RUN_TAG so the
      // mismatch is diagnosable at a glance.
      const pathIsTagged = TAGGED_SHARD_DB_RE.test(path.basename(resolvedTestDbPath));
      const tagDetail =
        runTag || pathIsTagged
          ? ` Tag mismatch (#317): SHARD_RUN_TAG is ${runTag ? `set to '${runTag}'` : 'empty'}` +
            `${pathIsTagged ? ` while TEST_DB_PATH carries a _<6hex> tag` : ''}.`
          : '';
      throw new Error(
        `[db-path] Conflicting test-DB configuration: SHARD_ID='${shardId}' derives ` +
          `"${shardPath}", but TEST_DB_PATH='${testDbPath}' resolves to ` +
          `"${resolvedTestDbPath}".${tagDetail} Remove one of the variables ` +
          `(unset SHARD_ID or TEST_DB_PATH) so exactly one source defines the DB.`,
      );
    }
    return shardPath;
  }

  return resolvedTestDbPath || defaultPath;
}
