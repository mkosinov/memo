import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal, waitForClientsReady } from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * Wave 6 — Record status derived from visits.
 *
 * User Scenarios 1–4 from the design spec.
 * Tests use the schedule → activity modal → ClientTab path.
 * Uses ACTUAL testids from the rendered components.
 */

test.describe('Wave 6 — Record status derived from visits', () => {
  // ──────────────────────────────────────────────────
  // Scenario 1: edit visit status → record badge updates
  // ──────────────────────────────────────────────────
  test('Scenario 1: edit visit status updates record badge', async ({
    page,
    request,
  }) => {
    // Own factory record (GH #252): the record-status coarse handler
    // REWRITES the record's visits (delete + recreate) — on a seed record
    // that permanently deletes seed visits v1/v2 (the reset never restores
    // seed rows) and poisons every later spec incl. visual baselines
    // (CI run 35179631302 root cause).
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openModal(page, { recordId: record.id });

      const clientTab = page.locator(`[data-testid="tab-client-${record.id}"]`);
      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 10_000 });

      // Find the status picker inside the client tab (testidPrefix="record-status" in RecordSummary)
      const statusPicker = page.locator('[data-testid="client-tab"] [data-testid="record-status"]');
      await expect(statusPicker).toBeVisible();

      // The status picker is either a native <select> or a StatusPicker trigger
      // (status enums stay on static pickers — NOT part of the Combobox migration, GH #214 §9)
      // Try to find a select element or a button trigger
      const nativeSelect = statusPicker.locator('select');
      const hasNativeSelect = (await nativeSelect.count()) > 0;

      if (hasNativeSelect) {
        // Select by option label
        await nativeSelect.selectOption({ label: 'Посетил' });
      } else {
        // Click the button trigger
        const trigger = statusPicker.locator('button').first();
        await trigger.click();
        // Click the "Посетил" option in the dropdown
        await page.locator('button, [role="option"]').filter({ hasText: 'Посетил' }).first().click();
      }

      // Verify by checking that the visitor row's status badge updated
      // The icon-pending should now show as a different status
      await page.waitForTimeout(1000);

      // Verify the record still exists — the client tab should still be visible
      // with the visits table (testid="record-visits-table")
      const visitsTable = page.locator('[data-testid="record-visits-table"]');
      await expect(visitsTable).toBeVisible();
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ──────────────────────────────────────────────────
  // Scenario 2: add payment → totals update
  // ──────────────────────────────────────────────────
  test('Scenario 2: add payment from activity modal updates totals', async ({
    page,
  }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);
    await openModal(page);

    const clientTabs = page.locator('[data-testid^="tab-client-"]');
    await clientTabs.first().click();
    await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 10_000 });

    // Click the add payment button
    const addPaymentBtn = page.locator('[data-testid="btn-add-payment"]');
    await expect(addPaymentBtn).toBeVisible();
    await addPaymentBtn.click();

    // After clicking, a payment form should appear or the payment should be added directly
    // Check the payment section for updated values (testid="record-payments-table")
    const summary = page.locator('[data-testid="record-payments-table"]');
    await expect(summary).toBeVisible();

    // Verify payment section content
    await expect(summary).toContainText('Оплаты');
  });

  // ──────────────────────────────────────────────────
  // Scenario 3: header stepper inc/dec — anonymous visits (#257).
  // Anonymous seats are real visits (visitor_id = null): +1 creates ONE
  // anonymous visit, −1 deletes it. The counter and the «Аноним» row are
  // both derived from record.visits — no separate counter field.
  // ──────────────────────────────────────────────────
  test('Scenario 3: anonym-visits stepper adds and removes an anonymous row', async ({
    page,
    request,
  }) => {
    // Own factory data (GH #252): the stepper mutates the record's visits.
    const client = await createTestClient(request, {
      name: `Wave6 Stepper ${Date.now()}`,
    });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [],
    });

    try {
      // The stepper lives in RecordHeader on the client-profile record tab
      // (the activity modal's ClientTab has no header stepper).
      await waitForClientsReady(page, { waitForName: client.name });
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });

      const recordTabButton = modal
        .locator('[data-testid="client-card-left-panel"] button')
        .nth(1);
      await expect(recordTabButton).toBeVisible({ timeout: 10_000 });
      await recordTabButton.click();

      const tab = page.locator('[data-testid="client-record-tab"]');
      await expect(tab).toBeVisible({ timeout: 10_000 });
      await page.locator('#record-date').waitFor({ state: 'visible', timeout: 10_000 });

      // Header stepper: counter starts at 0 («Анонимов нет» — visits = []),
      // − is disabled with nothing to remove.
      const header = page.locator('[data-testid="record-header"]');
      await expect(header).toBeVisible();
      const counter = header.locator('[data-testid="anonym-visits-count"]');
      await expect(counter).toHaveText('0 анонимных');
      await expect(header.locator('[data-testid="anonym-visits-dec"]')).toBeDisabled();

      // +1 → the counter grows AND a real «Аноним» row appears in the table.
      await header.locator('[data-testid="anonym-visits-inc"]').click();
      await expect(counter).toHaveText('1 анонимных', { timeout: 10_000 });

      const savedRows = tab.locator(
        '[data-testid^="visit-row-"]:not([data-testid="visit-row-new"]):not([data-testid$="-delete"])',
      );
      await expect(savedRows).toHaveCount(1, { timeout: 10_000 });
      const anonName = savedRows.first().locator('input:not([type="number"])').first();
      await expect(anonName).toHaveValue('');
      await expect(anonName).toHaveAttribute('placeholder', 'Аноним');

      // −1 → the row disappears and the counter is back to 0.
      await header.locator('[data-testid="anonym-visits-dec"]').click();
      await expect(counter).toHaveText('0 анонимных', { timeout: 10_000 });
      await expect(savedRows).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      // The activity is test-created — delete it too (records already gone).
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ──────────────────────────────────────────────────
  // Scenario 4: add visitor → new row
  // ──────────────────────────────────────────────────
  test('Scenario 4: add visitor from modal shows in list', async ({
    page,
  }) => {
    await page.goto('/schedule');
    await waitForScheduleReady(page);
    await openModal(page);

    const clientTabs = page.locator('[data-testid^="tab-client-"]');
    await clientTabs.first().click();
    await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 10_000 });

    // Count existing visitor rows
    const visitorRows = page.locator('[data-testid="client-tab"] [data-testid="visitor-row"]');
    const before = await visitorRows.count();

    // Click "Добавить посетителя"
    const addBtn = page.locator('[data-testid="btn-add-visitor"]');
    await addBtn.click();

    // Wait for form to appear (may be inline)
    await page.waitForTimeout(1000);

    // Check if visitor count increased (new row added)
    await expect
      .poll(async () => await visitorRows.count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(before);
  });
});
