// @vitest-environment node
//
// This suite exercises a Node-only fixture module (child_process). The
// default jsdom environment causes the `child_process` mock to resolve to a
// different module instance than the one imported by sqlite-exec.ts, so we
// force the node environment here.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  default: { execSync: vi.fn() },
}));

import { execSync } from 'child_process';
import { sqliteExecWithRetry, MAX_RETRIES, RETRY_DELAY_MS } from '../e2e/fixtures/sqlite-exec';

const mockExecSync = vi.mocked(execSync);

describe('sqliteExecWithRetry', () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns trimmed output when execSync succeeds on the first try', () => {
    mockExecSync.mockReturnValueOnce('  result  \n');

    const result = sqliteExecWithRetry('sqlite3 test.db "SELECT 1"');

    expect(result).toBe('result');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('retries on "database is locked" and succeeds on the third attempt', () => {
    mockExecSync
      .mockImplementationOnce(() => {
        throw new Error('database is locked');
      })
      .mockImplementationOnce(() => {
        throw new Error('database is locked');
      })
      .mockReturnValueOnce('ok');

    const result = sqliteExecWithRetry('sqlite3 test.db "SELECT 1"');

    expect(result).toBe('ok');
    expect(mockExecSync).toHaveBeenCalledTimes(3);
  });

  it('throws after exhausting MAX_RETRIES when the DB stays locked', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('database is locked');
    });

    expect(() => sqliteExecWithRetry('sqlite3 test.db "SELECT 1"')).toThrow('database is locked');
    expect(mockExecSync).toHaveBeenCalledTimes(MAX_RETRIES);
  });

  it('rethrows immediately on a non-lock error without retrying', () => {
    mockExecSync.mockImplementationOnce(() => {
      throw new Error('no such table: foo');
    });

    expect(() => sqliteExecWithRetry('sqlite3 test.db "SELECT 1"')).toThrow('no such table: foo');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('exposes the expected retry constants', () => {
    expect(MAX_RETRIES).toBe(5);
    expect(RETRY_DELAY_MS).toBe(200);
  });
});
