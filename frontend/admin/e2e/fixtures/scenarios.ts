import { Page, expect } from '@playwright/test';
import { waitForScheduleReady } from './helpers';
import { queryDB, queryDBRow } from './db-query';

/**
 * Full-flow scenario helpers. Each helper performs a complete
 * user action and returns data the test can assert on.
 *
 * Pattern: helpers throw on failure (use expect), so tests can
 * chain them and assert at the end.
 */

/**
 * Open a specific activity on the schedule by its title text.
 * Assumes admin is already on /schedule.
 */
export async function openActivityByTitle(
  page: Page,
  title: string
): Promise<void> {
  await waitForScheduleReady(page);
  const card = page.locator(`[data-testid="activity-card"]`).filter({
    hasText: title,
  });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.locator('[role="dialog"]')).toBeVisible();
}

/**
 * Switch to the Records tab inside the open activity modal.
 */
export async function switchToRecordsTab(page: Page): Promise<void> {
  await page.click('button[role="tab"]:has-text("Запись")');
  await expect(page.locator('[data-testid="records-tab"]')).toBeVisible();
}

/**
 * Add a visitor (record) to the currently open activity.
 * Returns the record ID from the DB.
 */
export async function addVisitor(
  page: Page,
  data: { name: string; phone: string; seats: number }
): Promise<string> {
  await page.click('button:has-text("Добавить посетителя")');

  await page.fill('input[name="name"]', data.name);
  await page.fill('input[name="phone"]', data.phone);
  await page.fill('input[name="seats"]', String(data.seats));

  await page.click('button:has-text("Сохранить")');

  // Wait for record to appear in list
  const record = page.locator('[data-testid="record"]').filter({
    hasText: data.name,
  });
  await expect(record).toBeVisible({ timeout: 5000 });

  // Return ID from DB
  const row = await queryDBRow(
    `SELECT id FROM records WHERE client_name = '${data.name.replace(/'/g, "''")}' ORDER BY id DESC LIMIT 1`
  );
  if (!row) throw new Error(`Record not found in DB: ${data.name}`);
  return String(row.id);
}

/**
 * Read the occupied value from the activity card footer.
 * Returns "N/M" string.
 */
export async function getOccupied(page: Page): Promise<string> {
  const el = page.locator('[data-testid="occupied"]').first();
  return (await el.textContent()) ?? '';
}

/**
 * Get a record's status icon name (Russian).
 */
export async function getRecordStatus(
  page: Page,
  recordName: string
): Promise<string> {
  const record = page.locator('[data-testid="record"]').filter({
    hasText: recordName,
  });
  const icon = record.locator('[data-testid="status-icon"]');
  return (await icon.getAttribute('data-status')) ?? '';
}
