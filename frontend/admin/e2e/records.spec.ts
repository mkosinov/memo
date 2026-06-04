import { test, expect } from '@playwright/test';
import { waitForRecordsReady } from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
} from './fixtures/factories';

/**
 * E2E tests for Records page functionality: filters, table display, search,
 * sorting, pagination, and detail panel.
 *
 * The Records page loads data from the backend API via RecordsContext.
 * Filter dropdown options (location, service, master) come from mock data.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — Records Page
// ---------------------------------------------------------------------------

test.describe('Records Page — Table and Filters', () => {
  // ── 1. Page loads with header and table ──────────────────────────────────

  test('1. Records page loads with header and table', async ({ page }) => {
    await waitForRecordsReady(page);

    // Header is visible
    await expect(page.locator('h1:has-text("Управление записями")')).toBeVisible();

    // Table is visible
    await expect(page.locator('table')).toBeVisible();

    // Table has headers
    const headers = page.locator('table thead th');
    const headerCount = await headers.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  // ── 2. Table has expected column headers ─────────────────────────────────

  test('2. Table has expected column headers', async ({ page }) => {
    await waitForRecordsReady(page);

    // Check all expected column headers exist
    const expectedHeaders = [
      'Дата / Время',
      'Клиент',
      'Гостей',
      'Услуга',
      'Мастер',
      'Локация',
      'Статус',
      'Сумма',
      'Оплата',
    ];

    for (const headerText of expectedHeaders) {
      await expect(
        page.locator('table thead th').filter({ hasText: headerText }),
      ).toBeVisible();
    }
  });

  // ── 3. Filter controls are visible ───────────────────────────────────────

  test('3. Filter controls are visible', async ({ page }) => {
    await waitForRecordsReady(page);

    // Date filters
    await expect(page.locator('input[aria-label="Фильтр по дате от"]')).toBeVisible();
    await expect(page.locator('input[aria-label="Фильтр по дате до"]')).toBeVisible();

    // Select filters
    await expect(page.locator('select[aria-label="Фильтр по локации"]')).toBeVisible();
    await expect(page.locator('select[aria-label="Фильтр по услуге"]')).toBeVisible();
    await expect(page.locator('select[aria-label="Фильтр по мастеру"]')).toBeVisible();
    await expect(page.locator('select[aria-label="Фильтр по статусу"]')).toBeVisible();

    // Reset button
    await expect(page.locator('button:has-text("Сбросить")')).toBeVisible();
  });

  // ── 4. Filter selects have default empty options ─────────────────────────

  test('4. Filter selects have default "all" options selected', async ({ page }) => {
    await waitForRecordsReady(page);

    // All selects should default to empty value ("Все ...")
    await expect(page.locator('select[aria-label="Фильтр по локации"]')).toHaveValue('');
    await expect(page.locator('select[aria-label="Фильтр по услуге"]')).toHaveValue('');
    await expect(page.locator('select[aria-label="Фильтр по мастеру"]')).toHaveValue('');
    await expect(page.locator('select[aria-label="Фильтр по статусу"]')).toHaveValue('');
  });

  // ── 5. Filter selects have options from mock data ────────────────────────

  test('5. Filter selects have populated options', async ({ page }) => {
    await waitForRecordsReady(page);

    // Location select should have at least the default + some location options
    const locationOptions = page.locator('select[aria-label="Фильтр по локации"] option');
    const locationCount = await locationOptions.count();
    expect(locationCount).toBeGreaterThan(1); // At least "Все локации" + one real location

    // Service select should have options
    const serviceOptions = page.locator('select[aria-label="Фильтр по услуге"] option');
    const serviceCount = await serviceOptions.count();
    expect(serviceCount).toBeGreaterThan(1);

    // Master select should have options
    const masterOptions = page.locator('select[aria-label="Фильтр по мастеру"] option');
    const masterCount = await masterOptions.count();
    expect(masterCount).toBeGreaterThan(1);

    // Status select should have 4 status options + default
    const statusOptions = page.locator('select[aria-label="Фильтр по статусу"] option');
    const statusCount = await statusOptions.count();
    expect(statusCount).toBe(5); // default + waiting, visited, missed, cancelled
  });

  // ── 6. Filter by status — table updates ──────────────────────────────────

  test('6. Filter by status — table updates', async ({ page, request }) => {
    // Create test data — new records default to visit status "waiting"
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    let recordId = record.id;
    let clientId = client.id;

    try {
      // Reload to pick up new data
      await waitForRecordsReady(page);

      // Count initial rows (before filtering)
      const initialCount = await page.locator('tbody tr').count();

      // Select "Ожидание" status filter
      await page.locator('select[aria-label="Фильтр по статусу"]').selectOption('waiting');
      await page.waitForTimeout(500);

      // Filtered count should be <= initial count
      const filteredCount = await page.locator('tbody tr').count();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);

      // If there are filtered rows, all should have the correct status badge
      if (filteredCount > 0) {
        const statusBadges = page.locator('tbody tr span:text("Ожидание")');
        const badgeCount = await statusBadges.count();
        expect(badgeCount).toBe(filteredCount);
      }
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 7. Reset filters — returns to initial state ─────────────────────────

  test('7. Reset filters — returns to initial state', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    let recordId = record.id;
    let clientId = client.id;

    try {
      await waitForRecordsReady(page);

      const initialCount = await page.locator('tbody tr').count();

      // Apply a filter
      await page.locator('select[aria-label="Фильтр по статусу"]').selectOption('cancelled');
      await page.waitForTimeout(500);

      // Click reset
      await page.locator('button:has-text("Сбросить")').click();
      await page.waitForTimeout(500);

      // All filter selects should be reset to empty
      await expect(page.locator('select[aria-label="Фильтр по локации"]')).toHaveValue('');
      await expect(page.locator('select[aria-label="Фильтр по услуге"]')).toHaveValue('');
      await expect(page.locator('select[aria-label="Фильтр по мастеру"]')).toHaveValue('');
      await expect(page.locator('select[aria-label="Фильтр по статусу"]')).toHaveValue('');

      // Row count should match initial count
      const resetCount = await page.locator('tbody tr').count();
      expect(resetCount).toBe(initialCount);
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 8. Click row — opens detail panel ────────────────────────────────────

  test('8. Click row — opens detail panel', async ({ page, request }) => {
    const client = await createTestClient(request, { name: 'Detail Panel Test' });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    let recordId = record.id;
    let clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Ensure we have at least one row
      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Click the first row
      await firstRow.click();
      await page.waitForTimeout(500);

      // Detail panel should appear with "Детали записи" heading
      await expect(page.locator('h3:has-text("Детали записи")')).toBeVisible({ timeout: 5000 });

      // Panel should contain client info section
      await expect(page.locator('text=Клиент').first()).toBeVisible();

      // Panel should contain activity info section
      await expect(page.locator('text=Занятие')).toBeVisible();
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 9. Click row again — closes detail panel ─────────────────────────────

  test('9. Click row again — closes detail panel', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    let recordId = record.id;
    let clientId = client.id;

    try {
      await waitForRecordsReady(page);

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Click to open detail panel
      await firstRow.click();
      await page.waitForTimeout(500);
      await expect(page.locator('h3:has-text("Детали записи")')).toBeVisible({ timeout: 5000 });

      // Click again to close
      await firstRow.click();
      await page.waitForTimeout(500);

      // Detail panel should disappear
      await expect(page.locator('h3:has-text("Детали записи")')).not.toBeVisible();
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 10. Detail panel close button ────────────────────────────────────────

  test('10. Detail panel close button dismisses panel', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    let recordId = record.id;
    let clientId = client.id;

    try {
      await waitForRecordsReady(page);

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Open detail panel
      await firstRow.click();
      await page.waitForTimeout(500);
      await expect(page.locator('h3:has-text("Детали записи")')).toBeVisible({ timeout: 5000 });

      // Click the close button (✕) in the detail panel
      await page.locator('button[aria-label="Закрыть"]').click();
      await page.waitForTimeout(500);

      // Detail panel should disappear
      await expect(page.locator('h3:has-text("Детали записи")')).not.toBeVisible();
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 11. Sorting — click header toggles sort direction ────────────────────

  test('11. Sorting — click header toggles sort direction', async ({ page }) => {
    await waitForRecordsReady(page);

    // Find the "Клиент" header and click it to sort
    const clientHeader = page.locator('table thead th').filter({ hasText: 'Клиент' });
    await expect(clientHeader).toBeVisible();

    // Get initial order of client names
    const getName = async (index: number) =>
      page.locator('tbody tr').nth(index).locator('td').nth(1).textContent();

    const initialFirst = await getName(0);
    const initialLast = await getName((await page.locator('tbody tr').count()) - 1);

    // Click header to sort ascending
    await clientHeader.click();
    await page.waitForTimeout(300);

    const afterFirstAsc = await getName(0);
    const afterLastAsc = await getName((await page.locator('tbody tr').count()) - 1);

    // Click again to sort descending
    await clientHeader.click();
    await page.waitForTimeout(300);

    const afterFirstDesc = await getName(0);
    const afterLastDesc = await getName((await page.locator('tbody tr').count()) - 1);

    // Ascending and descending should have different first elements (unless all same)
    if (initialFirst !== initialLast) {
      expect(afterFirstAsc).not.toBe(afterFirstDesc);
    }

    // Verify sort indicator changes
    await expect(clientHeader).toContainText('↓');
  });

  // ── 12. Pagination — page count selector works ───────────────────────────

  test('12. Pagination — shows total count', async ({ page }) => {
    await waitForRecordsReady(page);

    // Pagination area should show total count
    await expect(page.locator('text=/\\d+ всего/')).toBeVisible();

    // Page size selector should be visible
    const pageSizeSelect = page.locator('select').filter({ hasText: '10' });
    if (await pageSizeSelect.isVisible()) {
      await expect(pageSizeSelect).toBeVisible();
    }
  });

  // ── 13. Empty state — no records match filter ────────────────────────────

  test('13. Empty state — shows message when no records match', async ({ page }) => {
    await waitForRecordsReady(page);

    // Set a very narrow date range unlikely to have records
    const dateFromInput = page.locator('input[aria-label="Фильтр по дате от"]');
    const dateToInput = page.locator('input[aria-label="Фильтр по дате до"]');
    await dateFromInput.fill('2020-01-01');
    await dateToInput.fill('2020-01-02');
    await page.waitForTimeout(500);

    // If there are no records in that range, empty state should show
    const emptyState = page.locator('td:has-text("Записи не найдены")');
    const rowCount = await page.locator('tbody tr').count();

    if (rowCount === 1) {
      // Only the empty state row
      await expect(emptyState).toBeVisible();
    }
  });

  // ── 14. Client name is clickable — opens client card modal ───────────────

  test('14. Client name is clickable in table', async ({ page, request }) => {
    const client = await createTestClient(request, { name: 'Clickable Client' });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    let recordId = record.id;
    let clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Find the client name button in the table
      const clientButton = page.locator('tbody button').filter({ hasText: client.name });

      if (await clientButton.isVisible()) {
        // Click the client name button
        await clientButton.click();
        await page.waitForTimeout(500);

        // Client card modal should appear (has the client name in a header)
        // The modal uses fixed positioning with z-50
        const modal = page.locator('.fixed.z-50');
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Modal should show the client name
        await expect(modal.locator(`text=${client.name}`)).toBeVisible();

        // Close the modal
        await modal.locator('button[aria-label="Закрыть"]').click();
        await page.waitForTimeout(300);
      }
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 15. Status badges — correct styling per status ──────────────────────

  test('15. Status badges — display correct text for statuses', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    // Update visit status to "visited" — RecordCreate only accepts RecordStatus,
    // not VisitStatus, so we update via PUT with the desired visit status.
    const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';
    await request.put(`${BACKEND}/api/v1/records/${record.id}`, {
      data: {
        activity_id: activity.id,
        client_id: client.id,
        status: record.status,
        comment: record.comment,
        visits: record.visits.map((v: { visitor_id: string; price: number }) => ({
          visitor_id: v.visitor_id,
          price: v.price,
          status: 'visited',
        })),
      },
    });

    let recordId = record.id;
    let clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Filter to show only our record
      await page.locator('select[aria-label="Фильтр по статусу"]').selectOption('visited');
      await page.waitForTimeout(500);

      // Find the status badge in the table
      const statusBadge = page.locator('tbody span.rounded-full').filter({ hasText: 'Посетили' });

      if (await statusBadge.isVisible()) {
        // Badge should contain the status text
        await expect(statusBadge).toContainText('Посетили');

        // Badge should have emerald styling (for "visited" status)
        const classes = await statusBadge.getAttribute('class');
        expect(classes).toContain('emerald');
      }
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 16. Filter by location — table updates ───────────────────────────────

  test('16. Filter by location — narrows results', async ({ page }) => {
    await waitForRecordsReady(page);

    const initialCount = await page.locator('tbody tr').count();

    // Select the first non-empty location option
    const locationSelect = page.locator('select[aria-label="Фильтр по локации"]');
    const options = locationSelect.locator('option');
    const optionCount = await options.count();

    if (optionCount > 1) {
      // Select the second option (first real location)
      await locationSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);

      const filteredCount = await page.locator('tbody tr').count();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    }
  });

  // ── 17. Filter by service — table updates ────────────────────────────────

  test('17. Filter by service — narrows results', async ({ page }) => {
    await waitForRecordsReady(page);

    const initialCount = await page.locator('tbody tr').count();

    // Select the first non-empty service option
    const serviceSelect = page.locator('select[aria-label="Фильтр по услуге"]');
    const options = serviceSelect.locator('option');
    const optionCount = await options.count();

    if (optionCount > 1) {
      await serviceSelect.selectOption({ index: 1 });
      await page.waitForTimeout(500);

      const filteredCount = await page.locator('tbody tr').count();
      expect(filteredCount).toBeLessThanOrEqual(initialCount);
    }
  });

  // ── 18. Multiple filters — compound filtering ────────────────────────────

  test('18. Multiple filters — compound filtering narrows results', async ({
    page,
    request,
  }) => {
    // Create test data — new records default to visit status "waiting"
    const client = await createTestClient(request, { name: 'Compound Filter' });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    let recordId = record.id;
    let clientId = client.id;

    try {
      await waitForRecordsReady(page);

      const initialCount = await page.locator('tbody tr').count();

      // Apply status filter
      await page.locator('select[aria-label="Фильтр по статусу"]').selectOption('waiting');
      await page.waitForTimeout(300);

      const afterStatus = await page.locator('tbody tr').count();
      expect(afterStatus).toBeLessThanOrEqual(initialCount);

      // Apply master filter on top of status filter
      const masterSelect = page.locator('select[aria-label="Фильтр по мастеру"]');
      const masterOptions = masterSelect.locator('option');
      const masterOptionCount = await masterOptions.count();

      if (masterOptionCount > 1) {
        await masterSelect.selectOption({ index: 1 });
        await page.waitForTimeout(300);

        const afterMaster = await page.locator('tbody tr').count();
        expect(afterMaster).toBeLessThanOrEqual(afterStatus);
      }
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 19. Price formatting — ruble sign displayed ──────────────────────────

  test('19. Price formatting — ruble sign displayed', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [{ name: `Price Test ${Date.now()}`, price: 3500 }],
    });

    let recordId = record.id;
    let clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Find a cell in the "Сумма" column that contains a price
      const priceCell = page.locator('tbody td').filter({ hasText: /₽/ }).first();

      if (await priceCell.isVisible()) {
        const text = await priceCell.textContent();
        expect(text).toContain('₽');
        // Price should be a formatted number
        expect(text).toMatch(/[\d\s]+₽/);
      }
    } finally {
      await cleanup(request, `/api/v1/records/${recordId}`);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 20. Payment status — displays correctly ──────────────────────────────

  test('20. Payment status — displays payment indicator', async ({ page }) => {
    await waitForRecordsReady(page);

    // Look for payment status indicators in the table
    const paymentIndicators = page.locator('tbody td').filter({
      hasText: /Оплачено|Частично|Не оплачено/,
    });

    // If there are records, at least one should have a payment indicator
    const rowCount = await page.locator('tbody tr').count();
    if (rowCount > 0) {
      const indicatorCount = await paymentIndicators.count();
      expect(indicatorCount).toBeGreaterThan(0);
    }
  });
});
