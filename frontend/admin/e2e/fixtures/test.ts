import { test as base, expect } from '@playwright/test';
import { resetToSeed, snapshotDb } from './seed-reset';

export const test = base.extend<{ seedReset: void }>({   // test scope — runs before EVERY test, incl. retries
  seedReset: [async ({}, use, testInfo) => {
    if ((testInfo.config.workers ?? 1) > 1)
      throw new Error('[seed-reset] workers>1 is unsupported: reset races across workers (config pins workers: 1)');
    if (testInfo.retry > 0) await snapshotDb(testInfo);
    await resetToSeed();
    await use();
  }, { auto: true, scope: 'test' }],
});
export { expect };
