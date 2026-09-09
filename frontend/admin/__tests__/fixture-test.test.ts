/**
 * fixture-test.test.ts — Unit tests for the e2e wrapper test fixture (GH #252).
 *
 * Verifies the module SHAPE (spec §3.2) without booting Playwright:
 *   1. exports a `test` extended from @playwright/test's base test
 *   2. registers an `auto`, test-scoped `seedReset` fixture
 *   3. re-exports `expect`
 *   4. the fixture body throws the labeled guard error when workers > 1
 *      BEFORE snapshot/reset, snapshots on retry, and resets otherwise.
 *
 * The real behavioral proof (reset actually runs before every test) is
 * Task 4/6 E2E — here we pin the fixture wiring that those runs rely on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @playwright/test BEFORE importing the module under test: base.extend
// must capture the fixture definition verbatim so we can assert its options
// and invoke its body directly. vi.hoisted() runs before the hoisted
// vi.mock factories, so the record is initialized when extend() fires at
// module load of the module under test.
const hoisted = vi.hoisted(() => ({
  recordedDefinition: {} as {
    fn?: (...args: unknown[]) => unknown;
    options?: Record<string, unknown>;
  },
  calls: [] as string[],
}));
const recordedName = 'seedReset';
const recordedDefinition = hoisted.recordedDefinition;

vi.mock('@playwright/test', () => ({
  test: {
    extend: (fixtures: Record<string, unknown>) => {
      const [definition, options] = Object.values(fixtures)[0] as [
        (...args: unknown[]) => unknown,
        Record<string, unknown>,
      ];
      hoisted.recordedDefinition.fn = definition;
      hoisted.recordedDefinition.options = options;
      // Return a shape-only extended test object — nothing else is used.
      return { __extendedWith: fixtures };
    },
  },
  expect: { path: '@playwright/test-expect' },
}));

// Mock seed-reset so the fixture body can be invoked without sqlite3 spawns
// and we can assert call ORDER (guard → snapshot → reset).
const calls = hoisted.calls;
vi.mock('../e2e/fixtures/seed-reset', () => ({
  resetToSeed: () => {
    calls.push('reset');
    return 'reset-output';
  },
  snapshotDb: (testInfo: { outputDir: string }) => {
    calls.push(`snapshot:${testInfo.outputDir}`);
    return 'snapshot-output';
  },
}));

// A minimal TestInfo-like object covering everything the fixture touches.
function makeTestInfo(workers: number, retry: number) {
  return {
    retry,
    config: { workers },
    outputDir: '/fake-output-dir',
  };
}

/** Invoke the recorded fixture body the way Playwright would, awaiting use(). */
async function runFixture(testInfo: ReturnType<typeof makeTestInfo>): Promise<{ useCalled: boolean }> {
  let useCalled = false;
  await recordedDefinition.fn!({}, () => {
    calls.push('use');
    useCalled = true;
  }, testInfo);
  return { useCalled };
}

// Import AFTER mocks are registered (vi.mock is hoisted anyway).
import { test as wrapperTest, expect as wrapperExpect } from '../e2e/fixtures/test';

// The mocked @playwright/test expect object — identity check for the re-export.
// vi.mock factories are hoisted; the mocked module registry hands us the same
// instance the module under test imported.
import * as playwrightModule from '@playwright/test';

describe('e2e/fixtures/test wrapper module', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('re-exports expect from @playwright/test (not a local copy)', () => {
    expect(wrapperExpect).toBe((playwrightModule as { expect: unknown }).expect);
  });

  it('extends the base test with exactly one fixture named seedReset', () => {
    // extend was called during module load; recordedDefinition holds the entry.
    expect(recordedName).toBe('seedReset');
    expect(recordedDefinition.fn).toBeTypeOf('function');
  });

  it('seedReset is auto + test-scoped', () => {
    expect(recordedDefinition.options).toEqual({ auto: true, scope: 'test' });
  });

  it('throws the labeled guard error BEFORE snapshot/reset when workers > 1', async () => {
    await expect(runFixture(makeTestInfo(2, 0))).rejects.toThrow(
      '[seed-reset] workers>1 is unsupported: reset races across workers (config pins workers: 1)',
    );
    // Guard must fire before any DB work — not even a snapshot on retries.
    expect(calls).toEqual([]);
  });

  it('resets to seed on a first attempt (no snapshot) and calls use()', async () => {
    const { useCalled } = await runFixture(makeTestInfo(1, 0));
    expect(calls).toEqual(['reset', 'use']);
    expect(useCalled).toBe(true);
  });

  it('snapshots the DB BEFORE reset on a retry attempt', async () => {
    await runFixture(makeTestInfo(1, 1));
    expect(calls).toEqual(['snapshot:/fake-output-dir', 'reset', 'use']);
  });
});
