/**
 * seed-reset.test.ts — Unit tests for the shared e2e seed-reset module (GH #252).
 *
 * Verifies, against a REAL throwaway SQLite DB (sqlite3 CLI):
 *   1. call-time DB path resolution order: SHARD_ID → TEST_DB_PATH → default
 *   2. resetToSeed() executes the canonical RESET_SQL: non-seed rows removed
 *      (children-first incl. orphaned visitors), ev_* activities survive,
 *      seed sort_order restored for staff/locations (row presence and
 *      value asserted separately), staff_positions/positions rebuilt to
 *      seed, non-seed master_tags dropped and users.staff_id detached
 *      (GH #266 four-table staff domain).
 *
 * Uses TEST_DB_PATH pointing at a temp file — no backend, no shard stack.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { RESET_SQL, resolveSeedDbPath, resetToSeed } from '../e2e/fixtures/seed-reset';

let tmpDir: string;
let dbPath: string;

/** Create a minimal DB shaped like the real schema (only columns under test).
 *
 *  GH #266: the staff domain is now FOUR tables — `staff` (the person, owns
 *  `sort_order`), `masters` (the schedule extension, keyed by `staff_id`),
 *  `positions` (dictionary), `staff_positions` (M2M) — plus `master_tags` and
 *  `users.staff_id`. RESET_SQL was rewritten to that shape in T7, so this
 *  fixture mirrors it (the pre-#266 single-`masters` table no longer exists). */
function createSchema(db: string) {
  execSync(`sqlite3 "${db}" "
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE visitors (id TEXT PRIMARY KEY, client_id TEXT, name TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE records (id TEXT PRIMARY KEY, activity_id TEXT, client_id TEXT);
    CREATE TABLE visits (id TEXT PRIMARY KEY, record_id TEXT);
    CREATE TABLE payments (id TEXT PRIMARY KEY, record_id TEXT);
    CREATE TABLE staff (id TEXT PRIMARY KEY, sort_order INTEGER);
    CREATE TABLE masters (staff_id TEXT PRIMARY KEY, specialty TEXT, color TEXT, is_active INTEGER);
    CREATE TABLE positions (id TEXT PRIMARY KEY, title TEXT, is_system INTEGER);
    CREATE TABLE staff_positions (staff_id TEXT, position_id TEXT, PRIMARY KEY (staff_id, position_id));
    CREATE TABLE master_tags (master_id TEXT, tag_id TEXT, PRIMARY KEY (master_id, tag_id));
    CREATE TABLE users (id TEXT PRIMARY KEY, phone TEXT, staff_id TEXT);
    CREATE TABLE locations (id TEXT PRIMARY KEY, sort_order INTEGER);
  "`);
}

/** Insert seed rows (short ids / ev_* prefix / canonical sort_order) + garbage.
 *  GH #266: seed sort_order lives on `staff` (m1…m7); `masters` is keyed by
 *  staff_id; the seed positions dictionary is master/admin/smm. */
function seedAndPollute(db: string) {
  execSync(`sqlite3 "${db}" "
    INSERT INTO clients (id, name) VALUES ('c1', 'Seed Client');
    INSERT INTO clients (id, name) VALUES ('${'x'.repeat(36)}', 'Polluted Client');
    INSERT INTO visitors (id, client_id, name) VALUES ('v1', 'c1', 'Seed Visitor');
    INSERT INTO visitors (id, client_id, name) VALUES ('${'w'.repeat(36)}', 'c1', 'Orphan Visitor');
    INSERT INTO activities (id, title) VALUES ('ev_0', 'Seed Activity');
    INSERT INTO activities (id, title) VALUES ('ev_fixed_0', 'Seed Fixed Activity');
    INSERT INTO activities (id, title) VALUES ('evt_something', 'EvT Non-Seed (must go)');
    INSERT INTO records (id, activity_id, client_id) VALUES ('r1', 'ev_0', 'c1');
    INSERT INTO records (id, activity_id, client_id) VALUES ('${'y'.repeat(36)}', 'ev_0', 'c1');
    INSERT INTO visits (id, record_id) VALUES ('v1', 'r1');
    INSERT INTO visits (id, record_id) VALUES ('${'z'.repeat(36)}', 'r1');
    INSERT INTO payments (id, record_id) VALUES ('p1', 'r1');
    INSERT INTO payments (id, record_id) VALUES ('${'q'.repeat(36)}', 'r1');
    INSERT INTO staff (id, sort_order) VALUES ('m1', 7);
    INSERT INTO staff (id, sort_order) VALUES ('m2', 3);
    INSERT INTO staff (id, sort_order) VALUES ('m7', 99);
    INSERT INTO masters (staff_id, specialty, color, is_active) VALUES ('m1', 'живопись', '#5B8C7A', 1);
    INSERT INTO positions (id, title, is_system) VALUES ('master', 'Master-renamed', 0);
    INSERT INTO positions (id, title, is_system) VALUES ('admin', 'Администратор', 1);
    INSERT INTO positions (id, title, is_system) VALUES ('smm', 'СММ', 0);
    INSERT INTO master_tags (master_id, tag_id) VALUES ('m1', 't1');
    INSERT INTO users (id, phone, staff_id) VALUES ('u1', '+79990000001', 'm1');
    INSERT INTO locations (id, sort_order) VALUES ('alpika', 5);
    INSERT INTO locations (id, sort_order) VALUES ('grand', 0);
    INSERT INTO locations (id, sort_order) VALUES ('p1389', 4);
  "`);
}

function count(db: string, sql: string): number {
  const out = execSync(`sqlite3 "${db}" "${sql}"`, { encoding: 'utf-8' }).trim();
  return parseInt(out, 10) || 0;
}

/** Read a single numeric value; a missing row (empty output) → NaN, so a
 *  value of 0 can never masquerade as an absent row. */
function scalar(db: string, sql: string): number {
  const out = execSync(`sqlite3 "${db}" "${sql}"`, { encoding: 'utf-8' }).trim();
  const n = parseInt(out, 10);
  return Number.isNaN(n) ? NaN : n;
}

describe('resolveSeedDbPath (call-time resolution)', () => {
  const ORIGINAL = { ...process.env };

  beforeEach(() => {
    delete process.env.SHARD_ID;
    delete process.env.TEST_DB_PATH;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('SHARD_ID wins over TEST_DB_PATH (shard mode) and anchors at <repo>/backend', () => {
    process.env.SHARD_ID = '3';
    process.env.TEST_DB_PATH = '/tmp/should-be-ignored.sqlite';
    const resolved = resolveSeedDbPath();
    // 4 levels up from e2e/fixtures → repo root, exactly like helpers.ts
    // resolveDBPath() in the same directory (vitest keeps real __dirname).
    // This test file lives at <repo>/frontend/admin/__tests__/ → 3 up.
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolved).toBe(path.join(repoBackend, 'test_memo_shard3.db'));
  });

  it('TEST_DB_PATH is used when SHARD_ID is unset', () => {
    process.env.TEST_DB_PATH = '/tmp/custom-test-db.sqlite';
    expect(resolveSeedDbPath()).toBe('/tmp/custom-test-db.sqlite');
  });

  it('falls back to backend/test_memo.db by default', () => {
    const repoBackend = path.resolve(__dirname, '..', '..', '..', 'backend');
    expect(resolveSeedDbPath()).toBe(path.join(repoBackend, 'test_memo.db'));
  });
});

describe('resetToSeed (against a real temp SQLite DB)', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-reset-test-'));
    dbPath = path.join(tmpDir, 'unit-test-memo.db');
    createSchema(dbPath);
    seedAndPollute(dbPath);
    process.env.SHARD_ID = '';
    delete process.env.SHARD_ID;
    process.env.TEST_DB_PATH = dbPath;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TEST_DB_PATH;
  });

  it('RESET_SQL starts with the busy_timeout pragma (live-backend lock regime)', () => {
    expect(RESET_SQL.trimStart().startsWith('PRAGMA busy_timeout=5000;')).toBe(true);
  });

  it('removes non-seed rows children-first and keeps seed rows', () => {
    resetToSeed();

    // seed rows survive
    expect(count(dbPath, "SELECT COUNT(*) FROM clients WHERE id='c1'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM visitors WHERE id='v1'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM records WHERE id='r1'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM visits WHERE id='v1'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM payments WHERE id='p1'")).toBe(1);

    // non-seed rows are gone
    expect(count(dbPath, 'SELECT COUNT(*) FROM clients WHERE length(id) > 3')).toBe(0);
    expect(count(dbPath, 'SELECT COUNT(*) FROM visitors WHERE length(id) > 5')).toBe(0);
    expect(count(dbPath, 'SELECT COUNT(*) FROM records WHERE length(id) > 3')).toBe(0);
    expect(count(dbPath, 'SELECT COUNT(*) FROM visits WHERE length(id) > 3')).toBe(0);
    expect(count(dbPath, 'SELECT COUNT(*) FROM payments WHERE length(id) > 3')).toBe(0);
  });

  it('keeps ev_* activities but removes other non-seed activities (prefix filter, not length)', () => {
    resetToSeed();

    expect(count(dbPath, "SELECT COUNT(*) FROM activities WHERE id='ev_0'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM activities WHERE id='ev_fixed_0'")).toBe(1);
    // 'ev_fixed_0' (length 10) survives only because the canonical filter is
    // prefix-based: a naive length filter (like the other tables use) would
    // delete it, and 'evt_something' must go in either case.
    expect(count(dbPath, "SELECT COUNT(*) FROM activities WHERE id='ev_fixed_0'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM activities WHERE id='evt_something'")).toBe(0);
  });

  it('restores canonical sort_order for seed staff and locations', () => {
    resetToSeed();

    // Existence first: the scalar query below yields 0 for a MISSING row,
    // so canonical 0 values (m1, alpika) would be indistinguishable from a
    // deleted row without these checks.
    expect(count(dbPath, "SELECT COUNT(*) FROM staff WHERE id='m1'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM staff WHERE id='m2'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM staff WHERE id='m7'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM locations WHERE id='alpika'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM locations WHERE id='grand'")).toBe(1);
    expect(count(dbPath, "SELECT COUNT(*) FROM locations WHERE id='p1389'")).toBe(1);

    expect(scalar(dbPath, "SELECT sort_order FROM staff WHERE id='m1'")).toBe(0);
    expect(scalar(dbPath, "SELECT sort_order FROM staff WHERE id='m2'")).toBe(1);
    expect(scalar(dbPath, "SELECT sort_order FROM staff WHERE id='m7'")).toBe(5);
    expect(scalar(dbPath, "SELECT sort_order FROM locations WHERE id='alpika'")).toBe(0);
    expect(scalar(dbPath, "SELECT sort_order FROM locations WHERE id='grand'")).toBe(1);
    expect(scalar(dbPath, "SELECT sort_order FROM locations WHERE id='p1389'")).toBe(2);
  });

  it('rebuilds the seed staff_positions and restores seed positions title/is_system', () => {
    // A spec may rename «master» or flip is_system (T9 positions CRUD); the
    // reset restores the canonical dictionary and the 6 seed card links.
    resetToSeed();

    expect(scalar(dbPath, "SELECT COUNT(*) FROM staff_positions WHERE staff_id='m1' AND position_id='master'")).toBe(1);
    expect(scalar(dbPath, "SELECT COUNT(*) FROM staff_positions")).toBe(6); // m1–m5, m7
    expect(scalar(dbPath, "SELECT is_system FROM positions WHERE id='master'")).toBe(1);
    expect(execSync(`sqlite3 "${dbPath}" "SELECT title FROM positions WHERE id='master'"`, { encoding: 'utf-8' }).trim()).toBe('Мастер');
    expect(scalar(dbPath, "SELECT is_system FROM positions WHERE id='smm'")).toBe(0);
  });

  it('removes non-seed master_tags and detaches non-seed users.staff_id', () => {
    // master_tags of non-seed masters go (child of masters, no CLI cascade);
    // users rows are KEPT but their staff_id detached (auth cookie survives).
    execSync(`sqlite3 "${dbPath}" "
      INSERT INTO staff (id, sort_order) VALUES ('${'u'.repeat(36)}', 100);
      INSERT INTO master_tags (master_id, tag_id) VALUES ('${'u'.repeat(36)}', 'tX');
      INSERT INTO users (id, phone, staff_id) VALUES ('u2', '+79990000099', '${'u'.repeat(36)}');
    "`);
    resetToSeed();

    expect(count(dbPath, "SELECT COUNT(*) FROM master_tags WHERE master_id='m1'")).toBe(1);
    expect(count(dbPath, `SELECT COUNT(*) FROM master_tags WHERE master_id='${'u'.repeat(36)}'`)).toBe(0);
    expect(count(dbPath, "SELECT COUNT(*) FROM users WHERE id='u2'")).toBe(1); // row kept
    expect(execSync(`sqlite3 "${dbPath}" "SELECT staff_id FROM users WHERE id='u2'"`, { encoding: 'utf-8' }).trim()).toBe('');
    expect(count(dbPath, `SELECT COUNT(*) FROM staff WHERE id='${'u'.repeat(36)}'`)).toBe(0);
  });
});
