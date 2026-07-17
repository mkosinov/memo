// @vitest-environment node
//
// This suite exercises a Node-only fixture module (child_process via
// sqlite-exec.ts). The default jsdom environment causes module mocking to
// resolve to a different module instance, so we force the node environment
// here (see __tests__/sqlite-exec.test.ts for the same pattern).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../e2e/fixtures/sqlite-exec', () => ({
  sqliteExecWithRetry: vi.fn(),
}));

import { sqliteExecWithRetry } from '../e2e/fixtures/sqlite-exec';
import { cleanTestData } from '../e2e/fixtures/helpers';

const mockSqliteExecWithRetry = vi.mocked(sqliteExecWithRetry);

describe('cleanTestData', () => {
  beforeEach(() => {
    mockSqliteExecWithRetry.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when the DB stays locked after retries are exhausted (US-3)', () => {
    mockSqliteExecWithRetry.mockImplementation(() => {
      throw new Error('database is locked');
    });

    expect(() => cleanTestData()).toThrow('database is locked');
  });

  it('returns without throwing when the DB is not ready yet (no such table)', () => {
    mockSqliteExecWithRetry.mockImplementation(() => {
      throw new Error('no such table: foo');
    });

    expect(() => cleanTestData()).not.toThrow();
  });

  it('returns without throwing on success, calling the helper once', () => {
    mockSqliteExecWithRetry.mockReturnValueOnce('');

    expect(() => cleanTestData()).not.toThrow();
    expect(mockSqliteExecWithRetry).toHaveBeenCalledTimes(1);
  });
});
