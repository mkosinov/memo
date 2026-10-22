/**
 * seed-reset.test.ts — Unit tests for the shared e2e seed-reset module.
 *
 * GH #252 created the module with a hand-maintained RESET_SQL; GH #310
 * replaced it with the auto-generated canon (`scripts/gen_seed_canon.py`
 * snapshots the pristine seed at stack startup into `<db>.canon.sql`;
 * `resetToSeed()` applies it before every test). GH #373 moved the SQL
 * canon semantics (total restore, exceptions, idempotency) to their
 * native home — `backend/tests/test_seed_canon.py` — killing the class
 * of load flakes where the vitest pool inflated sqlite/python subprocess
 * runs past the per-test ceiling. This file pins the frontend-side
 * wrapper contract ONLY — invariant: NO test launches an external process
 * (neither the DB CLI nor the canon generator runs from vitest anymore):
 *
 *   1. call-time DB path resolution order: SHARD_ID → TEST_DB_PATH →
 *      default (unchanged from #209);
 *   2. a missing canon file is a LOUD error naming the stack script —
 *      the wrapper checks canon existence BEFORE touching the DB, so
 *      this needs only a bare temp DB path (no schema, no seed, no
 *      generator);
 *   3. resolveTestFilesDir / wipeAvatarsDir (GH #262).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  resolveSeedCanonPath,
  resolveSeedDbPath,
  resolveTestFilesDir,
  resetToSeed,
  wipeAvatarsDir,
} from '../e2e/fixtures/seed-reset';

describe('resolveSeedDbPath (call-time resolution)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.SHARD_ID;
    delete process.env.TEST_DB_PATH;
    delete process.env.SHARD_RUN_TAG;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('throws when SHARD_ID and TEST_DB_PATH CONFLICT (GH #209 — no silent precedence)', () => {
    process.env.SHARD_ID = '3';
    process.env.TEST_DB_PATH = '/tmp/should-conflict.sqlite';
    expect(() => resolveSeedDbPath()).toThrowError(/SHARD_ID/);
  });

  it('SHARD_ID alone anchors at <repo>/backend', () => {
    process.env.SHARD_ID = '3';
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolveSeedDbPath()).toBe(path.join(repoBackend, 'test_memo_shard3.db'));
  });

  it('SHARD_ID with a MATCHING TEST_DB_PATH passes quietly (absolute form)', () => {
    process.env.SHARD_ID = '3';
    process.env.TEST_DB_PATH = path.resolve(
      __dirname, '..', '..', '..', 'backend', 'test_memo_shard3.db',
    );
    expect(resolveSeedDbPath()).toBe(process.env.TEST_DB_PATH);
  });

  it('TEST_DB_PATH is used when SHARD_ID is unset', () => {
    process.env.TEST_DB_PATH = '/tmp/custom-test-db.sqlite';
    expect(resolveSeedDbPath()).toBe('/tmp/custom-test-db.sqlite');
  });

  it('falls back to backend/test_memo.db by default', () => {
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolveSeedDbPath()).toBe(path.join(repoBackend, 'test_memo.db'));
  });

  it('canon path is <db>.canon.sql (GH #310 — what the shard stack generates)', () => {
    process.env.TEST_DB_PATH = '/tmp/custom-test-db.sqlite';
    expect(resolveSeedCanonPath()).toBe('/tmp/custom-test-db.sqlite.canon.sql');
  });

  it('SHARD_RUN_TAG set → tagged canonical test_memo_shard{id}_{tag}.db (GH #317 spec §3.4)', () => {
    process.env.SHARD_ID = '3';
    process.env.SHARD_RUN_TAG = '0f1e2d';
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolveSeedDbPath()).toBe(path.join(repoBackend, 'test_memo_shard3_0f1e2d.db'));
  });

  it('SHARD_RUN_TAG set + matching tagged TEST_DB_PATH → passes quietly, tagged canon path', () => {
    process.env.SHARD_ID = '3';
    process.env.SHARD_RUN_TAG = '0f1e2d';
    process.env.TEST_DB_PATH = path.resolve(
      __dirname, '..', '..', '..', 'backend', 'test_memo_shard3_0f1e2d.db',
    );
    expect(resolveSeedDbPath()).toBe(process.env.TEST_DB_PATH);
    expect(resolveSeedCanonPath()).toBe(`${process.env.TEST_DB_PATH}.canon.sql`);
  });

  it('invalid SHARD_RUN_TAG → loud error naming the variable and format (GH #317)', () => {
    process.env.SHARD_ID = '3';
    process.env.SHARD_RUN_TAG = 'XYZ12/';
    expect(() => resolveSeedDbPath()).toThrowError(/SHARD_RUN_TAG[\s\S]*\[0-9a-f\]\{6\}/);
  });
});

describe('resetToSeed (canon-missing error; SQL semantics live in backend/tests/test_seed_canon.py, GH #373)', () => {
  const ORIGINAL = { ...process.env };
  let tmpDir: string;

  beforeEach(() => {
    delete process.env.SHARD_ID;
    delete process.env.SHARD_RUN_TAG;
    // Bare temp DB file — NO schema, NO seed, NO generator run: the wrapper
    // resolves the DB path at call time and checks canon existence BEFORE
    // touching the DB (GH #373 spec §2), so the never-generated
    // `<db>.canon.sql` must fail loudly without any external process.
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-reset-loud-'));
    process.env.TEST_DB_PATH = path.join(tmpDir, 'no-canon.db');
    fs.writeFileSync(process.env.TEST_DB_PATH, '');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.env = { ...ORIGINAL };
  });

  it('throws a LOUD error naming the stack script when the canon file is missing', () => {
    expect(() => resetToSeed()).toThrowError(/\[seed-canon\][\s\S]*e2e-shard-start\.sh/);
  });
});

describe('resolveTestFilesDir (call-time resolution, GH #262)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.SHARD_ID;
    delete process.env.TEST_FILES_DIR;
    delete process.env.FILES_DIR;
    delete process.env.SHARD_RUN_TAG;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('SHARD_ID wins over TEST_FILES_DIR/FILES_DIR and anchors at <repo>/backend', () => {
    process.env.SHARD_ID = '2';
    process.env.TEST_FILES_DIR = '/tmp/should-be-ignored';
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolveTestFilesDir()).toBe(path.join(repoBackend, 'test_files_shard2'));
  });

  it('SHARD_ID + SHARD_RUN_TAG → test_files_shard{id}_{tag}, string-identical to the bash producer (GH #317)', () => {
    // scripts/e2e-shard-start.sh builds backend/test_files_shard${SHARD_ID}_${SHARD_RUN_TAG}
    // when the tag is set — the TS mirror must produce the very same string.
    process.env.SHARD_ID = '2';
    process.env.SHARD_RUN_TAG = '0f1e2d';
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolveTestFilesDir()).toBe(path.join(repoBackend, 'test_files_shard2_0f1e2d'));
  });

  it('SHARD_ID + empty-string SHARD_RUN_TAG → untagged dir, byte-identical to pre-#317 (CI)', () => {
    process.env.SHARD_ID = '2';
    process.env.SHARD_RUN_TAG = '';
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolveTestFilesDir()).toBe(path.join(repoBackend, 'test_files_shard2'));
  });

  it('invalid SHARD_RUN_TAG → loud error naming the variable and format (GH #317)', () => {
    process.env.SHARD_ID = '2';
    process.env.SHARD_RUN_TAG = 'TOOBIGTAG';
    expect(() => resolveTestFilesDir()).toThrowError(/SHARD_RUN_TAG[\s\S]*\[0-9a-f\]\{6\}/);
  });

  it('TEST_FILES_DIR is used when SHARD_ID is unset', () => {
    process.env.TEST_FILES_DIR = '/tmp/custom-files';
    expect(resolveTestFilesDir()).toBe('/tmp/custom-files');
  });

  it('FILES_DIR is used when SHARD_ID and TEST_FILES_DIR are unset', () => {
    process.env.FILES_DIR = '/tmp/env-files';
    expect(resolveTestFilesDir()).toBe('/tmp/env-files');
  });

  it('falls back to backend/files by default (backend cwd-relative ./files)', () => {
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolveTestFilesDir()).toBe(path.join(repoBackend, 'files'));
  });
});

describe('wipeAvatarsDir (GH #262 §6)', () => {
  const ORIGINAL = { ...process.env };
  let filesRoot: string;

  beforeEach(() => {
    delete process.env.SHARD_ID;
    delete process.env.SHARD_RUN_TAG;
    filesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'files-dir-test-'));
    process.env.TEST_FILES_DIR = filesRoot;
  });

  afterEach(() => {
    fs.rmSync(filesRoot, { recursive: true, force: true });
    process.env = { ...ORIGINAL };
  });

  it('removes the avatars dir (and only that) under FILES_DIR', () => {
    const avatars = path.join(filesRoot, 'avatars');
    const keep = path.join(filesRoot, 'other');
    fs.mkdirSync(avatars, { recursive: true });
    fs.mkdirSync(keep, { recursive: true });
    fs.writeFileSync(path.join(avatars, 'portrait.png'), 'bytes');

    wipeAvatarsDir();

    expect(fs.existsSync(avatars)).toBe(false);
    expect(fs.existsSync(keep)).toBe(true); // siblings untouched
  });

  it('is a no-op when the avatars dir is absent (force:true)', () => {
    expect(() => wipeAvatarsDir()).not.toThrow();
    expect(fs.existsSync(path.join(filesRoot, 'avatars'))).toBe(false);
  });
});
