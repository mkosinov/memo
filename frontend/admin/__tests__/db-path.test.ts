/**
 * db-path.test.ts — Unit tests for the single test-DB path resolver (GH #209).
 *
 * Contract (spec §2, 2026-09-18-e2e-env-guardrails):
 *   - relative testDbPath resolves against the REPO ROOT, not process.cwd();
 *   - shardId set → canonical <root>/backend/test_memo_shard{id}.db;
 *   - shardId + testDbPath both set with DIFFERENT absolute resolution →
 *     loud error naming both env vars (postmortem #209: the six call sites
 *     previously resolved independently with DIFFERENT precedence — a
 *     silent SHARD_ID × TEST_DB_PATH mismatch);
 *   - matching paths (or a single variable set) resolve quietly;
 *   - TEST_DB_PATH='' counts as unset (GH #336).
 *
 * GH #317 (spec §3.4): an optional SHARD_RUN_TAG (env, 6 lowercase hex,
 * exported by scripts/test-all.sh) extends the canonical shard path to
 * test_memo_shard{id}_{tag}.db. Tag mismatch in EITHER direction is a
 * conflict (tagged path × empty env tag, and vice versa); an invalid tag
 * value is a loud error (never silently untagged); an empty tag keeps the
 * byte-identical pre-#317 names (CI).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';

import { resolveTestDbPath } from '../e2e/lib/db-path';

describe('resolveTestDbPath (GH #209 single contract)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.SHARD_ID;
    delete process.env.TEST_DB_PATH;
    delete process.env.SHARD_RUN_TAG;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('throws when shardId and testDbPath resolve to DIFFERENT paths (error names both vars)', () => {
    expect(() =>
      resolveTestDbPath({ shardId: '1', testDbPath: '/tmp/should-conflict.sqlite' }),
    ).toThrowError(/SHARD_ID[\s\S]*TEST_DB_PATH|TEST_DB_PATH[\s\S]*SHARD_ID/);
  });

  it('conflict error names SHARD_ID value, derived path, TEST_DB_PATH value and the fix hint', () => {
    let message = '';
    try {
      resolveTestDbPath({ shardId: '2', testDbPath: '/tmp/conflict.sqlite' });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('SHARD_ID');
    expect(message).toContain('2');
    expect(message).toContain('test_memo_shard2.db');
    expect(message).toContain('TEST_DB_PATH');
    expect(message).toContain('/tmp/conflict.sqlite');
  });

  it('passes quietly when shardId and testDbPath are the SAME path (absolute form)', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const sameAbs = path.join(repoRoot, 'backend', 'test_memo_shard1.db');
    expect(resolveTestDbPath({ shardId: '1', testDbPath: sameAbs })).toBe(sameAbs);
  });

  it('passes quietly when testDbPath is a RELATIVE view of the same shard path', () => {
    // Relative resolves against the repo root — 'backend/test_memo_shard2.db'
    // is the same file the shard id derives → no conflict.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(resolveTestDbPath({ shardId: '2', testDbPath: 'backend/test_memo_shard2.db' })).toBe(
      path.join(repoRoot, 'backend', 'test_memo_shard2.db'),
    );
  });

  it('only shardId → canonical <root>/backend/test_memo_shard{id}.db', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(resolveTestDbPath({ shardId: '1' })).toBe(
      path.join(repoRoot, 'backend', 'test_memo_shard1.db'),
    );
  });

  it('only testDbPath (absolute) → returned as-is', () => {
    expect(resolveTestDbPath({ testDbPath: '/tmp/custom.sqlite' })).toBe('/tmp/custom.sqlite');
  });

  it('only testDbPath (relative) → resolved against the REPO ROOT, not process.cwd()', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const resolved = resolveTestDbPath({ testDbPath: 'backend/test_memo.db' });
    expect(resolved).toBe(path.join(repoRoot, 'backend', 'test_memo.db'));
    // cwd-independence: resolution must not depend on the working directory.
    expect(path.isAbsolute(resolved)).toBe(true);
  });

  it('neither set → default <root>/backend/test_memo.db', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(resolveTestDbPath({})).toBe(path.join(repoRoot, 'backend', 'test_memo.db'));
  });

  it("empty-string TEST_DB_PATH counts as unset → default path (GH #336)", () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(resolveTestDbPath({ testDbPath: '' })).toBe(
      path.join(repoRoot, 'backend', 'test_memo.db'),
    );
  });

  it("empty-string TEST_DB_PATH + shardId → no conflict, canonical shard path (GH #336)", () => {
    // '' is unset, so it must NOT trigger the SHARD_ID × TEST_DB_PATH conflict
    // the way a stale inherited .env.test line would.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(resolveTestDbPath({ shardId: '1', testDbPath: '' })).toBe(
      path.join(repoRoot, 'backend', 'test_memo_shard1.db'),
    );
  });
});

describe('resolveTestDbPath (GH #317 — SHARD_RUN_TAG)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.SHARD_ID;
    delete process.env.TEST_DB_PATH;
    delete process.env.SHARD_RUN_TAG;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('shardId + valid tag → canonical <root>/backend/test_memo_shard{id}_{tag}.db', () => {
    process.env.SHARD_RUN_TAG = '0f1e2d';
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(resolveTestDbPath({ shardId: '1' })).toBe(
      path.join(repoRoot, 'backend', 'test_memo_shard1_0f1e2d.db'),
    );
  });

  it('shardId + tag + TEST_DB_PATH as a RELATIVE view of the tagged canonical → passes quietly', () => {
    process.env.SHARD_RUN_TAG = '0f1e2d';
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(
      resolveTestDbPath({ shardId: '2', testDbPath: 'backend/test_memo_shard2_0f1e2d.db' }),
    ).toBe(path.join(repoRoot, 'backend', 'test_memo_shard2_0f1e2d.db'));
  });

  it('env tag set but TEST_DB_PATH resolves to the UNTAGGED canonical → conflict names SHARD_RUN_TAG', () => {
    process.env.SHARD_RUN_TAG = '0f1e2d';
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const untagged = path.join(repoRoot, 'backend', 'test_memo_shard1.db');
    let message = '';
    try {
      resolveTestDbPath({ shardId: '1', testDbPath: untagged });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('SHARD_RUN_TAG');
    expect(message).toContain('0f1e2d');
  });

  it('TEST_DB_PATH tagged (canonical form) but env tag empty → conflict names SHARD_RUN_TAG', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const tagged = path.join(repoRoot, 'backend', 'test_memo_shard1_deadbe.db');
    let message = '';
    try {
      resolveTestDbPath({ shardId: '1', testDbPath: tagged });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('SHARD_RUN_TAG');
    expect(message).toContain('deadbe');
  });

  it('env tag differs from the tag carried by TEST_DB_PATH → conflict', () => {
    process.env.SHARD_RUN_TAG = '0f1e2d';
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const otherTag = path.join(repoRoot, 'backend', 'test_memo_shard1_deadbe.db');
    expect(() => resolveTestDbPath({ shardId: '1', testDbPath: otherTag })).toThrowError(
      /SHARD_RUN_TAG/,
    );
  });

  it.each(['ABC123', 'abc12', 'abc1234', 'ab/..', 'ab 12'])(
    'invalid tag %s → loud error naming SHARD_RUN_TAG and the format (never silently untagged)',
    (badTag) => {
      process.env.SHARD_RUN_TAG = badTag;
      let message = '';
      try {
        resolveTestDbPath({ shardId: '1' });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('SHARD_RUN_TAG');
      expect(message).toContain('[0-9a-f]{6}');
      expect(message).toContain(badTag);
    },
  );

  it("empty-string tag → untagged canonical, byte-identical to the pre-#317 name", () => {
    process.env.SHARD_RUN_TAG = '';
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    expect(resolveTestDbPath({ shardId: '1' })).toBe(
      path.join(repoRoot, 'backend', 'test_memo_shard1.db'),
    );
  });

  it('tag set + only TEST_DB_PATH (SHARD_ID unset) → legacy single-variable behavior', () => {
    process.env.SHARD_RUN_TAG = '0f1e2d';
    expect(resolveTestDbPath({ testDbPath: '/tmp/custom.sqlite' })).toBe('/tmp/custom.sqlite');
  });

  it('invalid tag fails loud even when SHARD_ID is unset (env poisoning is always an error)', () => {
    process.env.SHARD_RUN_TAG = 'NOTHEX';
    expect(() => resolveTestDbPath({ testDbPath: '/tmp/custom.sqlite' })).toThrowError(
      /SHARD_RUN_TAG/,
    );
  });
});
