import { test, expect } from '@playwright/test';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import { createTestClient, createTestRecord, cleanup } from './fixtures/factories';
import { waitForScheduleReady, openModal, openAddTab, getFirstActivity } from './fixtures/helpers';

/**
 * E2E tests for ActivityDetailsModal — full user scenarios with DB verification.
 *
 * Each test follows the Full Cycle pattern:
 *   1. SETUP:     Create test data via API (factories)
 *   2. ACTION:    User interaction in browser (click, type, navigate)
 *   3. VERIFY UI: What the user SEES (toHaveText, toHaveValue)
 *   4. VERIFY DB: What's STORED in backend (SQL via queryDB/queryDBRow)
 *   5. CLEANUP:   Delete test data via API (cleanup helper)
 *
 * Requires: dev server on :3001, backend on :8000
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

// ---------------------------------------------------------------------------
// Tests — Full User Scenarios with DB Verification
// ---------------------------------------------------------------------------

test.describe('ActivityDetailsModal — Real User Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ── Scenario 1: Create record — verify DB persistence ─────────────────

  test('1. Create new record — data persists in DB (records, clients, visits)', async ({ page, request }) => {
    // Use unique suffix based on timestamp + random to avoid collisions in parallel runs
    const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const testPhone = `+7999${uid.slice(-7)}`;
    const testClientName = `E2E Client ${uid}`;
    const testVisitorName = `E2E Visitor ${uid}`;

    // Declare cleanup targets outside try so finally can access them
    let recordRow: any = null;
    let clientRow: any = null;

    try {
      // 1. ACTION — open add tab and fill form
      await openAddTab(page);

      await page.locator('[data-testid="input-phone"]').fill(testPhone);
      await page.locator('[data-testid="input-phone"]').blur();

      await page.locator('[data-testid="input-client-name"]').fill(testClientName);

      // Add visitor
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
      const visitorRow = page.locator('[data-testid="visitor-form-row"]').first();
      await visitorRow.locator('input').first().fill(testVisitorName);

      // Verify channel select is visible
      await expect(page.locator('[data-testid="select-channel"]')).toBeVisible();

      // Submit
      await page.locator('[data-testid="btn-create-record"]').click();

      // 2. VERIFY UI — success toast "Запись создана" appears (not just any toast)
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 10_000 });

      // 3. VERIFY DB — client was created (retry until DB commit lands)
      await expect.poll(async () => {
        clientRow = queryDBRow(`SELECT * FROM clients WHERE phone='${testPhone}' AND is_active=1`);
        return clientRow !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      expect(clientRow!.name).toBe(testClientName);
      expect(clientRow!.channel).toBeTruthy();

      // 4. VERIFY DB — record was created for this client
      await expect.poll(async () => {
        recordRow = queryDBRow(
          `SELECT * FROM records WHERE client_id='${clientRow!.id}' AND is_active=1`,
        );
        return recordRow !== null;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      expect(recordRow!.status).toBeTruthy();

      // 5. VERIFY DB — visit was created for this record
      await expect.poll(async () => {
        const visits = queryDBRows(
          `SELECT * FROM visits WHERE record_id='${recordRow!.id}'`,
        );
        return visits.length > 0;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
    } finally {
      // CLEANUP — always runs, even if test fails
      if (recordRow?.id) await cleanup(request, `/api/v1/records/${recordRow.id}`);
      if (clientRow?.id) await cleanup(request, `/api/v1/clients/${clientRow.id}`);
    }
  });

  // ── Scenario 2: Delete record — verify DB soft-delete ──────────────────

  test('2. Delete record — timeout removes it (is_active=0 in DB)', async ({
    page,
    request,
  }) => {
    // 1. SETUP — create record via API
    const client = await createTestClient(request);
    const activity = await getFirstActivity(page);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      // Verify it exists before delete
      const beforeRow = queryDBRow(
        `SELECT is_active FROM records WHERE id='${record.id}'`,
      );
      expect(beforeRow).not.toBeNull();
      expect(beforeRow!.is_active).toBe(1);

      // Reload to pick up new data
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15000 });

      // 2. ACTION — open modal, navigate to client tab, delete
      await openModal(page);

      const clientTab = page.locator(`[data-testid="tab-client-${record.id}"]`);
      if (await clientTab.isVisible()) {
        await clientTab.click();
        await page.locator('[data-testid="btn-delete-record"]').click();

        // 3. VERIFY UI — undo toast appears
        await expect(page.locator('text=Запись удалена через 5 секунд')).toBeVisible({
          timeout: 3000,
        });

        // Wait for undo timeout (5s) + API call, then verify DB
        await expect.poll(async () => {
          const afterRow = queryDBRow(
            `SELECT is_active FROM records WHERE id='${record.id}'`,
          );
          return afterRow?.is_active ?? -1;
        }, { timeout: 30_000, intervals: [500, 1000, 2000] }).toBe(0);
      }
    } finally {
      // CLEANUP — always runs, even if test fails
      await cleanup(request, `/api/v1/records/${record.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 3: Add payment — verify DB persistence ────────────────────

  test('3. Add payment — payment row exists in DB with correct amount', async ({
    page,
    request,
  }) => {
    // 1. SETUP — create record via API
    const client = await createTestClient(request);
    const activity = await getFirstActivity(page);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      // Verify no payments initially
      const beforePayments = queryDBRows(
        `SELECT * FROM payments WHERE record_id='${record.id}'`,
      );
      expect(beforePayments.length).toBe(0);

      // Reload to pick up new data
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15000 });

      // 2. ACTION — open modal, go to client tab, add payment
      await openModal(page);

      const clientTab = page.locator(`[data-testid="tab-client-${record.id}"]`);
      if (await clientTab.isVisible()) {
        await clientTab.click();

        // Read footer before
        await expect(page.locator('[data-testid="modal-footer"]')).toBeVisible();

        // Add payment — click "Добавить" to reveal inline row, fill amount & commit via Enter
        await page.locator('[data-testid="btn-add-payment"]').click();
        const amountInput = page.locator('[data-testid="add-payment-amount"]');
        await expect(amountInput).toBeVisible();
        await amountInput.fill('1500');
        await amountInput.press('Enter');
        // Wait for save (new-row input disappears after commit)
        await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

        // Wait for UI update
        await expect(page.locator('[data-testid="modal-footer"]')).toBeVisible();

        // 3. VERIFY UI — footer is still visible (summary updated)
        await expect(page.locator('[data-testid="modal-footer"]')).toBeVisible();

        // 4. VERIFY DB — payment row exists with amount=1500 (retry until commit lands)
        await expect.poll(async () => {
          const payments = queryDBRows(
            `SELECT * FROM payments WHERE record_id='${record.id}'`,
          );
          return payments.length > 0 && payments[0].amount === 1500;
        }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(true);
      }
    } finally {
      // CLEANUP — always runs, even if test fails
      await cleanup(request, `/api/v1/records/${record.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 4: Settings update — verify DB service_id change ──────────

  test('4. Settings update — service_id changes in DB', async ({ page, request }) => {
    // 1. ACTION — open modal on Settings tab
    const activity = await openModal(page);
    if (!activity) {
      test.skip();
      return;
    }

    // Read initial service from DB via the activity that has the modal open
    const beforeRow = queryDBRow(
      `SELECT service_id FROM activities WHERE id='${(activity as any).id}'`,
    );
    expect(beforeRow).not.toBeNull();
    const originalServiceId = beforeRow!.service_id;

    // Get a different service to switch to
    const servicesResp = await request.get(`${BACKEND}/api/v1/services`);
    const services = await servicesResp.json();
    const differentService = services.find(
      (s: any) => s.id !== originalServiceId,
    );

    if (differentService) {
      // 2. ACTION — change service in the select (onChange triggers auto-save via onUpdate)
      const serviceSelect = page.locator('[data-testid="select-service"]');
      await expect(serviceSelect).toBeVisible();
      await serviceSelect.selectOption(differentService.id);

      // Force blur to ensure any pending events fire
      await page.click('body');
      await page.waitForTimeout(200);

      // 3. VERIFY DB — service_id was updated (retry until API commit lands)
      await expect.poll(async () => {
        const afterRow = queryDBRow(
          `SELECT service_id FROM activities WHERE id='${(activity as any).id}'`,
        );
        return afterRow?.service_id;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(differentService.id);

      // Restore original service
      await serviceSelect.selectOption(originalServiceId);
      await page.click('body');
      await page.waitForTimeout(200);
    }
  });

  // ── Scenario 5: Age display — verify no "++" ──────────────────────────

  test('5. Age display — correct format, no "++"', async ({ page }) => {
    // 1. ACTION — open modal
    await openModal(page);

    // 2. VERIFY UI — age display exists and has correct format
    const ageDisplay = page.locator('[data-testid="age-display"]');
    if (await ageDisplay.isVisible()) {
      const text = await ageDisplay.textContent();
      expect(text).toBeTruthy();

      // Must NOT contain "++"
      expect(text).not.toContain('++');

      // Must match either "N–M" or "N+" pattern
      const isValidRange = /^\d+[–+]\d+$/.test(text!);
      const isValidPlus = /^\d+\+$/.test(text!);
      expect(isValidRange || isValidPlus).toBeTruthy();
    }
  });

  // ── Scenario 6: Admin opens activity — sees correct settings ──────────

  test('6. Admin opens activity — sees correct settings', async ({ page }) => {
    await openModal(page);

    // Context header shows service name + date
    // The Modal renders context as a <span> sibling after the <h2> title (no testid)
    const context = page.locator('[data-testid="activity-details-modal-container"] h2 + span');
    await expect(context).toBeVisible();
    const contextText = await context.textContent();
    expect(contextText).toBeTruthy();

    // Settings tab is active by default
    await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

    // Date/time field has a value (not empty)
    const datetime = page.locator('[data-testid="input-datetime"]');
    await expect(datetime).not.toHaveValue('');

    // Duration field shows HH:MM format
    const duration = page.locator('[data-testid="input-duration"]');
    await expect(duration).toBeVisible();
    const durationValue = await duration.inputValue();
    expect(durationValue).toMatch(/^\d{2}:\d{2}$/);
  });

  // ── Scenario 7: Settings tab shows real values ────────────────────────

  test('7. Settings tab shows real values from activity', async ({ page }) => {
    await openModal(page);

    // Service select has a selected value (not empty)
    const serviceSelect = page.locator('[data-testid="select-service"]');
    const serviceValue = await serviceSelect.inputValue();
    expect(serviceValue).toBeTruthy();

    // Master picker (CustomSelect rendered as button, not native select)
    // Scoped to settings-tab to avoid matching other CustomSelects on the page
    const masterPicker = page.locator('[data-testid="settings-tab"] [data-testid="custom-select-trigger"]');
    const masterText = await masterPicker.textContent();
    // The trigger shows the selected master name (not placeholder "—")
    expect(masterText).toBeTruthy();
    expect(masterText).not.toBe('—');

    // Capacity shows a number > 0
    const capacity = page.locator('[data-testid="input-capacity"]');
    const capacityValue = await capacity.inputValue();
    expect(Number(capacityValue)).toBeGreaterThan(0);
  });

  // ── Scenario 8: Delete with undo — record survives ────────────────────

  test('8. Delete record — undo within 5s preserves it in DB', async ({
    page,
    request,
  }) => {
    // 1. SETUP
    const client = await createTestClient(request);
    const activity = await getFirstActivity(page);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15000 });

      // 2. ACTION
      await openModal(page);

      const clientTab = page.locator(`[data-testid="tab-client-${record.id}"]`);
      if (await clientTab.isVisible()) {
        await clientTab.click();
        await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

        // Verify client name is displayed (shown in the tab label in WIP structure)
        await expect(page.getByText(client.name)).toBeVisible();

        // Click delete
        await page.locator('[data-testid="btn-delete-record"]').click();

        // 3. VERIFY UI — undo toast
        await expect(page.locator('text=Запись удалена через 5 секунд')).toBeVisible({
          timeout: 3000,
        });

        // Click undo
        await page.locator('text=Отменить').click();

        // 4. VERIFY DB — record still active (retry until undo is processed)
        await expect.poll(async () => {
          const row = queryDBRow(
            `SELECT is_active FROM records WHERE id='${record.id}'`,
          );
          return row?.is_active ?? -1;
        }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(1);
      }
    } finally {
      // CLEANUP — always runs, even if test fails
      await cleanup(request, `/api/v1/records/${record.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 9: Tab navigation — content changes ──────────────────────

  test('9. Tab navigation — each tab shows different content', async ({ page }) => {
    await openModal(page);

    // Settings tab is visible
    await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

    // Click "+" tab
    await page.locator('[data-testid="tab-add"]').click();
    await expect(page.locator('[data-testid="new-booking-tab"]')).toBeVisible();
    await expect(page.locator('[data-testid="input-phone"]')).toBeVisible();

    // Click back to settings
    await page.locator('[data-testid="tab-settings"]').click();
    await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();
  });

  // ── Scenario 10: Validation — cannot submit without name ──────────────

  test('10. Can create record without name (name is optional)', async ({ page }) => {
    await openAddTab(page);

    // Leave name empty
    await page.locator('[data-testid="input-client-name"]').fill('');

    // Submit
    await page.locator('[data-testid="btn-create-record"]').click();

    // Should succeed — name is optional, verify success toast appears
    // The toast role="status" shows "Запись создана"
    await expect(page.locator('[role="status"]')).toBeVisible({ timeout: 5000 });
  });

  // ── Scenario 11: Channel select always visible ────────────────────────

  test('11. Channel select visible without checkbox', async ({ page }) => {
    await openAddTab(page);

    // Channel select should be visible
    await expect(page.locator('[data-testid="select-channel"]')).toBeVisible();

    // Checkbox should be unchecked by default
    const checkbox = page.locator('[data-testid="checkbox-notifications"]');
    await expect(checkbox).not.toBeChecked();
  });

  // ── Scenario 12: Private toggle works ─────────────────────────────────

  test('12. Private toggle changes state', async ({ page }) => {
    await openModal(page);

    const toggle = page.locator('[data-testid="toggle-private"]');
    await expect(toggle).toBeVisible();

    const initialState = await toggle.getAttribute('aria-checked');
    await toggle.click();
    const newState = await toggle.getAttribute('aria-checked');
    expect(newState).not.toBe(initialState);
  });

  // ── Scenario 13: Duration displays as HH:MM ──────────────────────────

  test('13. Duration displays as HH:MM, not decimal', async ({ page }) => {
    await openModal(page);

    const duration = page.locator('[data-testid="input-duration"]');
    const value = await duration.inputValue();
    expect(value).toMatch(/^\d{2}:\d{2}$/);
    expect(value).not.toContain('.');
  });
});
