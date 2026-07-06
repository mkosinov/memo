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

  // Scenario 1: Verify empty row with placeholders
  const newRow = page.locator('[data-testid="visit-row-new"]');
  await expect(newRow).toBeVisible();
  // Name input is auto-focused (has autoFocus attribute)
  const nameInput = page.locator('[data-testid="add-visitor-name"]');
  await expect(nameInput).toBeVisible();
  // Age shows "Взрослый" placeholder
  await expect(page.locator('[data-testid="add-visitor-age"]')).toBeVisible();

  // Fill the name and commit via Enter (blur-to-commit)
  await nameInput.fill('Тест Тестов');
  await nameInput.press('Enter');

  // Scenario 2: After save, the new-row testid changes to visit-row-{id}
  await expect(newRow).not.toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid^="visit-row-"]').first()).toBeVisible({ timeout: 5_000 });

  // Verify the visitor count increased
  const finalCount = await page.locator('[data-testid$="-age"]').count();
  expect(finalCount).toBeGreaterThan(initialCount);
});
