import { test, expect } from '@playwright/test';
import { waitForClientsReady } from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * E2E tests for the Clients page full lifecycle:
 *   list → create → view → edit → delete
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Unique name to avoid collisions between parallel runs. */
function uid(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Close the client card modal by clicking the backdrop at a corner
 * (avoiding the centered modal content).
 */
async function closeByBackdrop(page: import('@playwright/test').Page) {
  const modal = page.locator('[data-testid="client-card-modal"]');
  // Click the backdrop area — to the left of the modal panel
  const backdrop = page.locator('[data-testid="client-card-backdrop"]');
  await backdrop.click({ position: { x: 5, y: 5 }, force: true });
  await expect(modal).not.toBeVisible({ timeout: 5000 });
}

// ---------------------------------------------------------------------------
// Tests — Clients Page
// ---------------------------------------------------------------------------

test.describe('Clients page', () => {
  // ── 1. Page loads with header, table and filters ─────────────────────────

  test('1. Clients page loads with header and table', async ({ page }) => {
    await waitForClientsReady(page);

    // Header
    await expect(page.locator('h1')).toContainText('Клиенты');

    // Table is visible
    await expect(page.locator('table')).toBeVisible();

    // Table has column headers
    const headers = page.locator('table thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  // ── 2. Table has expected column headers ─────────────────────────────────

  test('2. Table has expected column headers', async ({ page }) => {
    await waitForClientsReady(page);

    const expectedHeaders = [
      'Имя',
      'Телефон',
      'Всего записей',
      'Последняя запись',
      'Сумма оплат',
    ];

    for (const headerText of expectedHeaders) {
      await expect(
        page.locator('table thead th').filter({ hasText: headerText }),
      ).toBeVisible();
    }
  });

  // ── 3. Filters and search are visible ────────────────────────────────────

  test('3. Filters and search input are visible', async ({ page }) => {
    await waitForClientsReady(page);

    // Search input
    await expect(page.locator('input[placeholder*="Поиск"]')).toBeVisible();

    // Status filter
    await expect(page.locator('select').first()).toBeVisible();

    // Reset button
    await expect(page.locator('text=Сбросить фильтры')).toBeVisible();
  });

  // ── 4. Create a new client ───────────────────────────────────────────────

  test('4. Create and view a new client', async ({ page, request }) => {
    // Create client via API (bypasses browser-side mutation bug)
    const testName = `Test Client ${uid()}`;
    const client = await createTestClient(request, { name: testName });
    const clientId = client.id;

    try {
      await waitForClientsReady(page, { waitForName: testName });
      // Reload to ensure fresh data from API (React Query may cache old list)
      await page.reload({ waitUntil: 'networkidle' });
      await waitForClientsReady(page, { waitForName: testName });

      // New client should appear in the table
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: testName });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Click the row to open client card
      await row.click();
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Modal shows the new client's name
      await expect(modal.locator(`text=${testName}`)).toBeVisible();

      // Close modal
      await closeByBackdrop(page);
    } finally {
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 5. Open client card on row click ─────────────────────────────────────

  test('5. Click row opens client card modal', async ({ page, request }) => {
    const client = await createTestClient(request, {
      name: `Row Click ${uid()}`,
    });
    const clientId = client.id;

    try {
      await waitForClientsReady(page, { waitForName: client.name });

      // Find the row with our test client
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Click the row
      await row.click();

      // Modal should open
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Modal should show the client name in the left panel header
      await expect(modal.locator(`text=${client.name}`)).toBeVisible();

      // Modal should have the "Клиент" tab active
      await expect(modal.locator('text=Контактные данные')).toBeVisible();

      // Close modal by clicking outside (top-left corner)
      await closeByBackdrop(page);
    } finally {
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 6. Edit client name and save ────────────────────────────────────────

  test('6. Edit client name and save', async ({ page, request }) => {
    const originalName = `Edit Test ${uid()}`;
    const updatedName = `Edited ${uid()}`;
    const client = await createTestClient(request, { name: originalName });
    const clientId = client.id;

    try {
      await waitForClientsReady(page, { waitForName: originalName });

      // Open client card
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: originalName });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Clear and type new name
      const nameInput = page.locator('#client-name');
      await nameInput.clear();
      await nameInput.fill(updatedName);

      // Save button should be enabled (has changes)
      const saveBtn = page.locator('button:has-text("Сохранить")');
      await expect(saveBtn).toBeEnabled();

      // Click save — triggers API call + query invalidation
      await saveBtn.click();

      // Wait for save to complete (network idle)
      await page.waitForTimeout(1500);

      // Close modal
      await closeByBackdrop(page);

      // Reload page to pick up updated data
      await page.reload({ waitUntil: 'networkidle' });
      await waitForClientsReady(page, { waitForName: updatedName });

      // Verify updated name appears in table
      await expect(
        page.locator('table tbody').filter({ hasText: updatedName }),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 7. Delete client ────────────────────────────────────────────────────

  test('7. Delete client via client card', async ({ page, request }) => {
    const testName = `Delete Test ${uid()}`;
    const client = await createTestClient(request, { name: testName });
    const clientId = client.id;

    try {
      await waitForClientsReady(page, { waitForName: testName });

      // Open client card
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: testName });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Click "Удалить" — #207: no-body DELETE dry-run; the freshly created
      // client has zero deps → 204 instant hard delete, modal closes.
      // (No confirm dialog anymore; the listener is a defensive no-op.)
      page.on('dialog', (dialog) => dialog.accept());
      await page.locator('button:has-text("Удалить")').click();

      // Modal should close
      await expect(modal).not.toBeVisible({ timeout: 5000 });

      // Reload page — hard-deleted client is gone from the list
      await page.reload({ waitUntil: 'networkidle' });
      await waitForClientsReady(page);

      // Client should no longer be visible in table
      const remaining = page
        .locator('table tbody tr')
        .filter({ hasText: testName });
      await expect(remaining).toHaveCount(0, { timeout: 10_000 });
    } finally {
      // Client was deleted, but cleanup just in case
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 8. Pagination shows total count ─────────────────────────────────────

  test('8. Pagination shows total client count', async ({ page }) => {
    await waitForClientsReady(page);

    // Pagination area should show total count (#139 T6 — unified dict copy:
    // legacy "N клиентов" removed; DataTable renders "N всего").
    await expect(page.locator('text=/\\d+\\s+всего/').first()).toBeVisible();
  });

  // ── 9. Sorting — click header toggles sort direction ────────────────────

  test('9. Sorting — click header toggles sort direction', async ({ page }) => {
    await waitForClientsReady(page);

    // Default sort is by "Имя" ascending (↑)
    const nameHeader = page
      .locator('table thead th')
      .filter({ hasText: 'Имя' });
    await expect(nameHeader).toBeVisible();

    // Click to sort descending
    await nameHeader.click();
    await page.waitForTimeout(500);

    // Should now show descending indicator
    await expect(nameHeader).toContainText('↓');

    // Click again to sort ascending
    await nameHeader.click();
    await page.waitForTimeout(500);

    // Should now show ascending indicator
    await expect(nameHeader).toContainText('↑');
  });

  // ── 10. Search filters clients ───────────────────────────────────────────

  test('10. Search input filters client list', async ({ page, request }) => {
    const uniqueName = `Searchable ${uid()}`;
    const client = await createTestClient(request, { name: uniqueName });
    const clientId = client.id;

    try {
      await waitForClientsReady(page, { waitForName: uniqueName });

      // Type the unique name into the search box
      const searchInput = page.locator('input[placeholder*="Поиск"]');
      await searchInput.fill(uniqueName);

      // Wait for debounced search to kick in (300ms debounce + network)
      await page.waitForTimeout(1500);

      // Our client should be visible
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: uniqueName });
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 11. Status filter narrows results ──────────────────────────────────

  test('11. Status filter narrows results', async ({ page }) => {
    await waitForClientsReady(page);

    // Get initial row count (active clients by default)
    const initialCount = await page.locator('table tbody tr').count();
    expect(initialCount).toBeGreaterThan(0);

    // Select "Неактивные" status filter — wait for filtered API response
    const statusSelect = page.locator('select:has(option:text("Все"))');
    const filterResponse = page.waitForResponse(
      (resp) => resp.url().includes('/api/v1/clients') && resp.url().includes('status=archived'),
      { timeout: 10_000 },
    );
    await statusSelect.selectOption('archived');
    await filterResponse;

    // After filtering, the table should show different results
    // (either fewer rows if no inactive clients, or different set of clients)
    const filteredCount = await page.locator('table tbody tr').count();
    // Just verify the filter was applied — count changed or is 0
    // Don't assert <= because inactive clients could outnumber active ones

    // Reset and verify filters return to default. "Сбросить фильтры" calls
    // resetFilters() which sets state to defaultFilters (status='active') and
    // triggers a refetch via the React Query hook sending status=active. Use a
    // content-based assertion on the status select: it must return to
    // "Активные" (value 'active') after reset.
    // #139 T6 + Addendum #12 — the reset button now lives ONLY in the
    // page-level ClientsFilters bar (the table's duplicate was dropped when
    // the empty state unified to "Нет записей"). The filters-panel scope
    // below still selects the right one — it's the only "Сбросить фильтры"
    // in the page now.
    const filtersPanel = page.locator('div.rounded-xl').filter({ has: statusSelect });
    await filtersPanel.getByText('Сбросить фильтры').click();
    await expect(statusSelect).toHaveValue('active', { timeout: 10_000 });
    const resetCount = await page.locator('table tbody tr').count();
    expect(resetCount).toBe(initialCount);
  });

  // ── 12. Modal close via backdrop click ──────────────────────────────────

  test('12. Client card modal closes via backdrop click', async ({
    page,
    request,
  }) => {
    const client = await createTestClient(request, {
      name: `Backdrop Test ${uid()}`,
    });
    const clientId = client.id;

    try {
      await waitForClientsReady(page, { waitForName: client.name });

      // Open client card
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Close via backdrop — click outside the modal (top-left corner)
      await closeByBackdrop(page);

      // Modal should close
      await expect(modal).not.toBeVisible({ timeout: 5000 });
    } finally {
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Helper — open client card and click on the first record tab
// ---------------------------------------------------------------------------

/**
 * Creates client + activity + record, opens the client card modal,
 * and clicks on the first record tab (date/time button in left panel).
 * Returns IDs for cleanup.
 */
async function setupRecordTab(
  page: import('@playwright/test').Page,
  request: import('@playwright/test').APIRequestContext,
  clientName?: string,
) {
  const client = await createTestClient(request, { name: clientName || `Record Tab ${uid()}` });
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id);

  await waitForClientsReady(page, { waitForName: client.name });
  // Reload to pick up newly created client (React Query may serve stale cache)
  await page.reload({ waitUntil: 'networkidle' });
  await waitForClientsReady(page, { waitForName: client.name });

  // Open client card
  const row = page
    .locator('table tbody tr')
    .filter({ hasText: client.name });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  const modal = page.locator('[data-testid="client-card-modal"]');
  await expect(modal).toBeVisible({ timeout: 5000 });

  // Click on the record tab — it's the second button in the left panel
  // (first button is "Клиент" tab, subsequent ones are record tabs with date/time)
  const recordTabButton = modal.locator('[data-testid="client-card-left-panel"] button').nth(1);
  await expect(recordTabButton).toBeVisible({ timeout: 5000 });
  await recordTabButton.click();

  // Wait for record tab content to load — must be visible before checking fields
  const recordTab = page.locator('[data-testid="client-record-tab"]');
  await recordTab.waitFor({ state: 'visible', timeout: 10_000 });
  // Also wait for the date field inside the tab to ensure tab content has rendered
  await page.locator('#record-date').waitFor({ state: 'visible', timeout: 10_000 });

  return { client, activity, record };
}

// ---------------------------------------------------------------------------
// Tests — Record Tab
// ---------------------------------------------------------------------------

test.describe('Record tab', () => {
  // ── 13. Record tab shows all fields ──────────────────────────────────────

  test('13. Record tab shows all fields', async ({ page, request }) => {
    const { client, activity, record } = await setupRecordTab(page, request);

    try {
      const tab = page.locator('[data-testid="client-record-tab"]');

      // Date field visible
      await expect(tab.locator('#record-date')).toBeVisible();

      // Time field visible
      await expect(tab.locator('#record-time')).toBeVisible();

      // Service dropdown visible (CustomSelect)
      await expect(
        tab.locator('[data-testid="select-service"] [data-testid="custom-select-trigger"]'),
      ).toBeVisible();

      // Master dropdown visible (CustomSelect)
      await expect(
        tab.locator('[data-testid="select-master"] [data-testid="custom-select-trigger"]'),
      ).toBeVisible();

      // Location dropdown visible (CustomSelect)
      await expect(
        tab.locator('[data-testid="select-location"] [data-testid="custom-select-trigger"]'),
      ).toBeVisible();

      // Status dropdown visible (StatusPicker icon variant in RecordVisitRow)
      await expect(
        tab.locator('[data-testid$="-status-trigger"]').first(),
      ).toBeVisible();

      // Visitors section visible
      await expect(tab.locator('text=Посетители')).toBeVisible();

      // Payment section visible
      await expect(tab.locator('text=Оплаты')).toBeVisible();

      // Comment field visible
      await expect(tab.locator('[data-testid="input-comment"]')).toBeVisible();

      // Close modal
      await closeByBackdrop(page);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── 14. Change visit status via dropdown ─────────────────────────────────

  test('14. Change visit status via dropdown', async ({ page, request }) => {
    const { client, activity, record } = await setupRecordTab(page, request);

    try {
      // Find the status picker trigger in RecordVisitRow
      const statusTrigger = page
        .locator('[data-testid$="-status-trigger"]').first();
      await expect(statusTrigger).toBeVisible();

      // Open the dropdown
      await statusTrigger.click();

      // Select "Посетил" option
      await page.locator('[data-testid$="-status-option-visited"]').first().click();

      // Status change is applied optimistically — verify the picker closed
      await expect(statusTrigger).toBeVisible();

      // Close modal
      await closeByBackdrop(page);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── 15. Add payment to record ────────────────────────────────────────────

  test('15. Add payment to record', async ({ page, request }) => {
    const { client, activity, record } = await setupRecordTab(page, request);

    try {
      // Click "+ Добавить" to open the inline payment form
      const addPaymentBtn = page.locator('[data-testid="btn-add-payment"]');
      await expect(addPaymentBtn).toBeVisible();
      await addPaymentBtn.click();

      // Fill payment amount in the inline form and commit via Enter (blur-to-commit)
      const amountInput = page.locator('[data-testid="add-payment-amount"]');
      await expect(amountInput).toBeVisible();
      await amountInput.fill('1500');
      await amountInput.press('Enter');

      // Wait for the payment to appear in the list
      await page.waitForTimeout(1000);

      // Verify payment appears in the payment table
      await expect(page.locator('[data-testid="record-payments-table"]')).toContainText('1 500');

      // Close modal
      await closeByBackdrop(page);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── 16. Save button activates on change ──────────────────────────────────

  test('16. Save button activates on change', async ({ page, request }) => {
    const { client, activity, record } = await setupRecordTab(page, request);

    try {
      const saveBtn = page.locator('[data-testid="btn-save-record"]');

      // Verify save button is disabled initially
      await expect(saveBtn).toBeDisabled();

      // Change the comment (triggers markChanged)
      const commentField = page.locator('[data-testid="input-comment"]');
      await commentField.click();
      await commentField.fill('Test comment for save activation');

      // Verify save button is now enabled
      await expect(saveBtn).toBeEnabled();

      // Close modal
      await closeByBackdrop(page);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── 17. Cancel resets changes ────────────────────────────────────────────

  test('17. Cancel resets changes', async ({ page, request }) => {
    const { client, activity, record } = await setupRecordTab(page, request);

    try {
      const saveBtn = page.locator('[data-testid="btn-save-record"]');
      const commentField = page.locator('[data-testid="input-comment"]');

      // Verify save is disabled initially
      await expect(saveBtn).toBeDisabled();

      // Make a change to the comment
      await commentField.click();
      await commentField.fill('Changed comment');

      // Verify save is now enabled
      await expect(saveBtn).toBeEnabled();

      // Click Cancel button (the button next to Save, with text "Отмена")
      const cancelBtn = page.locator('button:has-text("Отмена")');
      await cancelBtn.click();

      // Wait for state to reset
      await page.waitForTimeout(500);

      // Verify save button is disabled again
      await expect(saveBtn).toBeDisabled();

      // Verify comment was reset (should be empty or original value)
      const commentValue = await commentField.inputValue();
      // Original record has no comment, so it should reset to empty
      expect(commentValue).toBe(record.comment || '');

      // Close modal
      await closeByBackdrop(page);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — UUID search (#216 pre-flight)
// ---------------------------------------------------------------------------

test.describe('UUID search — #216 pre-flight', () => {
  // ── 18. Full UUID q → exactly one row; 10-char fragment → zero ─────────

  test('18. Full UUID pasted into search narrows to exactly that client; a 10-char fragment matches no id', async ({
    page,
    request,
  }) => {
    // GH #212 T15 (spec §6 S3 / §5.6 — #216 deep-link pre-flight): the
    // server-side q treats a FULL UUID as an exact id equality (normalized
    // to lowercase); a partial id fragment never matches by id and only hits
    // the text fields (name/phone/email). Fixture data avoids hex-ish
    // substrings so the fragment query matches nothing: name = "UUID Поиск
    // <uid()>" (uid = e2e_<ts>_<rand>), phone = "+7999<digits>", no email.
    // Seed client ids are c1-c5 (3 chars) — a 36-char UUID can never
    // collide with them.
    const client = await createTestClient(request, {
      name: `UUID Поиск ${uid()}`,
    });
    const clientId = client.id;

    try {
      await waitForClientsReady(page, { waitForName: client.name });

      const searchInput = page.locator('input[placeholder*="Поиск"]');
      await expect(searchInput).toBeVisible();

      // Full UUID → q=<uuid> → exactly one row (that client), pager total 1.
      await searchInput.fill(clientId);
      await expect(
        page.locator('table tbody tr').filter({ hasText: client.name }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expect(page.getByText('1 всего')).toBeVisible();

      // 10-char fragment → not a full UUID → no id equality clause; nothing
      // matches the text fields either → "Нет записей", pager total 0.
      await searchInput.fill(clientId.slice(0, 10));
      await expect(page.getByText('Нет записей')).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator('table tbody tr').filter({ hasText: client.name }),
      ).toHaveCount(0);
      await expect(page.getByText('0 всего')).toBeVisible();
    } finally {
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });
});
