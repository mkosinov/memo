// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

vi.mock('../e2e/fixtures/sqlite-exec', () => ({
  sqliteExecWithRetry: vi.fn(),
}));
vi.mock('../e2e/fixtures/warmup-routes', () => ({ WARMUP_ROUTES: [] }));
// GH #247 T14: globalSetup now logs the seeded admin in via Playwright's
// request API after the diagnostics. Stub the request context so the
// happy-path tests can complete without a live backend.
// GH #263 T8: a SECOND login (the demo master, +79990000002) was added —
// the stub is role-aware per the phone in the POST body, otherwise the
// master login's role assertion aborts the run.
vi.mock('@playwright/test', () => ({
  request: {
    newContext: vi.fn(async () => ({
      post: vi.fn(async (_url: string, opts?: { data?: { phone?: string } }) => {
        const role = opts?.data?.phone === '+79990000002' ? 'master' : 'admin';
        return {
          ok: () => true,
          json: async () => ({ user: { role } }),
        };
      }),
      storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
      dispose: vi.fn(async () => undefined),
    })),
  },
}));

import { sqliteExecWithRetry } from '../e2e/fixtures/sqlite-exec';
import globalSetupFunc from '../e2e/globalSetup';

// GH #310: globalSetup now (1) boot-applies the canon file, (2) sanity-checks
// it against the schema, (3) runs the #152 checks. The mocks below feed that
// call sequence:
//   sqlite call #1 — canon application (.read) — returns ''
//   sqlite call #2 — schema table list for the canon sanity — returns the
//                    tables the fake canon below "covers"
//   sqlite call #3 — #152 seed-rows count — per test ('0' or '30')
// The canon file itself is a REAL temp file (TEST_DB_PATH-based, SHARD_ID
// unset), so resetToSeed()'s existence check and the sanity read succeed.
describe('globalSetup #152 diagnostics', () => {
  let tmpDir: string;

  beforeEach(() => {
    vi.mocked(sqliteExecWithRetry).mockReset();
    // Avoid polluting env between tests; a TEST_DB_PATH (no SHARD_ID) keeps
    // the canon path inside our temp dir instead of <repo>/backend.
    vi.stubEnv('SHARD_PORT', '3003');
    vi.stubEnv('BACKEND_PORT', '8002');
    delete process.env.SHARD_ID;

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'globalsetup-diag-'));
    const dbPath = path.join(tmpDir, 'test_memo_diag.db');
    process.env.TEST_DB_PATH = dbPath;
    fs.writeFileSync(
      `${dbPath}.canon.sql`,
      '-- fake canon (GH #310 unit fixture)\n' +
        'PRAGMA busy_timeout=5000;\nPRAGMA foreign_keys=OFF;\nBEGIN IMMEDIATE;\n' +
        'DELETE FROM "activities";\nDELETE FROM "records";\n' +
        'INSERT INTO "records" ("id") VALUES (\'r1\');\nCOMMIT;\n',
    );

    // Silence console
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TEST_DB_PATH;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('throws when seed rows are missing (manual-run bypass)', async () => {
    vi.mocked(sqliteExecWithRetry)
      .mockReturnValueOnce('') // canon application (.read)
      .mockReturnValueOnce('activities\nrecords') // schema tables for sanity
      .mockReturnValueOnce('0'); // seed-rows check → missing

    await expect(globalSetupFunc()).rejects.toThrow(/Seed data is missing/);
  });

  it('throws when current-week activities API returns empty', async () => {
    vi.mocked(sqliteExecWithRetry)
      .mockReturnValueOnce('')
      .mockReturnValueOnce('activities\nrecords')
      .mockReturnValueOnce('30'); // seed rows present
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as any);

    await expect(globalSetupFunc()).rejects.toThrow(/No activities for the current week/);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('passes when seed rows present and activities API non-empty', async () => {
    vi.mocked(sqliteExecWithRetry)
      .mockReturnValueOnce('')
      .mockReturnValueOnce('activities\nrecords')
      .mockReturnValueOnce('30');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'ev_0' }],
    } as any);

    await expect(globalSetupFunc()).resolves.toBeUndefined();
  });

  it('uses BACKEND_URL (not SHARD_PORT) for the activities API call (bug from PR #153 CI red)', async () => {
    // Setup env like CI: backend on :8002, frontend on :3003 (SHARD_PORT).
    vi.stubEnv('BACKEND_URL', 'http://127.0.0.1:8002');
    vi.stubEnv('SHARD_PORT', '3003');      // frontend — must NOT end up in the URL

    vi.mocked(sqliteExecWithRetry)
      .mockReturnValueOnce('')
      .mockReturnValueOnce('activities\nrecords')
      .mockReturnValueOnce('30');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'ev_0' }],
    } as any);

    await globalSetupFunc();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    // Must point at BACKEND_URL (backend 8002), NOT SHARD_PORT (frontend 3003)
    expect(String(calledUrl)).toContain('8002');
    expect(String(calledUrl)).not.toContain('3003');
  });

  it('throws a clear #310 diagnostic when the canon does not cover a schema table', async () => {
    // Sanity check: the fake canon covers activities+records, but the schema
    // (mocked) also has "clients" — the mismatch must fail loud and early.
    vi.mocked(sqliteExecWithRetry)
      .mockReturnValueOnce('')
      .mockReturnValueOnce('activities\nrecords\nclients');

    await expect(globalSetupFunc()).rejects.toThrow(/does not cover schema table\(s\): clients/);
  });
});
