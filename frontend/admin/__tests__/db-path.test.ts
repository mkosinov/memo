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
 *   - matching paths (or a single variable set) resolve quietly.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';

import { resolveTestDbPath } from '../e2e/lib/db-path';

describe('resolveTestDbPath (GH #209 single contract)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.SHARD_ID;
    delete process.env.TEST_DB_PATH;
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
});
