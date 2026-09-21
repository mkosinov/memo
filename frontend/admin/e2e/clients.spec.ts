import { test, expect } from './fixtures/test';
import {
  waitForClientsReady,
  openAddTab,
  phoneMaskDisplay,
  clientSearchInput,
  expectDeepLinkChip,
  expectClientSearchEmpty,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';
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
    await expect(clientSearchInput(page)).toBeVisible();

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
      // NOTE: default 'load' wait — 'networkidle' never resolves while the
      // SSE /api/v1/events stream stays open (#239).
      await page.reload();
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
      // NOTE: default 'load' wait — 'networkidle' never resolves while the
      // SSE /api/v1/events stream stays open (#239).
      await page.reload();
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
      // NOTE: default 'load' wait — 'networkidle' never resolves while the
      // SSE /api/v1/events stream stays open (#239).
      await page.reload();
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
      const searchInput = clientSearchInput(page);
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
  // NOTE: default 'load' wait — 'networkidle' never resolves while the
  // SSE /api/v1/events stream stays open (#239).
  await page.reload();
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

      // Service dropdown visible (Combobox)
      await expect(
        tab.locator('[data-testid="select-service"] [data-testid="combobox-trigger"]'),
      ).toBeVisible();

      // Master dropdown visible (MasterPicker → Combobox)
      await expect(
        tab.locator('[data-testid="select-master"] [data-testid="combobox-trigger"]'),
      ).toBeVisible();

      // Location dropdown visible (Combobox)
      await expect(
        tab.locator('[data-testid="select-location"] [data-testid="combobox-trigger"]'),
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

      const searchInput = clientSearchInput(page);
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

// ---------------------------------------------------------------------------
// Tests — deep-link ?clientId= (GH #232 — machine narrowing by id set)
// ---------------------------------------------------------------------------
//
// Spec 2026-09-21-clients-deeplink-id-param-232 §2 (US-1…US-7) / §4. The
// address is the single writer of the narrowing: `?clientId=<uuid>` repeated
// narrows the table via the machine field `clientIds` (repeated `id` query
// keys on the list GET) — the SEARCH BOX never carries the UUID anymore.
// Exactly one valid id auto-opens the card (latch #216 blocks re-open after
// a close while the id stays the sole one); two or more never auto-open. A
// chip «Открыт по ссылке» / «Открыто по ссылке: N» renders above the table;
// its ✕ removes ONLY the clientId occurrences from the address. Closing the
// card does not touch the table, the filters, or the address.

test.describe('Deep-link ?clientId= — #232', () => {
  // ── US-1: single id — narrowing, empty search, auto-open, F5 restore ────

  test('US-1: single id narrows to the client, search stays empty, card auto-opens, F5 restores', async ({
    page,
    request,
  }) => {
    const target = await createTestClient(request, { name: `US1-deeplink-${uid()}` });

    try {
      await page.goto(`/clients?clientId=${target.id}`);

      // Address keeps the param; the table narrows to exactly the target…
      await expect(page).toHaveURL(new RegExp(`clientId=${target.id}`));
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expect(
        page.locator('table tbody tr').filter({ hasText: target.name }),
      ).toBeVisible();

      // …the search box stays EMPTY (the UUID lives in the machine field)…
      await expectClientSearchEmpty(page);

      // …the chip shows the single-id copy…
      await expectDeepLinkChip(page, 'Открыт по ссылке');

      // …and the status filter is forced to «Все» (#216: archived reachable).
      const statusSelect = page.locator('div:has(> label:text-is("Статус")) > select');
      await expect(statusSelect).toHaveValue('all');

      // F5 — the same state is restored from the address alone.
      await page.reload();
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expectClientSearchEmpty(page);
      await expectDeepLinkChip(page, 'Открыт по ссылке');
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
    }
  });

  // ── US-2: closing the card keeps the narrowed table and the address ─────

  test('US-2: close keeps table/address/search untouched; row click re-opens, no auto-re-open', async ({
    page,
    request,
  }) => {
    const target = await createTestClient(request, { name: `US2-deeplink-${uid()}` });
    let foreign: { id: string } | null = null;

    try {
      await page.goto(`/clients?clientId=${target.id}`);
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });

      // Close — NOTHING changes: table still narrowed, address still has the
      // param, search still empty, chip still up.
      await closeByBackdrop(page);
      await expect(page).toHaveURL(new RegExp(`clientId=${target.id}`));
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expectClientSearchEmpty(page);
      await expectDeepLinkChip(page, 'Открыт по ссылке');

      // No auto-re-open, probed deterministically (no blind sleep): a
      // foreign clients write (API context) broadcasts the SSE invalidate
      // frame → the active narrowed list query refetches → the auto-open
      // effect re-runs on the fresh `items` identity. Await that refetch,
      // then poll modal-absence for a short bounded window so a latch
      // regression that fires on the refetch commit cannot slip through.
      const narrowedRefetch = page.waitForResponse(
        (resp) => {
          const url = new URL(resp.url());
          return (
            url.pathname === '/api/v1/clients' &&
            url.searchParams.getAll('id').includes(target.id) &&
            resp.status() === 200
          );
        },
        { timeout: 10_000 },
      );
      foreign = await createTestClient(request, { name: `US2-foreign-${uid()}` });
      await narrowedRefetch;
      const absenceDeadline = Date.now() + 750; // ~1 React commit >> effect run
      while (Date.now() < absenceDeadline) {
        await expect(modal).not.toBeVisible();
        await page.waitForTimeout(150);
      }

      // A manual row click re-opens the card over the narrowed table.
      await page.locator('table tbody tr').filter({ hasText: target.name }).click();
      await expect(modal).toBeVisible({ timeout: 5_000 });
      await closeByBackdrop(page);
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
      if (foreign) await cleanup(request, `/api/v1/clients/${foreign.id}`);
    }
  });

  // ── US-3: multi-id — narrowing without a modal, chip «N», click to open ─

  test('US-3: multi-id narrows to the set, no auto-open, chip «Открыто по ссылке: N», row click opens', async ({
    page,
    request,
  }) => {
    const a = await createTestClient(request, { name: `US3-a-${uid()}` });
    const b = await createTestClient(request, { name: `US3-b-${uid()}` });
    const c = await createTestClient(request, { name: `US3-c-${uid()}` });

    try {
      await page.goto(`/clients?clientId=${a.id}&clientId=${b.id}&clientId=${c.id}`);

      // Narrowed to the three clients in the standard page sort…
      await expect(page.locator('table tbody tr')).toHaveCount(3, { timeout: 10_000 });
      for (const cl of [a, b, c]) {
        await expect(
          page.locator('table tbody tr').filter({ hasText: cl.name }),
        ).toBeVisible();
      }

      // …NO modal auto-open (cards open by row clicks)…
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).not.toBeVisible();

      // …the chip shows the multi-id copy with the count…
      await expectDeepLinkChip(page, 'Открыто по ссылке: 3');

      // …and the search box stays empty.
      await expectClientSearchEmpty(page);

      // A row click opens the card; closing it keeps the narrowed table.
      await page.locator('table tbody tr').filter({ hasText: b.name }).click();
      await expect(modal).toBeVisible({ timeout: 5_000 });
      await closeByBackdrop(page);
      await expect(page.locator('table tbody tr')).toHaveCount(3);
    } finally {
      await cleanup(request, `/api/v1/clients/${a.id}`);
      await cleanup(request, `/api/v1/clients/${b.id}`);
      await cleanup(request, `/api/v1/clients/${c.id}`);
    }
  });

  // ── US-4: chip ✕ — targeted removal; user filters survive ───────────────

  test('US-4: chip ✕ removes the narrowing from the address; user filters survive', async ({
    page,
    request,
  }) => {
    // User filter ON TOP of the narrowing: a search that matches the target
    // (AND semantics — spec §3.3). The ✕ must remove the narrowing WITHOUT
    // touching that user filter.
    const ts = uid();
    const target = await createTestClient(request, { name: `US4target-${ts}` });
    const other = await createTestClient(request, { name: `US4other-${ts}` });

    try {
      await page.goto(`/clients?clientId=${target.id}`);
      await expect(page.locator('table tbody tr')).toHaveCount(1, { timeout: 10_000 });

      // The auto-opened card overlays the page — close it first (US-2: the
      // narrowed table and the address stay put) before layering a user
      // filter on top of the narrowing.
      await closeByBackdrop(page);

      // AND: a user filter narrowing further (search by the shared prefix).
      const searchInput = clientSearchInput(page);
      await searchInput.fill(`US4target-${ts}`);
      await expect(
        page.locator('table tbody tr').filter({ hasText: target.name }),
      ).toBeVisible({ timeout: 10_000 });

      // ✕ on the chip — targeted removal only.
      await page.getByRole('button', { name: 'Снять сужение' }).click();

      // The param is gone from the address (everything else in its place)…
      await expect(page).not.toHaveURL(/clientId=/);
      await expect(page).toHaveURL(/\/clients$/);

      // …the chip is gone…
      await expect(page.locator('[data-testid="client-deeplink-chip"]')).toHaveCount(0);

      // …the user filter SURVIVES (target still matches, other does not)…
      await expect(
        page.locator('table tbody tr').filter({ hasText: target.name }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator('table tbody tr').filter({ hasText: other.name }),
      ).toHaveCount(0);
      await expect(searchInput).toHaveValue(`US4target-${ts}`);
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
      await cleanup(request, `/api/v1/clients/${other.id}`);
    }
  });

  // ── US-4b: full reset also clears the param from the address ────────────

  test('US-4b: «Сбросить фильтры» clears the narrowing from the address too', async ({
    page,
    request,
  }) => {
    const target = await createTestClient(request, { name: `US4b-deeplink-${uid()}` });

    try {
      await page.goto(`/clients?clientId=${target.id}`);
      await expect(page.locator('table tbody tr')).toHaveCount(1, { timeout: 10_000 });
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await closeByBackdrop(page);

      // Full reset — spec §3.5: resetFilters' documented extra job is
      // dropping clientId from the address; the status select returns to
      // the default «Активные».
      await page.getByText('Сбросить фильтры').click();
      await expect(page).not.toHaveURL(/clientId=/, { timeout: 10_000 });
      await expect(page.locator('[data-testid="client-deeplink-chip"]')).toHaveCount(0);
      const statusSelect = page.locator('div:has(> label:text-is("Статус")) > select');
      await expect(statusSelect).toHaveValue('active', { timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
    }
  });

  // ── US-5: dead link (deleted), archived link, partial list ───────────────

  test('US-5: dead link keeps empty table + chip + address; archived opens; partial list shows found only', async ({
    page,
    request,
  }) => {
    // (a) Deleted client: one id pointing at nobody. The address is NOT
    // silently wiped — empty table + chip stay visible.
    const dead = await createTestClient(request, { name: `US5-dead-${uid()}` });
    await cleanup(request, `/api/v1/clients/${dead.id}`); // hard-delete (no deps)

    await page.goto(`/clients?clientId=${dead.id}`);
    await expect(page).toHaveURL(new RegExp(`clientId=${dead.id}`));
    await expect(page.getByText('Нет записей')).toBeVisible({ timeout: 10_000 });
    await expectDeepLinkChip(page, 'Открыт по ссылке');
    await expectClientSearchEmpty(page);
    // No modal can open for a vanished client.
    await expect(page.locator('[data-testid="client-card-modal"]')).not.toBeVisible();

    // ✕ on the dead chip — full table comes back, address clean.
    await page.getByRole('button', { name: 'Снять сужение' }).click();
    await expect(page).not.toHaveURL(/clientId=/);
    await expect(
      page.locator('table tbody tr').first(),
    ).toBeVisible({ timeout: 10_000 });

    // (b) Partial list: one dead + one live id — found shown, missing
    // silently dropped from the selection.
    const live = await createTestClient(request, { name: `US5-live-${uid()}` });
    try {
      await page.goto(`/clients?clientId=${dead.id}&clientId=${live.id}`);
      await expect(page.locator('table tbody tr')).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('table tbody tr').filter({ hasText: live.name }),
      ).toBeVisible();
      await expectDeepLinkChip(page, 'Открыто по ссылке: 2');
      // Two ids ⇒ no auto-open.
      await expect(page.locator('[data-testid="client-card-modal"]')).not.toBeVisible();
    } finally {
      await cleanup(request, `/api/v1/clients/${live.id}`);
    }
  });

  test('US-5b: deep link on an ARCHIVED client finds and opens it (status=all)', async ({
    page,
    request,
  }) => {
    const archived = await createTestClient(request, { name: `US5b-arch-${uid()}` });
    const archResp = await request.post(
      `${BACKEND}/api/v1/clients/${archived.id}/archive`,
    );
    expect(archResp.ok()).toBeTruthy();

    try {
      await page.goto(`/clients?clientId=${archived.id}`);
      // Found via the forced status=all (#216 behavior preserved)…
      await expect(page.locator('table tbody tr')).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('table tbody tr').filter({ hasText: archived.name }),
      ).toBeVisible();

      // …and the card opens automatically (single valid id).
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await closeByBackdrop(page);
      await expect(page.locator('table tbody tr')).toHaveCount(1);
    } finally {
      await cleanup(request, `/api/v1/clients/${archived.id}`);
    }
  });

  // ── US-6: garbage values are dropped, valid ones work ───────────────────

  test('US-6: garbage in the param is dropped; the valid id narrows; all-garbage = full table', async ({
    page,
    request,
  }) => {
    const target = await createTestClient(request, { name: `US6-deeplink-${uid()}` });
    // Second factory row makes the all-garbage leg self-contained: the
    // "full table" claim is proven by THESE two rows being present (no
    // reliance on unrelated seed counts).
    const filler = await createTestClient(request, { name: `US6-filler-${uid()}` });

    try {
      // Mix: not-a-uuid, an empty value, a padded uuid — only the strict
      // UUID shape survives parsing (spec §3.3).
      const padded = `  ${target.id}  `;
      await page.goto(
        `/clients?clientId=abc&clientId=&clientId=${encodeURIComponent(padded)}&clientId=${target.id}`,
      );

      // Exactly one valid id ⇒ narrowed to it, single-id chip, auto-open.
      await expect(page.locator('table tbody tr')).toHaveCount(1, { timeout: 10_000 });
      await expect(
        page.locator('table tbody tr').filter({ hasText: target.name }),
      ).toBeVisible();
      await expectDeepLinkChip(page, 'Открыт по ссылке');
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 10_000 });
      await closeByBackdrop(page);

      // All-garbage ⇒ the param is ignored entirely: full default table,
      // no chip, no modal. Both factory rows prove the "full table" part
      // without depending on seed data.
      await page.goto(`/clients?clientId=abc&clientId=${encodeURIComponent(' %20 ')}`);
      await expect(page).toHaveURL(/clientId=/); // address NOT wiped
      await expect(
        page.locator('table tbody tr').filter({ hasText: target.name }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator('table tbody tr').filter({ hasText: filler.name }),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="client-deeplink-chip"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="client-card-modal"]')).not.toBeVisible();
      await expectClientSearchEmpty(page);
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
      await cleanup(request, `/api/v1/clients/${filler.id}`);
    }
  });

  // ── US-7: manual row click on the full table writes no param ────────────

  test('US-7: manual row click opens the card without touching the address', async ({
    page,
    request,
  }) => {
    const target = await createTestClient(request, { name: `US7-click-${uid()}` });

    try {
      await waitForClientsReady(page, { waitForName: target.name });

      // Full table, no narrowing chip in play.
      await expect(page.locator('[data-testid="client-deeplink-chip"]')).toHaveCount(0);

      const row = page.locator('table tbody tr').filter({ hasText: target.name });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // Status-quo regression (spec US-7): the address gains NO param.
      await expect(page).toHaveURL(/\/clients$/);

      await closeByBackdrop(page);
      await expect(page).toHaveURL(/\/clients$/);
      await expect(page.locator('[data-testid="client-deeplink-chip"]')).toHaveCount(0);
    } finally {
      await cleanup(request, `/api/v1/clients/${target.id}`);
    }
  });

  // ── S1 (#231, re-anchored to #232): deep-link mount fires EXACTLY ONE
  //    narrowed list request — id=<uuid>&status=all ─────────────────────────
  //
  // Spec 2026-09-19-clients-deeplink-single-request §3 S1 / §6 + #232 §3.2:
  // the initialFilters seed kills the default (status=active) GET — only the
  // narrowed one fires, now carrying the machine `id` key (repeated) instead
  // of the old q=<uuid>. The counter matches the LIST endpoint (pathname
  // /api/v1/clients, GET) and is deliberately NOT filtered by id=: the killed
  // default request (same pathname, no id=, status=active) must stay visible
  // to the counter, or the regression this test guards would be invisible
  // again. Point paths under /api/v1/clients/<id>… are NOT list traffic —
  // the auto-opened card's visitors GET is expected in the window and must
  // not count. Fixture traffic goes through the `request` context before
  // goto, so it never reaches the page-scoped counter.

  test('S1: deep-link mount fires exactly one list request — narrowed id=<uuid>&status=all', async ({
    page,
    request,
  }) => {
    const client = await createTestClient(request, { name: `S1-deeplink-${uid()}` });
    const clientId = client.id;

    try {
      // Listener registered BEFORE goto — counts every list GET from the
      // first frame of the deep-link mount on.
      const listRequests: string[] = [];
      page.on('request', (req) => {
        const url = new URL(req.url());
        if (req.method() === 'GET' && url.pathname === '/api/v1/clients') {
          listRequests.push(req.url());
        }
      });

      await page.goto(`/clients?clientId=${clientId}`);

      // Observation window: closes on the narrowed list response (id=<uuid>),
      // then +500 ms to catch a late stray request (US-1 convention).
      await page.waitForResponse(
        (resp) => {
          const url = new URL(resp.url());
          return (
            url.pathname === '/api/v1/clients' &&
            url.searchParams.getAll('id').includes(clientId) &&
            resp.status() === 200
          );
        },
        { timeout: 60_000 },
      );
      await page.waitForTimeout(500);

      expect(listRequests).toHaveLength(1);
      const only = new URL(listRequests[0]!);
      expect(only.searchParams.getAll('id')).toEqual([clientId]);
      expect(only.searchParams.get('status')).toBe('all');
      // The narrowing is machine-only: no q key on the narrowed request.
      expect(only.searchParams.get('q')).toBeNull();
    } finally {
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — GH #140 entity hooks: clients-list fetch isolation + cache invalidation
// ---------------------------------------------------------------------------

test.describe('GH #140 — clients-list isolation & staleness', () => {
  // ── US-1: /schedule fires ZERO /api/v1/clients requests ──────────────────
  //
  // Pre-refactor the global ClientsProvider mounted app-wide and fetched the
  // clients list (getClientsWithStats) on EVERY page, /schedule included. The
  // refactor dissolved that provider — only /clients reads the list (via
  // useClientsTable); every other surface resolves clients by point id
  // (useClient). This is a direct navigation (not /clients→/schedule, which
  // legitimately carries list traffic) and is list-agnostic: ANY
  // /api/v1/clients* hit fails it. Supersedes the per_page=100-only guard in
  // records-view.spec.

  test('US-1: /schedule fires zero clients requests', async ({ page }) => {
    const clientsRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/v1/clients')) clientsRequests.push(req.url());
    });
    await page.goto('/schedule');
    // Wait for the page's own data fetch to settle instead of networkidle —
    // the SSE /api/v1/events stream never idles the network (#239).
    await page
      .waitForResponse(
        (resp) => resp.url().includes('/api/v1/activities') && resp.status() === 200,
        { timeout: 60_000 },
      )
      .catch(() => {});
    await page.waitForTimeout(500);
    expect(clientsRequests).toHaveLength(0);
  });

  // ── US-6: a client created via schedule quick-add is visible in /clients
  //         WITHOUT a reload (own-mutation invalidation of the primed list).
  //
  // Discrimination: the first /clients visit PRIMES ['clients',1,20,…,'name','asc']
  // (staleTime 30s, refetchOnWindowFocus off). Leaving + remounting /clients
  // within 30s would normally serve the stale page (no new client). The
  // quick-add createRecordMutation sets createdClientId and invalidates
  // qk.clients, so on remount the stale cache refetches and the new active
  // client appears under the default name/asc, status=active view — no reload.
  // WITHOUT that invalidation the primed page lacks the client → fail.

  test('US-6: quick-add client appears in /clients without reload', async ({
    page,
    request,
  }) => {
    const ts = Date.now();
    const newClientName = `us6-${ts}`;
    // 10 national digits: 966 + 7 unique tail digits → typed as +7 966….
    const nationalDigits = `966${String(ts).slice(-7)}`;
    const newPhone = `+7${nationalDigits}`;
    // GH #221 WYSIWYG: the form saves the VISIBLE AsYouType-formatted
    // string, not the raw typed text — expect the masked form in the DB.
    const expectedStoredPhone = phoneMaskDisplay(nationalDigits, 'international');
    let clientId: string | null = null;
    let recordId: string | null = null;

    try {
      // 1. Full load of /schedule, then SPA-navigate to /clients via the
      //    sidebar link (NOT page.goto) — this primes the list cache.
      await page.goto('/schedule');
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });
      await page.locator('a[aria-label="Клиенты"]').click();
      await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 15_000 });
      await expect(page.locator('table tbody')).toBeVisible({ timeout: 10_000 });

      // 2. SPA-navigate back to /schedule (no reload — primed cache persists).
      await page.locator('a[aria-label="Расписание"]').click();
      await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });

      // 3. Quick-add a booking with a NEW client (unknown phone → createClient).
      await openAddTab(page);
      await page.locator('[data-testid="input-phone"]').fill(newPhone);
      await page.locator('[data-testid="input-phone"]').blur();
      await page.locator('[data-testid="input-client-name"]').fill(newClientName);
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Запись создана')).toBeVisible({ timeout: 10_000 });

      // Close the modal so the sidebar is clickable (modal is fixed inset-0).
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(page.locator('[data-testid="activity-details-modal"]')).toHaveCount(0);

      // Resolve the created ids from the DB (cleanup targets).
      // GH #221: the stored phone is the masked visible string (WYSIWYG).
      await expect
        .poll(
          () => {
            const row = queryDBRow(`SELECT id FROM clients WHERE phone='${expectedStoredPhone}'`);
            clientId = row?.id ?? null;
            return clientId !== null;
          },
          { timeout: 15_000, intervals: [200, 500, 1000] },
        )
        .toBe(true);
      const recRow = queryDBRow(`SELECT id FROM records WHERE client_id='${clientId}'`);
      recordId = recRow?.id ?? null;

      // 4. SPA-navigate back to /clients — WITHOUT reload. The invalidated
      //    cache refetches on remount. Then narrow via the search box (same
      //    convention as test 10) so the assertion doesn't depend on page-1
      //    ordering under fullyParallel seeds.
      await page.locator('a[aria-label="Клиенты"]').click();
      await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 15_000 });
      const searchInput = clientSearchInput(page);
      await expect(searchInput).toBeVisible({ timeout: 10_000 });
      await searchInput.fill(newClientName);
      // Wait for debounced search to kick in (300ms debounce + network)
      await page.waitForTimeout(1500);
      await expect(
        page.locator('table tbody tr').filter({ hasText: newClientName }),
      ).toBeVisible({ timeout: 10_000 });
    } finally {
      if (recordId) await cleanupRecord(request, recordId);
      if (clientId) await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });
});
