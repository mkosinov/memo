import { test as base, expect } from '@playwright/test';
import { resetToSeed, snapshotDb, wipeAvatarsDir } from './seed-reset';

export const test = base.extend<{ seedReset: void }>({   // test scope — runs before EVERY test, incl. retries
  seedReset: [async ({}, use, testInfo) => {
    if ((testInfo.config.workers ?? 1) > 1)
      throw new Error('[seed-reset] workers>1 is unsupported: reset races across workers (config pins workers: 1)');
    if (testInfo.retry > 0) await snapshotDb(testInfo);
    await resetToSeed();
    // GH #262 §6 — wipe the avatars dir TOGETHER with the DB so a portrait
    // uploaded by one test never leaks into the next (seed users carry none).
    wipeAvatarsDir();
    await use();
  }, { auto: true, scope: 'test' }],
});
export { expect };
