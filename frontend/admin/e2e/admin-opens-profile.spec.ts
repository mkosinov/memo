import { test, expect } from '@playwright/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';

test('US-M04: Admin can open client profile from a record', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // Open an activity with at least one record
  await openModal(page);

  // Switch to first client tab
  const clientTab = page.locator('[data-testid^="tab-client-"]').first();
  await expect(clientTab).toBeVisible({ timeout: 5_000 });
  await clientTab.click();

  // Wait for client tab to load
  await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 5_000 });

  // The profile link is a span with data-testid="open-profile-{recordId}"
  // that opens /clients?clientId={id} in a new tab
  const profileLink = page.locator('[data-testid^="open-profile-"]').first();
  await expect(profileLink).toBeVisible({ timeout: 5_000 });

  // Click the profile link — it opens a new tab via window.open and closes the modal
  const [newPage] = await Promise.all([
    page.context().waitForEvent('page'),
    profileLink.click(),
  ]);

  // Assert: new page URL changes to /clients?clientId=...
  await expect(newPage).toHaveURL(/\/clients\?clientId=/);

  await newPage.close();
});
