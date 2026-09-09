/**
 * seed-reset.test.ts — Unit tests for the shared e2e seed-reset module (GH #252).
 *
 * Verifies, against a REAL throwaway SQLite DB (sqlite3 CLI):
 *   1. call-time DB path resolution order: SHARD_ID → TEST_DB_PATH → default
 *   2. resetToSeed() executes the canonical RESET_SQL: non-seed rows removed
 *      (children-first incl. orphaned visitors), ev_* activities survive,
 *      seed sort_order restored for masters/locations.
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

/** Create a minimal DB shaped like the real schema (only columns under test). */
function createSchema(db: string) {
  execSync(`sqlite3 "${db}" "
    CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE visitors (id TEXT PRIMARY KEY, client_id TEXT, name TEXT);
    CREATE TABLE activities (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE records (id TEXT PRIMARY KEY, activity_id TEXT, client_id TEXT);
    CREATE TABLE visits (id TEXT PRIMARY KEY, record_id TEXT);
    CREATE TABLE payments (id TEXT PRIMARY KEY, record_id TEXT);
    CREATE TABLE masters (id TEXT PRIMARY KEY, sort_order INTEGER);
    CREATE TABLE locations (id TEXT PRIMARY KEY, sort_order INTEGER);
  "`);
}

/** Insert seed rows (short ids / ev_* prefix / canonical sort_order) + garbage. */
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
    INSERT INTO masters (id, sort_order) VALUES ('m1', 7);
    INSERT INTO masters (id, sort_order) VALUES ('m2', 3);
    INSERT INTO masters (id, sort_order) VALUES ('m7', 99);
    INSERT INTO locations (id, sort_order) VALUES ('alpika', 5);
    INSERT INTO locations (id, sort_order) VALUES ('grand', 0);
    INSERT INTO locations (id, sort_order) VALUES ('p1389', 4);
  "`);
}

function count(db: string, sql: string): number {
  const out = execSync(`sqlite3 "${db}" "${sql}"`, { encoding: 'utf-8' }).trim();
  return parseInt(out, 10) || 0;
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
    // 'evt_something' is length 13 > 5 — the old globalSetup length-filter would
    // keep it; the canonical prefix filter must delete it.
    expect(count(dbPath, "SELECT COUNT(*) FROM activities WHERE id='evt_something'")).toBe(0);
  });

  it('restores canonical sort_order for seed masters and locations', () => {
    resetToSeed();

    expect(count(dbPath, "SELECT sort_order FROM masters WHERE id='m1'")).toBe(0);
    expect(count(dbPath, "SELECT sort_order FROM masters WHERE id='m2'")).toBe(1);
    expect(count(dbPath, "SELECT sort_order FROM masters WHERE id='m7'")).toBe(5);
    expect(count(dbPath, "SELECT sort_order FROM locations WHERE id='alpika'")).toBe(0);
    expect(count(dbPath, "SELECT sort_order FROM locations WHERE id='grand'")).toBe(1);
    expect(count(dbPath, "SELECT sort_order FROM locations WHERE id='p1389'")).toBe(2);
  });
});
