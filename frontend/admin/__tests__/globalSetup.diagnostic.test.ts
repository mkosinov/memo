// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../e2e/fixtures/sqlite-exec', () => ({
  sqliteExecWithRetry: vi.fn(),
}));
vi.mock('../e2e/fixtures/warmup-routes', () => ({ WARMUP_ROUTES: [] }));

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
});
