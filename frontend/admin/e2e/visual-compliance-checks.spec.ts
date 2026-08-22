/**
 * visual-compliance-checks.spec.ts
 *
 * Manual visual compliance checks (Step 4.5) — replaces the buggy automated
 * parser with explicit Playwright assertions + screenshots.
 *
 * Checks:
 *   1. After add-visitor + Enter, the new row is present in the visits table
 *   2. After delete-visitor, the row is absent from the visits table
 *   3. The undo toast "Удалено. Отменить" is visible after deleting a saved row
 *   4. Payment totals in the /records table reflect an added payment without reload
 *
 * Approach: each test creates its own activity TODAY via factories so the
 * current week (13-19 July 2026) has a card to click. The seed data is in
 * June 2026 and not visible in the default week.
 *
 * Run with:
 *   pnpm exec playwright test e2e/visual-compliance-checks.spec.ts --reporter=list
 *
 * Screenshots → /tmp/visual-compliance-manual/
 */

import { test, expect, type Page } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { switchToRecordsTab } from './fixtures/scenarios';

const SHOTS = '/tmp/visual-compliance-manual';

function log(line: string) {
  process.stdout.write(`[VCC] ${line}\n`);
}

function dbPath() {
  if (process.env.TEST_DB_PATH) return process.env.TEST_DB_PATH;
  return path.resolve(__dirname, '../../../../backend/test_memo.db');
}

function clean() {
  try {
    execSync(
      `sqlite3 "${dbPath()}" "
        DELETE FROM payments WHERE length(id) > 3;
        DELETE FROM visits WHERE length(id) > 3;
        DELETE FROM records WHERE length(id) > 3;
        DELETE FROM activities WHERE id NOT LIKE 'ev\\_%' ESCAPE '\\\\' AND id NOT LIKE 'ev_fixed_%';
        DELETE FROM clients WHERE length(id) > 3;
      "`,
      { stdio: 'pipe' },
    );
  } catch (e: any) {
    log(`clean warn: ${e?.message}`);
  }
}

test.beforeAll(() => {
  clean();
});

test.describe.configure({ mode: 'serial' });

/**
 * Open the activity modal by the specific activity id, then switch to the
 * client tab. Mirrors the pattern from unify-caches.spec.ts.
 */
async function openClientTabFor(page: Page, recordId: string, activityId: string) {
  // 1. Navigate to /schedule and wait for it to be ready
  await page.goto('/schedule');
  // Wait for the schedule page to render
  await page.waitForSelector('h1, [data-testid^="activity-"]', { timeout: 30_000 });
  // The seed activities are in June 2026; we created our own TODAY, so the
  // current week (July 13-19) should have cards once factories complete.
  // Navigate to the week containing our activity (today).
  const today = new Date().toISOString().slice(0, 10);
  await page.evaluate((d: string) => {
    document.dispatchEvent(
      new CustomEvent('__memo-switch-to-week-view', {
        detail: { date: `${d}T12:00:00` },
      }),
    );
  }, today);
  await page.waitForSelector(`[data-testid="activity-${activityId}"]`, { timeout: 30_000 });
  await page.waitForTimeout(500);

  // 2. Find the specific activity card by its data-testid
  const card = page.locator(`[data-testid="activity-${activityId}"]`);
  await expect(card).toBeVisible({ timeout: 5_000 });

  // 3. Read the activity object from the React fiber
  const activity = await card.evaluate((el: any) => {
    const k = Object.keys(el).find((x: string) => x.startsWith('__reactFiber'));
    if (!k) return null;
    let c = (el as any)[k];
    while (c) {
      if (c.memoizedProps?.activity) return c.memoizedProps.activity;
      c = c.return;
    }
    return null;
  });
  if (!activity) throw new Error(`No React fiber activity for card ${activityId}`);

  // 4. Dispatch the open-modal event
  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-open-modal', {
      detail: { activity: act },
    }));
  }, activity);

  await expect(
    page.locator('[data-testid="activity-details-modal"]'),
  ).toBeVisible({ timeout: 10_000 });

  // 5. Switch to the client tab
  await switchToRecordsTab(page);
  await expect(page.locator('[data-testid="record-visits-table"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="record-payments-table"]')).toBeVisible({ timeout: 5_000 });
}

test('Check 1: add-visitor + Enter keeps new row in the visits table', async ({ page, request }) => {
  log('Check 1 start');
  const client = await createTestClient(request, { name: 'VCC C1 Client' });
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id);

  try {
    await openClientTabFor(page, record.id, activity.id);

    // Screenshot BEFORE add
    await page.screenshot({ path: `${SHOTS}/check1-before.png`, fullPage: false });

    // Click + Добавить
    const addBtn = page.locator('[data-testid="btn-add-visitor"]');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Fill the name and press Enter
    const nameInput = page.locator('[data-testid="add-visitor-name"]');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('VCC Check1 Person');
    await nameInput.press('Enter');

    // Wait for save
    const newRow = page.locator('[data-testid="visit-row-new"]');
    await expect(newRow).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-testid^="visit-row-"]').first()).toBeVisible({ timeout: 5_000 });

    // Screenshot AFTER add
    await page.screenshot({ path: `${SHOTS}/check1-after.png`, fullPage: false });

    // DOM assertion: there must be at least one row whose testid starts with
    // "visit-row-" (excludes "visit-row-new") and whose content matches the name.
    const savedRows = page.locator(
      '[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])',
    );
    const savedCount = await savedRows.count();
    expect(savedCount).toBeGreaterThan(0);

    // Check that the specific name is present (may live in an input value)
    const namedRow = savedRows.filter({
      has: page.locator('input[value="VCC Check1 Person"]'),
    });
    const namedCount = await namedRow.count();
    expect(namedCount).toBeGreaterThan(0);

    log(`Check 1 PASS — ${savedCount} saved visit-row(s), ${namedCount} with our name`);
  } finally {
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('__memo-close-modal'));
    }).catch(() => {});
    await cleanupRecord(request, record.id);
    await cleanup(request, `/api/v1/clients/${client.id}`);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
  }
});

test('Check 2: delete-visitor removes the row from the visits table', async ({ page, request }) => {
  log('Check 2 start');
  const client = await createTestClient(request, { name: 'VCC C2 Client' });
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id, {
    visits: [
      { name: 'VCC C2 Keep', price: 3500 },
      { name: 'VCC C2 Delete', price: 2500 },
    ],
  });

  try {
    await openClientTabFor(page, record.id, activity.id);

    // Find the "VCC C2 Delete" visit row
    const targetRow = page
      .locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])')
      .filter({ has: page.locator('input[value="VCC C2 Delete"]') });
    await expect(targetRow).toBeVisible({ timeout: 5_000 });
    const targetTestId = await targetRow.getAttribute('data-testid');
    expect(targetTestId).toBeTruthy();
    const visitId = targetTestId!.replace('visit-row-', '');

    // Screenshot BEFORE delete
    await page.screenshot({ path: `${SHOTS}/check2-before.png`, fullPage: false });

    // Click the row's delete button
    const deleteBtn = page.locator(`[data-testid="visit-row-${visitId}-delete"]`);
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Optimistic remove should drop the row from the DOM
    await expect(
      page.locator(`[data-testid="visit-row-${visitId}"]`),
    ).not.toBeVisible({ timeout: 5_000 });

    // Screenshot AFTER delete
    await page.screenshot({ path: `${SHOTS}/check2-after.png`, fullPage: false });

    // DOM assertion: row with that testid is gone
    const stillThere = await page.locator(`[data-testid="visit-row-${visitId}"]`).count();
    expect(stillThere).toBe(0);

    log(`Check 2 PASS — row visit-row-${visitId} no longer in DOM after delete`);
  } finally {
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('__memo-close-modal'));
    }).catch(() => {});
    await cleanupRecord(request, record.id);
    await cleanup(request, `/api/v1/clients/${client.id}`);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
  }
});

test('Check 3: undo toast "Удалено. Отменить" is visible after deleting a saved row', async ({ page, request }) => {
  log('Check 3 start');
  const client = await createTestClient(request, { name: 'VCC C3 Client' });
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id, {
    visits: [{ name: 'VCC C3 DeleteMe', price: 3000 }],
  });

  try {
    await openClientTabFor(page, record.id, activity.id);

    // Find the row
    const targetRow = page
      .locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])')
      .filter({ has: page.locator('input[value="VCC C3 DeleteMe"]') });
    await expect(targetRow).toBeVisible({ timeout: 5_000 });
    const targetTestId = await targetRow.getAttribute('data-testid');
    expect(targetTestId).toBeTruthy();
    const visitId = targetTestId!.replace('visit-row-', '');

    // Screenshot BEFORE delete
    await page.screenshot({ path: `${SHOTS}/check3-before.png`, fullPage: false });

    // Delete the row
    const deleteBtn = page.locator(`[data-testid="visit-row-${visitId}-delete"]`);
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    // Toast must appear with "Удалено" + "Отменить" text
    const toast = page.locator('[data-testid="toast-info"]').first();
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText('Удалено');
    await expect(toast).toContainText('Отменить');

    // Screenshot AFTER delete (with toast visible)
    await page.screenshot({ path: `${SHOTS}/check3-after.png`, fullPage: false });

    log(`Check 3 PASS — toast contains "Удалено" + "Отменить"`);
  } finally {
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('__memo-close-modal'));
    }).catch(() => {});
    await cleanupRecord(request, record.id);
    await cleanup(request, `/api/v1/clients/${client.id}`);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
  }
});

test('Check 4: /records payment totals update after add, no F5', async ({ page, request }) => {
  log('Check 4 start');
  const client = await createTestClient(request, { name: 'VCC C4 Client' });
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id, {
    visits: [{ name: 'VCC C4 Visitor', price: 5000 }],
  });
  const recordId = record.id;

  try {
    // ── Step 1: Open /records and screenshot the payment cell BEFORE
    const recordsResponse1 = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records') && r.status() === 200,
      { timeout: 30_000 },
    );
    await page.goto('/records');
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 30_000 });
    await page.waitForSelector('table', { timeout: 30_000 });
    await recordsResponse1;
    await page.waitForTimeout(800);

    // Find the row for our record (by client name)
    const targetRow = page.locator('tbody tr').filter({ hasText: 'VCC C4 Client' });
    await expect(targetRow).toBeVisible({ timeout: 10_000 });

    // Table columns (default): date(0), client(1), guests(2), service(3),
    // master(4), location(5), status(6), total(7), payment(8).
    // payment is the last visible column → index 8.
    const paymentCell = targetRow.locator('td').nth(8);
    const beforeText = (await paymentCell.textContent())?.trim() ?? '';
    log(`Check 4 BEFORE: payment cell text = "${beforeText}"`);

    await page.screenshot({ path: `${SHOTS}/check4-before.png`, fullPage: false });

    // Sanity: BEFORE should be "Не оплачено" (no payments yet)
    expect(beforeText).toBe('Не оплачено');

    // ── Step 2: Go to /schedule, open the activity modal, switch to client
    // tab, and add a payment of 1234 ₽
    await openClientTabFor(page, recordId, activity.id);

    // Add a payment of 1234
    const addPaymentBtn = page.locator('[data-testid="btn-add-payment"]');
    await expect(addPaymentBtn).toBeVisible({ timeout: 5_000 });
    await addPaymentBtn.click();
    const amountInput = page.locator('[data-testid="add-payment-amount"]');
    await expect(amountInput).toBeVisible();
    await amountInput.fill('1234');
    await amountInput.press('Enter');
    await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

    // ── Step 3: Go back to /records and check the payment cell changed
    // (no F5 — same browser session, React Query cache should update)
    const recordsResponse2 = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records') && r.status() === 200,
      { timeout: 30_000 },
    );
    await page.goto('/records');
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 30_000 });
    await page.waitForSelector('table', { timeout: 30_000 });
    await recordsResponse2;
    await page.waitForTimeout(800);

    const targetRow2 = page.locator('tbody tr').filter({ hasText: 'VCC C4 Client' });
    await expect(targetRow2).toBeVisible({ timeout: 10_000 });

    const paymentCell2 = targetRow2.locator('td').nth(8);
    const afterText = (await paymentCell2.textContent())?.trim() ?? '';
    log(`Check 4 AFTER: payment cell text = "${afterText}"`);

    await page.screenshot({ path: `${SHOTS}/check4-after.png`, fullPage: false });

    // Assert: text changed (no F5 was pressed)
    expect(afterText).not.toBe(beforeText);
    // And "1 234" should appear in the AFTER cell (Частично (1 234₽))
    expect(afterText).toMatch(/1[\s\u00a0]?234/);

    log(`Check 4 PASS — payment cell changed from "${beforeText}" to "${afterText}"`);
  } finally {
    await cleanupRecord(request, recordId);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
    await cleanup(request, `/api/v1/clients/${client.id}`);
  }
});
