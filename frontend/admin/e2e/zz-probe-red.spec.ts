import { test, expect } from '@playwright/test';

// ВРЕМЕННАЯ красная проба (GH #415 DoD: trace.zip в артефакте при падении).
// Будет откачена отдельным revert-коммитом сразу после проверки артефакта.
test('forced-red probe: assert fail → retry → trace', async ({ page }) => {
  await page.goto('/');
  expect(true).toBe(false);
});
