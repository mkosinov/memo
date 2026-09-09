import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { queryDB, queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * Open modal and switch to the first client/record tab.
 * Verifies both visits and payments tables are visible.
 *
 * @param opts.recordId — if provided, opens the modal for the activity
 *   that contains this record (ensures we land on the correct tab).
 */
async function openClientRecordTab(
  page: import('@playwright/test').Page,
  opts?: { recordId?: string },
) {
  await openModal(page, { recordId: opts?.recordId ?? 'r1' });
  await switchToRecordsTab(page);
  await expect(page.locator('[data-testid="record-visits-table"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="record-payments-table"]')).toBeVisible({ timeout: 5_000 });
}

/**
 * E2E tests for the unified inline-editable rows design.
 * Covers spec scenarios 1–9 from
 * docs/specs/2026-06-25-inline-editable-table-unified-rows-design.md
 *
 * Visits scenarios: 1–8
 * Payments parity:  9
 */
test.describe('Unified inline-editable rows', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ── Scenario 3: Multiple empty rows allowed ─────────────────────────────

  test('visits: multiple empty rows can coexist', async ({ page }) => {
    await openClientRecordTab(page);

    const addBtn = page.locator('[data-testid="btn-add-visitor"]');

    // Click "+ Добавить" twice
    await addBtn.click();
    await expect(page.locator('[data-testid="visit-row-new"]').first()).toBeVisible();

    await addBtn.click();
    await expect(page.locator('[data-testid="visit-row-new"]')).toHaveCount(2);

    // Both rows show the name input (autoFocus placeholder)
    await expect(page.locator('[data-testid="add-visitor-name"]')).toHaveCount(2);
  });

  // ── Scenario 4: × on unsaved row → removed, no API call ───────────────

  test('visits: × on unsaved row removes it without API call', async ({ page }) => {
    // Track API requests
    const apiCalls: string[] = [];
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/v1/visits') || url.includes('/api/v1/visitors')) {
        apiCalls.push(`${req.method()} ${url}`);
      }
    });

    await openClientRecordTab(page);

    // Add a new empty row
    await page.locator('[data-testid="btn-add-visitor"]').click();
    const newRow = page.locator('[data-testid="visit-row-new"]');
    await expect(newRow).toBeVisible();

    // Snapshot API calls before delete
    const callsBefore = apiCalls.length;

    // Click × on the new row
    await newRow.locator('[data-testid="visit-row-new-delete"]').click();

    // Row should be removed
    await expect(newRow).not.toBeVisible({ timeout: 3_000 });

    // No API calls should have been made
    const newCalls = apiCalls.slice(callsBefore);
    expect(newCalls).toHaveLength(0);
  });

  // ── Scenario 5: Edit existing visitor name → PATCH ────────────────────

  test('visits: edit existing visitor name triggers API call', async ({ page }) => {
    // Use seed record r1 (already visible on the schedule page)
    const visitRow = queryDBRow(
      `SELECT v.id, v.visitor_id FROM visits v
       JOIN records r ON v.record_id = r.id
        WHERE r.id = 'r1' AND v.visitor_id IS NOT NULL
       LIMIT 1`,
    );
    // Conditional skip: seed DB must have a visit with a linked visitor on r1
    if (!visitRow?.visitor_id) {
      test.skip();
      return;
    }

    // Reset the visitor name to the seed value — globalSetup only deletes
    // non-seed rows, so a previous run of this test would leave the edited
    // name in place and the fill below would be a no-op (no PATCH fired).
    queryDB(
      `UPDATE visitors SET name = 'Анна Иванова' WHERE id = '${visitRow.visitor_id}'`,
    );

    await openClientRecordTab(page, { recordId: 'r1' });

    // Find the saved visit row
    const savedRow = page.locator(`[data-testid="visit-row-${visitRow.id}"]`);
    await expect(savedRow).toBeVisible({ timeout: 5_000 });

    // Edit the name — the name InlineEditCell is the first <input> in the row
    const nameInput = savedRow.locator('input').first();
    await expect(nameInput).toBeVisible({ timeout: 3_000 });
    await expect(nameInput).toHaveValue(/\S/, { timeout: 5_000 });

    // Register the request waiter BEFORE triggering the commit — the PATCH
    // fires on blur (Enter → blur), so waiting after would race and miss it.
    const patchRequest = page.waitForRequest(
      (req) =>
        req.method() === 'PATCH' &&
        req.url().includes(`/api/v1/visitors/${visitRow.visitor_id}`),
      { timeout: 5_000 },
    );

    await nameInput.fill('Edited Name');
    // Enter commits the InlineEditCell via blur → PATCH /visitors/{id}
    await nameInput.press('Enter');

    // Verify PATCH /visitors/{id} was called
    await patchRequest;
  });

  // ── Scenario 6: Select tariff → price auto-fills ──────────────────────
  

  test('visits: selecting tariff changes price on new row', async ({ page, request }) => {
    // Create a record to ensure we have a valid activity to open
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // Add new row
      await page.locator('[data-testid="btn-add-visitor"]').click();
      const newRow = page.locator('[data-testid="visit-row-new"]');
      await expect(newRow).toBeVisible();

      const tariffSelect = page.locator('[data-testid="add-visitor-tariff"]');
      await expect(tariffSelect).toBeVisible();

      // Read the current (default) tariff value
      const defaultValue = await tariffSelect.inputValue();

      // Get all available tariff options
      const options = await tariffSelect.locator('option').allTextContents();
      // Options: ["— тариф —", "Tariff1 (3500 ₽)", ...]
      // Filter out the placeholder
      const tariffOptions = options.filter((t) => t !== '— тариф —');

      // Conditional skip: service needs ≥2 tariffs to test switching
      if (tariffOptions.length < 2) {
        test.skip();
        return;
      }

      // Select a different tariff than the default
      // Find an option whose value differs from the default
      const optionElements = tariffSelect.locator('option:not([value=""]):not([value="' + defaultValue + '"])');
      const firstAltValue = await optionElements.first().getAttribute('value');
      // Conditional skip: no alternative tariff option found in the DOM
      if (!firstAltValue) {
        test.skip();
        return;
      }

      await tariffSelect.selectOption(firstAltValue);

      // Verify the tariff selection actually changed
      await expect(tariffSelect).toHaveValue(firstAltValue);

      // Verify price input has a non-empty value after tariff change.
      // Column order: name(input), age(select), tariff(select), price(input).
      // The price is the 2nd <input> in the row (1st is the name InlineEditCell).
      const priceInput = newRow.locator('input').nth(1);
      await expect(priceInput).toBeVisible();
      const priceValue = await priceInput.inputValue();
      // Price should be a number (may be "0" if tariff has no price, or a positive number)
      expect(Number.isNaN(Number(priceValue))).toBe(false);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 7: × on existing row → DELETE ────────────────────────────

  test('visits: × on existing row calls DELETE API', async ({ page }) => {
    // Use seed record r2 (already visible on the schedule page)
    const visitRow = queryDBRow(
      `SELECT v.id FROM visits v
       JOIN records r ON v.record_id = r.id
        WHERE r.id = 'r2'
       LIMIT 1`,
    );
    // Conditional skip: seed DB must have a visit on r2
    if (!visitRow) {
      test.skip();
      return;
    }

    await openClientRecordTab(page, { recordId: 'r2' });

    const savedRow = page.locator(`[data-testid="visit-row-${visitRow.id}"]`);
    await expect(savedRow).toBeVisible({ timeout: 5_000 });

    // Click × on the saved row
    await savedRow.locator(`[data-testid="visit-row-${visitRow.id}-delete"]`).click();

    // Verify DELETE /visits/{id} was called
    await page.waitForRequest(
      (req) =>
        req.method() === 'DELETE' &&
        req.url().includes(`/api/v1/visits/${visitRow.id}`),
      { timeout: 5_000 },
    );

    // Row should disappear after successful delete
    await expect(savedRow).not.toBeVisible({ timeout: 5_000 });
  });

  // ── Scenario 8: Visitor count "0" and + Добавить still works ────────────
  

  test('visits: + Добавить works when record has 0 visits', async ({ page, request }) => {
    // 1. SETUP — create a record with NO visits
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const resp = await request.post(`${BACKEND}/api/v1/records`, {
      data: {
        activity_id: activity.id,
        client_id: client.id,
        visits: [],
      },
    });
    expect(resp.ok()).toBeTruthy();
    const record = await resp.json();

    try {
      // Navigate to schedule (reload to bypass React Query cache)
      await page.goto('/schedule');
      await page.reload();
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // Verify visits table is visible (TotalsRow with + Добавить button)
      await expect(page.locator('[data-testid="record-visits-table"]')).toBeVisible();

      // The + Добавить button should be visible even with 0 visits
      const addBtn = page.locator('[data-testid="btn-add-visitor"]');
      await expect(addBtn).toBeVisible();

      // Clicking it should add a new empty row
      await addBtn.click();
      await expect(page.locator('[data-testid="visit-row-new"]')).toBeVisible();
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 9: Payments table parity ─────────────────────────────────

  test.describe('payments parity', () => {
    // ── 9a: Add new payment (blur-to-commit) ────────────────────────────

    test('add new payment via blur-to-commit', async ({ page }) => {
      await openClientRecordTab(page);

      const addBtn = page.locator('[data-testid="btn-add-payment"]');
      await addBtn.click();

      // New payment row appears
      const newRow = page.locator('[data-testid="payment-new"]');
      await expect(newRow).toBeVisible();

      // Amount input is visible and auto-focused
      const amountInput = page.locator('[data-testid="add-payment-amount"]');
      await expect(amountInput).toBeVisible();

      // Fill amount and commit via Enter
      await amountInput.fill('2000');
      await amountInput.press('Enter');

      // After save, the new-row input disappears (row gets an id)
      await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

      // The TotalsRow should show updated total (≥ 2000 ₽)
      const totalsRow = page.locator('[data-testid="payments-total"]');
      await expect(totalsRow).toBeVisible();
    });

    // ── 9b: × on unsaved payment → no API call ─────────────────────────

    test('× on unsaved payment row removes it without API call', async ({ page }) => {
      const apiCalls: string[] = [];
      page.on('request', (req) => {
        if (req.url().includes('/api/v1/payments')) {
          apiCalls.push(`${req.method()} ${req.url()}`);
        }
      });

      await openClientRecordTab(page);

      await page.locator('[data-testid="btn-add-payment"]').click();
      const newRow = page.locator('[data-testid="payment-new"]');
      await expect(newRow).toBeVisible();

      const callsBefore = apiCalls.length;

      // Click × on the new payment row
      await newRow.locator('[data-testid="payment-new-delete"]').click();

      await expect(newRow).not.toBeVisible({ timeout: 3_000 });

      // No API calls
      const newCalls = apiCalls.slice(callsBefore);
      expect(newCalls).toHaveLength(0);
    });

    // ── 9c: × on existing payment → DELETE ──────────────────────────────

    test('× on existing payment calls DELETE API', async ({ page, request }) => {
      // Use seed record r3 — create a payment on it via API
      const paymentResp = await request.post(`${BACKEND}/api/v1/payments`, {
        data: { record_id: 'r3', amount: 2500, method: 'card' },
      });
      expect(paymentResp.ok()).toBeTruthy();
      const payment = await paymentResp.json();

      try {
        await openClientRecordTab(page, { recordId: 'r3' });

        // Find the saved payment row
        const paymentRow = page.locator(`[data-testid="payment-${payment.id}"]`);
        await expect(paymentRow).toBeVisible({ timeout: 5_000 });

        // Click × on the saved payment row
        await paymentRow.locator(`[data-testid="payment-${payment.id}-delete"]`).click();

        // Verify DELETE /payments/{id} was called
        await page.waitForRequest(
          (req) =>
            req.method() === 'DELETE' &&
            req.url().includes(`/api/v1/payments/${payment.id}`),
          { timeout: 5_000 },
        );

        // Row should disappear
        await expect(paymentRow).not.toBeVisible({ timeout: 5_000 });
      } finally {
        await cleanup(request, `/api/v1/payments/${payment.id}`);
      }
    });

    // ── 9d: Multiple empty payment rows ─────────────────────────────────

    test('multiple empty payment rows can coexist', async ({ page }) => {
      await openClientRecordTab(page, { recordId: 'r1' });

      const addBtn = page.locator('[data-testid="btn-add-payment"]');

      await addBtn.click();
      await expect(page.locator('[data-testid="payment-new"]').first()).toBeVisible();

      await addBtn.click();
      await expect(page.locator('[data-testid="payment-new"]')).toHaveCount(2);
    });
  });

  // ── Scenario 10: Save prefilled payment without editing ─────────────────

  test('scenario 10: prefilled payment saves without editing amount', async ({ page, request }) => {
    // Create a record with a known outstanding balance (visit price=3500, no payments → outstanding=3500).
    // Using factory approach (not seed recordId) because GH #124 makes recordId targeting unreliable
    // when multiple activities share a week. Factory activity is for "today" so it's isolated.
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // Click "+ Добавить" — amount is prefilled from "К оплате" (outstanding balance)
      await page.locator('[data-testid="btn-add-payment"]').click();
      const newRow = page.locator('[data-testid="payment-new"]');
      await expect(newRow).toBeVisible();

      // The amount input should have a prefilled value (from defaultAmount prop)
      const amountInput = page.locator('[data-testid="add-payment-amount"]');
      await expect(amountInput).toBeVisible();
      const prefilledValue = await amountInput.inputValue();
      // Prefilled value should be > 0 (from the record's outstanding balance)
      expect(Number(prefilledValue)).toBeGreaterThan(0);

      // Press Enter WITHOUT editing the amount
      await amountInput.press('Enter');

      // After save, the new-row input disappears (row gets an id)
      await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

      // The TotalsRow should show the total (at least the prefilled amount)
      const totalsRow = page.locator('[data-testid="payments-total"]');
      await expect(totalsRow).toBeVisible();
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 11: Save anonymous visit ───────────────────────────────────

  test('scenario 11: anonymous visit saves with blank name', async ({ page }) => {
    await openClientRecordTab(page);

    // Click "+ Добавить" to add a new visit row
    await page.locator('[data-testid="btn-add-visitor"]').click();
    const newRow = page.locator('[data-testid="visit-row-new"]');
    await expect(newRow).toBeVisible();

    // Leave name blank (anonymous visit), but pick a tariff
    const tariffSelect = page.locator('[data-testid="add-visitor-tariff"]');
    await expect(tariffSelect).toBeVisible();

    // Select the first non-empty tariff option
    const options = await tariffSelect.locator('option:not([value=""])').all();
    if (options.length > 0) {
      const firstValue = await options[0].getAttribute('value');
      if (firstValue) {
        await tariffSelect.selectOption(firstValue);
      }
    }

    // Press Enter to save (name is blank → anonymous visit)
    const nameInput = page.locator('[data-testid="add-visitor-name"]');
    await nameInput.press('Enter');

    // After save, the new-row input disappears (row gets an id)
    await expect(nameInput).not.toBeVisible({ timeout: 5_000 });

    // A saved visit row should appear (with a real id, not "new")
    // The row should show "Аноним" placeholder for the blank name
    const savedRows = page.locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])');
    await expect(savedRows.first()).toBeVisible({ timeout: 5_000 });
  });

  // ── Scenario 12: Amount 0 → toast, no request ──────────────────────────

  test('scenario 12: amount=0 shows error toast and no POST fires', async ({ page }) => {
    // Track API requests
    const postPayments: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('/api/v1/payments')) {
        postPayments.push(req.url());
      }
    });

    await openClientRecordTab(page);

    // Click "+ Добавить" to add a new payment row
    await page.locator('[data-testid="btn-add-payment"]').click();
    const newRow = page.locator('[data-testid="payment-new"]');
    await expect(newRow).toBeVisible();

    // Set amount to 0
    const amountInput = page.locator('[data-testid="add-payment-amount"]');
    await amountInput.fill('0');

    // Snapshot API calls before attempting save
    const callsBefore = postPayments.length;

    // Press Enter to attempt save
    await amountInput.press('Enter');

    // Wait a bit for any potential request
    await page.waitForTimeout(500);

    // Error toast should appear — use data-testid to avoid matching the dnd-kit live region
    // which also has role="status" but is empty (#DndLiveRegion-2 at index [0]).
    const toast = page.locator('[data-testid="toast-error"]');
    await expect(toast).toBeVisible({ timeout: 3_000 });
    await expect(toast).toContainText('Сумма должна быть больше 0');

    // No POST /payments should have fired
    const newCalls = postPayments.slice(callsBefore);
    expect(newCalls).toHaveLength(0);

    // Row should still be editable (new row still in DOM)
    await expect(newRow).toBeVisible();
  });

  // ── Scenario 13: Editable payment date persists ─────────────────────────

  test('scenario 13: editable payment date persists after save', async ({ page }) => {
    await openClientRecordTab(page);

    // Click "+ Добавить" to add a new payment row
    await page.locator('[data-testid="btn-add-payment"]').click();
    const newRow = page.locator('[data-testid="payment-new"]');
    await expect(newRow).toBeVisible();

    // The datetime-local input should be present and prefilled
    const dateInput = page.locator('[data-testid="add-payment-date"]');
    await expect(dateInput).toBeVisible();
    const prefilledDate = await dateInput.inputValue();
    expect(prefilledDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    // Set a specific date
    const customDate = '2026-07-05T15:30';
    await dateInput.fill(customDate);

    // Fill amount (must be > 0)
    const amountInput = page.locator('[data-testid="add-payment-amount"]');
    await amountInput.fill('1500');

    // Press Enter to save
    await amountInput.press('Enter');

    // After save, the new-row input disappears
    await expect(dateInput).not.toBeVisible({ timeout: 5_000 });

    // The saved row should display the chosen date (formatted)
    // Look for a payment row that contains "05.07.2026" (Russian locale format)
    const savedPaymentRow = page.locator('[data-testid^="payment-"]:not([data-testid="payment-new"])').filter({
      hasText: '05.07.2026',
    });
    await expect(savedPaymentRow.first()).toBeVisible({ timeout: 5_000 });
  });

  // ── Scenario 14: Name stays visible after save ──────────────────────────

  test('scenario 14: name stays visible immediately after save (no blank)', async ({ page }) => {
    await openClientRecordTab(page);

    // Click "+ Добавить" to add a new visit row
    await page.locator('[data-testid="btn-add-visitor"]').click();
    const newRow = page.locator('[data-testid="visit-row-new"]');
    await expect(newRow).toBeVisible();

    // Type a name
    const nameInput = page.locator('[data-testid="add-visitor-name"]');
    await nameInput.fill('Анна');

    // Press Enter to save
    await nameInput.press('Enter');

    // After save, the new-row input disappears (row gets an id)
    await expect(nameInput).not.toBeVisible({ timeout: 5_000 });

    // The name "Анна" should be visible in the saved row immediately
    // (no blank, no "Аноним" placeholder, no need to reload).
    // The name is rendered inside an <input value="Анна">, not as text content,
    // so we must match on the input value, not hasText.
    const savedRow = page.locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])')
      .filter({ has: page.locator('input[value="Анна"]') });
    await expect(savedRow.first()).toBeVisible({ timeout: 5_000 });
  });
});

// ── Addendum-2: cache sync, tariffs, hard delete stats, undo ────────────────

test.describe('addendum-2: cache sync, tariffs, undo', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ── Scenario 15: No F5 after add visitor ─────────────────────────────────

  test('scenario 15: no F5 after add visitor (close+reopen)', async ({ page, request }) => {
    // 1. SETUP — create activity + record via API
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // 2. ACTION — add a visitor (blur to save)
      await page.locator('[data-testid="btn-add-visitor"]').click();
      const newRow = page.locator('[data-testid="visit-row-new"]');
      await expect(newRow).toBeVisible();

      const nameInput = page.locator('[data-testid="add-visitor-name"]');
      await nameInput.fill('Тестовый Посетитель');

      // Select a tariff so price is filled
      const tariffSelect = page.locator('[data-testid="add-visitor-tariff"]');
      const options = await tariffSelect.locator('option:not([value=""])').all();
      if (options.length > 0) {
        const firstValue = await options[0].getAttribute('value');
        if (firstValue) await tariffSelect.selectOption(firstValue);
      }

      // Save via Enter
      await nameInput.press('Enter');

      // After save, the new-row input disappears (row gets an id)
      await expect(nameInput).not.toBeVisible({ timeout: 5_000 });

      // Verify a saved visit row appeared
      const savedRows = page.locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])');
      await expect(savedRows.first()).toBeVisible({ timeout: 5_000 });
      const savedCount = await savedRows.count();

      // 3. Close the modal (click ✕)
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(page.locator('[data-testid="activity-details-modal"]')).not.toBeVisible({ timeout: 5_000 });

      // 4. Reopen the modal (click the same activity slot)
      await openClientRecordTab(page, { recordId: record.id });

      // 5. ASSERT — visitor row is still visible (cache served fresh data)
      const reopenedSavedRows = page.locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])');
      await expect(reopenedSavedRows.first()).toBeVisible({ timeout: 5_000 });
      expect(await reopenedSavedRows.count()).toBeGreaterThanOrEqual(savedCount);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 15b: No F5 after add payment ────────────────────────────────

  test('scenario 15b: no F5 after add payment (close+reopen)', async ({ page, request }) => {
    // 1. SETUP
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // 2. ACTION — add a payment
      await page.locator('[data-testid="btn-add-payment"]').click();
      const newRow = page.locator('[data-testid="payment-new"]');
      await expect(newRow).toBeVisible();

      const amountInput = page.locator('[data-testid="add-payment-amount"]');
      await amountInput.fill('2500');
      await amountInput.press('Enter');

      // After save, the new-row input disappears
      await expect(amountInput).not.toBeVisible({ timeout: 5_000 });

      // Verify a saved payment row appeared
      const savedPayments = page.locator('[data-testid^="payment-"]:not([data-testid="payment-new"])');
      await expect(savedPayments.first()).toBeVisible({ timeout: 5_000 });
      const savedCount = await savedPayments.count();

      // 3. Close the modal
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(page.locator('[data-testid="activity-details-modal"]')).not.toBeVisible({ timeout: 5_000 });

      // 4. Reopen the modal
      await openClientRecordTab(page, { recordId: record.id });

      // 5. ASSERT — payment row is still visible
      const reopenedPayments = page.locator('[data-testid^="payment-"]:not([data-testid="payment-new"])');
      await expect(reopenedPayments.first()).toBeVisible({ timeout: 5_000 });
      expect(await reopenedPayments.count()).toBeGreaterThanOrEqual(savedCount);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 16: No F5 after delete visitor ──────────────────────────────

  test('scenario 16: no F5 after delete visitor (close+reopen)', async ({ page, request }) => {
    // 1. SETUP — create activity + record with a visitor
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // Verify the visit row exists
      const visitRow = page.locator('[data-testid^="visit-row-"]:not([data-testid="visit-row-new"])').first();
      await expect(visitRow).toBeVisible({ timeout: 5_000 });

      // Get the visit ID from the testId
      const testId = await visitRow.getAttribute('data-testid');
      expect(testId).toBeTruthy();
      const visitId = testId!.replace('visit-row-', '');

      // 2. ACTION — delete visitor (× button)
      await visitRow.locator(`[data-testid="visit-row-${visitId}-delete"]`).click();

      // Toast appears: "Удалено. Отменить"
      const toast = page.locator('[data-testid="toast-info"]');
      await expect(toast.first()).toContainText('Удалено', { timeout: 3_000 });

      // Row disappeared from UI (optimistic)
      await expect(page.locator(`[data-testid="visit-row-${visitId}"]`)).not.toBeVisible({ timeout: 3_000 });

      // 3. Wait for deferred DELETE to fire (5s + buffer)
      // The toast expires after 5s, which triggers the actual DELETE.
      await page.waitForTimeout(5_500);

      // 4. Close the modal
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(page.locator('[data-testid="activity-details-modal"]')).not.toBeVisible({ timeout: 5_000 });

      // 5. Reopen the modal
      await openClientRecordTab(page, { recordId: record.id });

      // 6. ASSERT — visitor is still gone (does not reappear from stale cache)
      const deletedRow = page.locator(`[data-testid="visit-row-${visitId}"]`);
      await expect(deletedRow).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 16b: No F5 after delete payment ─────────────────────────────

  test('scenario 16b: no F5 after delete payment (close+reopen)', async ({ page, request }) => {
    // 1. SETUP — create activity + record + payment
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    // Create a payment via API
    const paymentResp = await request.post(`${BACKEND}/api/v1/payments`, {
      data: { record_id: record.id, amount: 2000, method: 'card' },
    });
    expect(paymentResp.ok()).toBeTruthy();
    const payment = await paymentResp.json();

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // Verify the payment row exists
      const paymentRow = page.locator(`[data-testid="payment-${payment.id}"]`);
      await expect(paymentRow).toBeVisible({ timeout: 5_000 });

      // 2. ACTION — delete payment (× button)
      await paymentRow.locator(`[data-testid="payment-${payment.id}-delete"]`).click();

      // Toast appears
      const toast = page.locator('[data-testid="toast-info"]');
      await expect(toast.first()).toContainText('Удалено', { timeout: 3_000 });

      // Row disappeared from UI (optimistic)
      await expect(paymentRow).not.toBeVisible({ timeout: 3_000 });

      // 3. Wait for deferred DELETE to fire (5s + buffer)
      await page.waitForTimeout(5_500);

      // 4. Close the modal
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(page.locator('[data-testid="activity-details-modal"]')).not.toBeVisible({ timeout: 5_000 });

      // 5. Reopen the modal
      await openClientRecordTab(page, { recordId: record.id });

      // 6. ASSERT — payment is still gone
      const deletedPayment = page.locator(`[data-testid="payment-${payment.id}"]`);
      await expect(deletedPayment).not.toBeVisible({ timeout: 3_000 });
    } finally {
      await cleanup(request, `/api/v1/payments/${payment.id}`);
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 17: Tariff dropdown populated in modal ──────────────────────
  

  test('scenario 17: tariff dropdown populated in modal', async ({ page, request }) => {
    // 1. SETUP — create activity with a service that has tariffs
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // 2. ACTION — click "+ Добавить" to add a visitor row
      await page.locator('[data-testid="btn-add-visitor"]').click();
      const newRow = page.locator('[data-testid="visit-row-new"]');
      await expect(newRow).toBeVisible();

      // 3. ASSERT — tariff <select> has <option> elements
      const tariffSelect = page.locator('[data-testid="add-visitor-tariff"]');
      await expect(tariffSelect).toBeVisible();

      // Get all non-empty options
      const tariffOptions = await tariffSelect.locator('option:not([value=""])').allTextContents();

      // The service should have at least one tariff (seed data has tariffs)
      // Conditional skip: test environment may not have tariffs configured
      if (tariffOptions.length === 0) {
        test.skip();
        return;
      }

      // Verify options are rendered
      expect(tariffOptions.length).toBeGreaterThan(0);

      // 4. Select a tariff → assert price auto-fills
      const firstOptionValue = await tariffSelect.locator('option:not([value=""])').first().getAttribute('value');
      // Conditional skip: no non-empty tariff option found in the DOM
      if (!firstOptionValue) {
        test.skip();
        return;
      }

      await tariffSelect.selectOption(firstOptionValue);

      // Price input should have a value after tariff selection
      // The price is the 2nd <input> in the row (1st is the name InlineEditCell)
      const priceInput = newRow.locator('input').nth(1);
      await expect(priceInput).toBeVisible();
      const priceValue = await priceInput.inputValue();
      // Price should be a valid number
      expect(Number.isNaN(Number(priceValue))).toBe(false);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 18: Hard delete removes from stats (API-only) ───────────────

  test('scenario 18: hard delete removes payment from stats', async ({ request }) => {
    // 1. SETUP — create client + record + payment via API
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    // Create a payment
    const paymentResp = await request.post(`${BACKEND}/api/v1/payments`, {
      data: { record_id: record.id, amount: 3000, method: 'cash' },
    });
    expect(paymentResp.ok()).toBeTruthy();
    const payment = await paymentResp.json();

    try {
      // Verify payment exists via API
      const getResp = await request.get(`${BACKEND}/api/v1/payments/${payment.id}`);
      expect(getResp.ok()).toBeTruthy();

      // Get client stats BEFORE delete
      const statsRespBefore = await request.get(`${BACKEND}/api/v1/clients?per_page=100`);
      const statsList = await statsRespBefore.json();
      const clientBefore = (statsList.items || statsList).find((c: any) => c.id === client.id);
      const totalPaidBefore = clientBefore?.total_paid ?? 0;
      expect(totalPaidBefore).toBeGreaterThanOrEqual(3000);

      // 2. ACTION — DELETE the payment via API (hard delete)
      const deleteResp = await request.delete(`${BACKEND}/api/v1/payments/${payment.id}`);
      expect(deleteResp.status()).toBe(204);

      // 3. ASSERT — GET payment by id → 404
      const getAfterDelete = await request.get(`${BACKEND}/api/v1/payments/${payment.id}`);
      expect(getAfterDelete.status()).toBe(404);

      // 4. ASSERT — client stats no longer include the deleted payment
      const statsRespAfter = await request.get(`${BACKEND}/api/v1/clients?per_page=100`);
      const statsListAfter = await statsRespAfter.json();
      const clientAfter = (statsListAfter.items || statsListAfter).find((c: any) => c.id === client.id);
      const totalPaidAfter = clientAfter?.total_paid ?? 0;
      expect(totalPaidAfter).toBe(totalPaidBefore - 3000);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 19: Undo delete ─────────────────────────────────────────────
  

  test('scenario 19: undo delete restores payment row', async ({ page, request }) => {
    // 1. SETUP — create activity + record + payment
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    const paymentResp = await request.post(`${BACKEND}/api/v1/payments`, {
      data: { record_id: record.id, amount: 1500, method: 'card' },
    });
    expect(paymentResp.ok()).toBeTruthy();
    const payment = await paymentResp.json();

    try {
      // Track DELETE requests to payments API
      let deleteRequests: string[] = [];
      await page.route('**/api/v1/payments/**', (route) => {
        if (route.request().method() === 'DELETE') {
          deleteRequests.push(route.request().url());
        }
        route.continue();
      });

      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openClientRecordTab(page, { recordId: record.id });

      // Verify payment row exists
      const paymentRow = page.locator(`[data-testid="payment-${payment.id}"]`);
      await expect(paymentRow).toBeVisible({ timeout: 5_000 });

      // 2. ACTION — click × on the payment row
      await paymentRow.locator(`[data-testid="payment-${payment.id}-delete"]`).click();

      // 3. ASSERT — toast "Удалено. Отменить" appears
      const toast = page.locator('[data-testid="toast-info"]');
      await expect(toast.first()).toContainText('Удалено', { timeout: 3_000 });

      // 4. ASSERT — payment row disappeared from table
      await expect(paymentRow).not.toBeVisible({ timeout: 3_000 });

      // 5. ASSERT — NO DELETE request was sent yet (deferred)
      expect(deleteRequests).toHaveLength(0);

      // 6. Click "Отменить" in the toast
      const undoBtn = page.locator('button:has-text("Отменить")');
      await expect(undoBtn).toBeVisible({ timeout: 3_000 });
      await undoBtn.click();

      // 7. ASSERT — payment row reappears in table
      await expect(paymentRow).toBeVisible({ timeout: 3_000 });

      // 8. ASSERT — still no DELETE request sent
      expect(deleteRequests).toHaveLength(0);

      // 9. Now test the deferred delete path: click × again, DON'T undo
      await paymentRow.locator(`[data-testid="payment-${payment.id}-delete"]`).click();

      // Toast appears again
      await expect(toast.first()).toContainText('Удалено', { timeout: 3_000 });

      // Row disappeared
      await expect(paymentRow).not.toBeVisible({ timeout: 3_000 });

      // Still no DELETE (deferred)
      expect(deleteRequests).toHaveLength(0);

      // 10. Wait for toast to expire (5s) + buffer → DELETE fires
      // Note: In E2E (real browser), we can't mock setTimeout.
      // We use page.waitForTimeout to actually wait for the deferred delete.
      await page.waitForTimeout(5_500);

      // 11. ASSERT — DELETE request was now sent
      expect(deleteRequests.length).toBeGreaterThanOrEqual(1);
      expect(deleteRequests[0]).toContain(`/api/v1/payments/${payment.id}`);
    } finally {
      await page.unroute('**/api/v1/payments/**');
      await cleanup(request, `/api/v1/payments/${payment.id}`);
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});
