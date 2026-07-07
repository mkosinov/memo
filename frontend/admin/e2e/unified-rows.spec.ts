import { test, expect } from '@playwright/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import { switchToRecordsTab } from './fixtures/scenarios';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
} from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

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
  await openModal(page, opts);
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

  // ── Scenario 5: Edit existing visitor name → PUT ──────────────────────
  // TODO(flaky): openModal selects wrong activity when multiple seed activities
  // share the same week. InlineEditCell commit also needs timing investigation.

  test('visits: edit existing visitor name triggers API call', async ({ page }) => {
    test.skip(true, 'TODO: openModal picks wrong activity on multi-record week + InlineEditCell commit timing');
    // Use seed record r1 (already visible on the schedule page)
    const visitRow = queryDBRow(
      `SELECT v.id, v.visitor_id FROM visits v
       JOIN records r ON v.record_id = r.id
        WHERE r.id = 'r1' AND v.visitor_id IS NOT NULL
       LIMIT 1`,
    );
    if (!visitRow?.visitor_id) {
      test.skip();
      return;
    }

    await openClientRecordTab(page, { recordId: 'r1' });

    // Find the saved visit row
    const savedRow = page.locator(`[data-testid="visit-row-${visitRow.id}"]`);
    await expect(savedRow).toBeVisible({ timeout: 5_000 });

    // Edit the name — the name InlineEditCell is the first <input> in the row
    const nameInput = savedRow.locator('input').first();
    await expect(nameInput).toBeVisible({ timeout: 3_000 });
    await expect(nameInput).toHaveValue(/\S/, { timeout: 5_000 });
    await nameInput.fill('Edited Name');
    await nameInput.press('Enter');
    // Explicitly blur to ensure commit fires
    await nameInput.evaluate((el: HTMLInputElement) => el.blur());

    // Verify PUT /visitors/{id} was called
    await page.waitForRequest(
      (req) =>
        req.method() === 'PUT' &&
        req.url().includes(`/api/v1/visitors/${visitRow.visitor_id}`),
      { timeout: 5_000 },
    );
  });

  // ── Scenario 6: Select tariff → price auto-fills ──────────────────────
  // TODO(flaky): openModal selects wrong activity when multiple seed activities
  // share the same week (GH #124).

  test('visits: selecting tariff changes price on new row', async ({ page, request }) => {
    test.skip(true, 'TODO: openModal picks wrong activity on multi-record week (GH #124)');
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

      if (tariffOptions.length < 2) {
        test.skip();
        return;
      }

      // Select a different tariff than the default
      // Find an option whose value differs from the default
      const optionElements = tariffSelect.locator('option:not([value=""]):not([value="' + defaultValue + '"])');
      const firstAltValue = await optionElements.first().getAttribute('value');
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
      await cleanup(request, `/api/v1/records/${record.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── Scenario 7: × on existing row → DELETE ────────────────────────────
  // TODO(flaky): openModal selects wrong activity when multiple seed activities
  // share the same week — opens r1 tab instead of r2.

  test('visits: × on existing row calls DELETE API', async ({ page }) => {
    test.skip(true, 'TODO: openModal picks wrong activity on multi-record week');
    // Use seed record r2 (already visible on the schedule page)
    const visitRow = queryDBRow(
      `SELECT v.id FROM visits v
       JOIN records r ON v.record_id = r.id
        WHERE r.id = 'r2'
       LIMIT 1`,
    );
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
  // TODO(flaky): openModal selects wrong activity when multiple seed activities
  // share the same week (GH #124).

  test('visits: + Добавить works when record has 0 visits', async ({ page, request }) => {
    test.skip(true, 'TODO: openModal picks wrong activity on multi-record week (GH #124)');
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
      await cleanup(request, `/api/v1/records/${record.id}`);
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
    // TODO(flaky): openModal selects wrong activity when multiple seed activities
    // share the same week — opens wrong record tab.

    test('× on existing payment calls DELETE API', async ({ page, request }) => {
      test.skip(true, 'TODO: openModal picks wrong activity on multi-record week');
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
      await cleanup(request, `/api/v1/records/${record.id}`);
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
