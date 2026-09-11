// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../e2e/fixtures/sqlite-exec', () => ({
  sqliteExecWithRetry: vi.fn(),
}));
vi.mock('../e2e/fixtures/warmup-routes', () => ({ WARMUP_ROUTES: [] }));
// GH #247 T14: globalSetup now logs the seeded admin in via Playwright's
// request API after the diagnostics. Stub the request context so the
// happy-path tests can complete without a live backend.
vi.mock('@playwright/test', () => ({
  request: {
    newContext: vi.fn(async () => ({
      post: vi.fn(async () => ({
        ok: () => true,
        json: async () => ({ user: { role: 'admin' } }),
      })),
      storageState: vi.fn(async () => ({ cookies: [], origins: [] })),
      dispose: vi.fn(async () => undefined),
    })),
  },
}));

import { sqliteExecWithRetry } from '../e2e/fixtures/sqlite-exec';
import globalSetupFunc from '../e2e/globalSetup';

describe('globalSetup #152 diagnostics', () => {
  beforeEach(() => {
    vi.mocked(sqliteExecWithRetry).mockReset();
    // Avoid polluting env between tests
    vi.stubEnv('SHARD_ID', '2');
    vi.stubEnv('SHARD_PORT', '3003');
    vi.stubEnv('BACKEND_PORT', '8002');
    // Silence console
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('throws when seed rows are missing (manual-run bypass)', async () => {
    // First sqliteExecWithRetry call (UUID cleanup, current code) returns ''
    vi.mocked(sqliteExecWithRetry).mockReturnValueOnce('');
    // Second sqliteExecWithRetry call (seed-rows check) returns '0'
    vi.mocked(sqliteExecWithRetry).mockReturnValueOnce('0');

    await expect(globalSetupFunc()).rejects.toThrow(/Seed data is missing/);
  });

  it('throws when current-week activities API returns empty', async () => {
    vi.mocked(sqliteExecWithRetry).mockReturnValueOnce('').mockReturnValueOnce('30'); // cleanup OK, seed rows present
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as any);

    await expect(globalSetupFunc()).rejects.toThrow(/No activities for the current week/);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('passes when seed rows present and activities API non-empty', async () => {
    vi.mocked(sqliteExecWithRetry).mockReturnValueOnce('').mockReturnValueOnce('30');
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
    vi.stubEnv('BACKEND_PORT', '8002');

    vi.mocked(sqliteExecWithRetry)
      .mockReturnValueOnce('')        // UUID cleanup (existing call)
      .mockReturnValueOnce('30');     // seed-rows check (new diagnostic branch 1)
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
});
