import { test, expect } from '@playwright/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';

test('US-M03: Admin can add visitor and see it in modal without F5', async ({
  page,
}) => {
  await page.goto('/schedule');
  await waitForScheduleReady(page);

  // Open an activity via custom event (bypasses @dnd-kit pointer interception)
  await openModal(page);

  // Switch to first client tab
  const clientTab = page.locator('[data-testid^="tab-client-"]').first();
  await expect(clientTab).toBeVisible({ timeout: 5_000 });
  await clientTab.click();

  // Wait for the client tab content to load
  await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 5_000 });

  // Verify the visits table is visible
  const visitsTable = page.locator('[data-testid="record-visits-table"]');
  await expect(visitsTable).toBeVisible();

  // Count existing visitors before adding
  const initialCount = await page.locator('[data-testid$="-age"]').count();

  // Click "+ Добавить" to open the inline add form
  const addBtn = page.locator('[data-testid="btn-add-visitor"]');
  await expect(addBtn).toBeVisible();
  await addBtn.click();

  // Fill the name in the inline form
  const nameInput = page.locator('[data-testid="add-visitor-name"]');
  await expect(nameInput).toBeVisible();
  await nameInput.fill('Тест Тестов');
  // Blur the input to trigger the onBlur handler which submits the form
  await nameInput.blur();

  // Wait for the visitor to be added
  await page.waitForTimeout(1000);

  // Verify the visitor count increased
  const finalCount = await page.locator('[data-testid$="-age"]').count();
  expect(finalCount).toBeGreaterThan(initialCount);
});
