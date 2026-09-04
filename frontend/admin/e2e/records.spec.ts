import { test, expect, type Page } from '@playwright/test';
import { waitForRecordsReady } from './fixtures/helpers';
import { closeCombobox, openCombobox, searchAndSelect } from './helpers/combobox';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  createTestRecordWithClient,
  createTestRecordWithPayment,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * E2E tests for Records page functionality: filters, table display,
 * sorting, pagination, and detail panel.
 *
 * Server-driven rework (#191): filters/sort/pagination are server params.
 * Every interaction test registers page.waitForResponse with a URL-param
 * predicate BEFORE the UI action, awaits it after, then asserts post-state.
 * No page.route mocking, no waitForTimeout for server-sync waits.
 *
 * Requires: backend on :8000 (frontend via playwright webServer).
 */

/** Read the server total from the "N всего" pagination label. */
async function readServerTotal(page: Page): Promise<number> {
  const text = (await page.locator('text=/\\d+\\s*всего/').first().textContent()) ?? '';
  const m = text.match(/(\d+)\s*всего/);
  return m ? parseInt(m[1], 10) : 0;
}

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

    // Select filters — Combobox triggers carry the «Фильтр по …» aria-labels
    await expect(page.getByLabel('Фильтр по локации')).toBeVisible();
    await expect(page.getByLabel('Фильтр по услуге')).toBeVisible();
    await expect(page.getByLabel('Фильтр по мастеру')).toBeVisible();
    await expect(page.locator('[data-testid="booking-filters-status"]')).toBeVisible();

    // Reset button
    await expect(page.locator('button:has-text("Сбросить")')).toBeVisible();
  });

  // ── 4. Filter selects have default empty options ─────────────────────────

  test('4. Filter selects have default "all" options selected', async ({ page }) => {
    await waitForRecordsReady(page);

    // All Combobox filters default to the cleared state — the trigger shows
    // the clear label («Все …»)
    await expect(page.getByLabel('Фильтр по локации')).toHaveText(/Все локации/);
    await expect(page.getByLabel('Фильтр по услуге')).toHaveText(/Все услуги/);
    await expect(page.getByLabel('Фильтр по мастеру')).toHaveText(/Все мастера/);
    await expect(page.locator('[data-testid="booking-filters-status-trigger"]')).toContainText('Все статусы');
  });

  // ── 5. Filter selects have options from mock data ────────────────────────

  test('5. Filter selects have populated options', async ({ page }) => {
    await waitForRecordsReady(page);

    // Combobox flow: open each trigger, count [data-testid^="combobox-option-"]
    // minus the pinned clear option — dictionaries populate with ≥1 real option.
    const countRealOptions = async (triggerLabel: string) => {
      await openCombobox(page, page.getByLabel(triggerLabel));
      const optionCount = await page.locator('[data-testid^="combobox-option-"]').count();
      // Close the dropdown again before the next trigger opens its own —
      // via getByRole 'button' (while open, getByLabel matches BOTH the
      // trigger button and the aria-labelled listbox → strict violation).
      await closeCombobox(page, triggerLabel);
      return optionCount - 1; // minus the pinned «Все …» clear option
    };

    // Location Combobox should have at least one real location
    expect(await countRealOptions('Фильтр по локации')).toBeGreaterThan(0);

    // Service Combobox should have options
    expect(await countRealOptions('Фильтр по услуге')).toBeGreaterThan(0);

    // Master Combobox should have options
    expect(await countRealOptions('Фильтр по мастеру')).toBeGreaterThan(0);

    // Status filter is a StatusFiltersPicker dropdown — open it to count options
    await page.locator('[data-testid="booking-filters-status-trigger"]').click();
    const statusOptions = page.locator('[data-testid^="booking-filters-status-option-"]');
    await expect(statusOptions.first()).toBeVisible();
    const statusCount = await statusOptions.count();
    expect(statusCount).toBe(5); // all + waiting, visited, cancelled, missed
    // Close the dropdown
    await page.locator('[data-testid="booking-filters-status-trigger"]').click();
  });

  // ── 6. Filter by status — server filters rows ────────────────────────────

  test('6. Filter by status — table updates', async ({ page, request }) => {
    // New records default to status "waiting"
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    const recordId = record.id;
    const clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Select "Ожидание" (waiting) — wait for the filtered server response
      const filterResponse = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('status=waiting'),
        { timeout: 10_000 },
      );
      await page.locator('[data-testid="booking-filters-status-trigger"]').click();
      await page.locator('[data-testid="booking-filters-status-option-waiting"]').click();
      await filterResponse;

      // Post-state: every visible status badge is "waiting"
      const badges = page.locator('tbody tr [data-testid^="status-badge-"]');
      await expect(badges.first()).toBeVisible();
      for (const badge of await badges.all()) {
        await expect(badge).toHaveAttribute('data-testid', 'status-badge-waiting');
      }
    } finally {
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 7. Reset filters — returns to unfiltered page 1 ─────────────────────

  test('7. Reset filters — returns to initial state', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    const recordId = record.id;
    const clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Apply a status filter (same response-wait as test 6)
      const filterResponse = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('status=waiting'),
        { timeout: 10_000 },
      );
      await page.locator('[data-testid="booking-filters-status-trigger"]').click();
      await page.locator('[data-testid="booking-filters-status-option-waiting"]').click();
      await filterResponse;

      // Also apply a dictionary filter — Combobox flow, first real option
      const dictFilterWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('location_id='),
        { timeout: 10_000 },
      );
      await openCombobox(page, page.getByLabel('Фильтр по локации'));
      await page.locator('[data-testid^="combobox-option-"]').nth(1).click();
      await dictFilterWait;

      const filteredCount = await page.locator('tbody tr').count();
      const filteredTotal = await readServerTotal(page);

      // Click reset. NOTE: after reset the query key returns to the initial
      // unfiltered page-1 entry, which is still fresh (global staleTime 30s),
      // so React Query serves it from cache — no network request fires. The
      // honest assertions are therefore: (a) no records request WITH status=
      // may fire after reset (negative watch), (b) post-state below.
      const staleStatusRequest = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('status='),
        { timeout: 5_000 },
      ).then(() => 'fired').catch(() => 'none');
      await page.locator('button:has-text("Сбросить")').click();
      expect(await staleStatusRequest).toBe('none');

      // All filter controls back to defaults — Combobox triggers show the
      // «Все …» clear labels again
      await expect(page.getByLabel('Фильтр по локации')).toHaveText(/Все локации/);
      await expect(page.getByLabel('Фильтр по услуге')).toHaveText(/Все услуги/);
      await expect(page.getByLabel('Фильтр по мастеру')).toHaveText(/Все мастера/);
      await expect(page.locator('[data-testid="booking-filters-status-trigger"]')).toContainText('Все статусы');

      // Row count and server total grew or stayed equal after reset
      const resetCount = await page.locator('tbody tr').count();
      expect(resetCount).toBeGreaterThanOrEqual(filteredCount);
      const resetTotal = await readServerTotal(page);
      expect(resetTotal).toBeGreaterThanOrEqual(filteredTotal);
    } finally {
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 8. Click row — opens detail panel ────────────────────────────────────

  test('8. Click row — opens detail panel', async ({ page, request }) => {
    const client = await createTestClient(request, { name: 'Detail Panel Test' });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    const recordId = record.id;
    const clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Ensure we have at least one row
      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Click the first row
      await firstRow.click();

      // Detail panel should appear with "Детали записи" heading
      await expect(page.locator('h3:has-text("Детали записи")')).toBeVisible({ timeout: 5000 });

      // Panel should contain client info section
      await expect(page.locator('text=Клиент').first()).toBeVisible();

      // Panel should contain activity info section
      await expect(page.locator('text=Занятие')).toBeVisible();
    } finally {
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 9. Click row again — closes detail panel ─────────────────────────────

  test('9. Click row again — closes detail panel', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    const recordId = record.id;
    const clientId = client.id;

    try {
      await waitForRecordsReady(page);

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Click to open detail panel
      await firstRow.click();
      await expect(page.locator('h3:has-text("Детали записи")')).toBeVisible({ timeout: 5000 });

      // Click again to close
      await firstRow.click();

      // Detail panel should disappear
      await expect(page.locator('h3:has-text("Детали записи")')).not.toBeVisible();
    } finally {
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 10. Detail panel close button ────────────────────────────────────────

  test('10. Detail panel close button dismisses panel', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    const recordId = record.id;
    const clientId = client.id;

    try {
      await waitForRecordsReady(page);

      const firstRow = page.locator('tbody tr').first();
      await expect(firstRow).toBeVisible();

      // Open detail panel
      await firstRow.click();
      await expect(page.locator('h3:has-text("Детали записи")')).toBeVisible({ timeout: 5000 });

      // Click the close button (✕) in the detail panel
      await page.locator('button[aria-label="Закрыть"]').click();

      // Detail panel should disappear — wait for heading to be removed from DOM
      await expect(page.locator('h3:has-text("Детали записи")')).not.toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 11. Sorting — click header toggles server sort direction ─────────────

  test('11. Sorting — click header toggles sort direction', async ({ page, request }) => {
    // Seed 3 records with different clients for deterministic sort test
    const ts = Date.now();
    const seeded = [
      await createTestRecordWithClient(request, `АClient-${ts}`),
      await createTestRecordWithClient(request, `БClient-${ts + 1}`),
      await createTestRecordWithClient(request, `ВClient-${ts + 2}`),
    ];

    try {
      await waitForRecordsReady(page);

      // Expand date filter to ensure seeded records are visible regardless
      // of the default week range — each fill triggers a server request.
      const dateFromWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('date_from=2020-01-01'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате от"]').fill('2020-01-01');
      await dateFromWait;
      const dateToWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('date_to=2030-12-31'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате до"]').fill('2030-12-31');
      await dateToWait;

      // Find the "Клиент" header
      const clientHeader = page.locator('table thead th').filter({ hasText: 'Клиент' });
      await expect(clientHeader).toBeVisible();

      const getName = async (index: number) =>
        page.locator('tbody tr').nth(index).locator('td').nth(1).textContent();

      // Wait for at least 3 rows (our seeded records)
      await expect
        .poll(async () => page.locator('tbody tr').count(), { timeout: 10_000 })
        .toBeGreaterThanOrEqual(3);

      // First click on a NEW sort field → server request with sort_order=asc
      const ascWait = page.waitForResponse(
        (r) => r.url().includes('sort_by=client') && r.url().includes('sort_order=asc'),
        { timeout: 10_000 },
      );
      await clientHeader.click();
      await ascWait;

      const rowCount = await page.locator('tbody tr').count();
      const afterFirstAsc = await getName(0);
      const afterLastAsc = await getName(rowCount - 1);

      // Second click on the SAME field → toggles to sort_order=desc
      const descWait = page.waitForResponse(
        (r) => r.url().includes('sort_by=client') && r.url().includes('sort_order=desc'),
        { timeout: 10_000 },
      );
      await clientHeader.click();
      await descWait;

      const afterFirstDesc = await getName(0);

      // Ascending and descending have different first elements (unless all same)
      if (afterFirstAsc !== afterLastAsc) {
        expect(afterFirstDesc).not.toBe(afterFirstAsc);
      }

      // Sort indicator shows descending after the second click
      await expect(clientHeader).toContainText('↓');
    } finally {
      for (const s of seeded) {
        await cleanupRecord(request, s.recordId);
        await cleanup(request, `/api/v1/clients/${s.clientId}`);
      }
    }
  });

  // ── 12. Pagination — server total + page 2 disjoint ──────────────────────

  test('12. Pagination — server total and page navigation', async ({ page, request }) => {
    // Seed 12 records (> default per_page=10) on current-week activities.
    // Seed records r1-r6 live in the fixed week 2026-06-15, so the current-week
    // server total is driven by our 12 records alone.
    const ts = Date.now();
    const seeded = [];
    for (let i = 0; i < 12; i++) {
      seeded.push(await createTestRecordWithClient(request, `PgClient-${ts}-${i}`));
    }

    try {
      await waitForRecordsReady(page);

      // "N всего" reflects the server total — at least our 12 records
      const total = await readServerTotal(page);
      expect(total).toBeGreaterThanOrEqual(12);

      // Page 1: collect client names (unique per seeded record; the date
      // column is useless for disjointness — all activities share "now")
      const pageOneNames = await page
        .locator('tbody tr td:nth-child(2)')
        .allTextContents();
      expect(pageOneNames.length).toBe(10); // default per_page

      // Navigate to page 2 — server request carries page=2
      const pageTwoWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('page=2'),
        { timeout: 10_000 },
      );
      await page.getByRole('button', { name: '2', exact: true }).click();
      await pageTwoWait;

      // Page 2 rows are disjoint from page 1 rows
      const pageTwoNames = await page
        .locator('tbody tr td:nth-child(2)')
        .allTextContents();
      expect(pageTwoNames.length).toBeGreaterThanOrEqual(2);
      for (const name of pageTwoNames) {
        expect(pageOneNames).not.toContain(name);
      }
    } finally {
      for (const s of seeded) {
        await cleanupRecord(request, s.recordId);
        await cleanup(request, `/api/v1/clients/${s.clientId}`);
      }
    }
  });

  // ── 13. Empty state — no records match filter ────────────────────────────

  test('13. Empty state — shows message when no records match', async ({ page }) => {
    await waitForRecordsReady(page);

    // Narrow date range no seed data shares (seed weeks are relative to
    // today plus the fixed week 2026-06-15) — each fill is a server request.
    const dateFromWait = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records') && r.url().includes('date_from=2020-01-01'),
      { timeout: 10_000 },
    );
    await page.locator('input[aria-label="Фильтр по дате от"]').fill('2020-01-01');
    await dateFromWait;
    const dateToWait = page.waitForResponse(
      (r) => r.url().includes('/api/v1/records') && r.url().includes('date_to=2020-01-02'),
      { timeout: 10_000 },
    );
    await page.locator('input[aria-label="Фильтр по дате до"]').fill('2020-01-02');
    await dateToWait;

    // Server returned an empty page for that range. Addendum #12 (user
    // ruling): empty copy unified to «Нет записей» for all 8 tables — the
    // pre-#139 «Записи не найдены» is retired with the T8 migration.
    await expect(page.locator('td:has-text("Нет записей")')).toBeVisible();
  });

  // ── 14. Client name is clickable — opens client card modal ───────────────

  test('14. Client name is clickable in table', async ({ page, request }) => {
    const client = await createTestClient(request, { name: 'Clickable Client' });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    const recordId = record.id;
    const clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Find the client name button in the table
      const clientButton = page.locator('tbody button').filter({ hasText: client.name });

      if (await clientButton.isVisible()) {
        // Click the client name button
        await clientButton.click();

        // Client card modal should appear (has the client name in a header)
        // The modal uses fixed positioning with z-50
        const modal = page.locator('.fixed.z-50');
        await expect(modal).toBeVisible({ timeout: 5000 });

        // Modal should show the client name
        await expect(modal.locator(`text=${client.name}`)).toBeVisible();

        // Close the modal
        await modal.locator('button[aria-label="Закрыть"]').click();
        await expect(modal).not.toBeVisible();
      }
    } finally {
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 15. Status badges — correct styling per status ──────────────────────

  test('15. Status badges — display correct text for statuses', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    const recordId = record.id;
    const clientId = client.id;

    try {
      await waitForRecordsReady(page);

      // Expand date filter via server requests so the seeded record is visible
      const dateFromWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('date_from=2020-01-01'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате от"]').fill('2020-01-01');
      await dateFromWait;
      const dateToWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('date_to=2030-12-31'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате до"]').fill('2030-12-31');
      await dateToWait;

      // Filter by waiting status via StatusFiltersPicker — server request
      const filterResponse = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('status=waiting'),
        { timeout: 10_000 },
      );
      await page.locator('[data-testid="booking-filters-status-trigger"]').click();
      await page.locator('[data-testid="booking-filters-status-option-waiting"]').click();
      await filterResponse;

      // Find the status badge in the table — use data-testid for robustness
      const statusBadge = page.locator('[data-testid="status-badge-waiting"]').first();

      // Badge should contain the status text
      await expect(statusBadge).toBeVisible({ timeout: 10_000 });
      await expect(statusBadge).toContainText('Ожидание');

      // Badge should have amber styling (for "waiting" / "Ожидание" status)
      const classes = await statusBadge.getAttribute('class');
      expect(classes).toContain('amber');
    } finally {
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 16. Filter by location — server filters rows ─────────────────────────

  test('16. Filter by location — narrows results', async ({ page, request }) => {
    // Seed a record on a known activity to learn a real location_id
    const clientName = `LocFilter ${Date.now()}`;
    const seeded = await createTestRecordWithClient(request, clientName);

    try {
      const actResp = await request.get(`${BACKEND}/api/v1/activities/${seeded.activityId}`);
      expect(actResp.ok()).toBeTruthy();
      const activity = await actResp.json();

      const locResp = await request.get(`${BACKEND}/api/v1/locations`);
      const locations = (await locResp.json()).items ?? [];
      const locationName = locations.find((l: any) => l.id === activity.location_id)?.name;
      expect(locationName).toBeTruthy();

      await waitForRecordsReady(page);

      // Select that location — server request carries location_id=
      const filterResponse = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records') &&
          r.url().includes(`location_id=${activity.location_id}`),
        { timeout: 10_000 },
      );
      await searchAndSelect(
        page,
        page.getByLabel('Фильтр по локации'),
        locationName,
        activity.location_id,
      );
      await filterResponse;

      // Post-state: our seeded record's row shows the selected location
      const ourRow = page.locator('tbody tr').filter({ hasText: clientName });
      await expect(ourRow.first().locator('td').nth(5)).toHaveText(locationName);

      // Every other visible row shows the same location — or "—" when the row
      // belongs to a parallel worker's record whose activity is not in the
      // frontend's (stale, date-scoped) activities map yet. A row showing a
      // DIFFERENT location name is a genuine filter violation and fails.
      const rows = page.locator('tbody tr');
      for (const row of await rows.all()) {
        const text = (await row.locator('td').nth(5).textContent())?.trim();
        expect([locationName, '—']).toContain(text);
      }
    } finally {
      await cleanupRecord(request, seeded.recordId);
      await cleanup(request, `/api/v1/clients/${seeded.clientId}`);
    }
  });

  // ── 17. Filter by service — server filters rows ──────────────────────────

  test('17. Filter by service — narrows results', async ({ page, request }) => {
    // Seed a record on a known activity to learn a real service_id
    const clientName = `SvcFilter ${Date.now()}`;
    const seeded = await createTestRecordWithClient(request, clientName);

    try {
      const actResp = await request.get(`${BACKEND}/api/v1/activities/${seeded.activityId}`);
      expect(actResp.ok()).toBeTruthy();
      const activity = await actResp.json();

      const svcResp = await request.get(`${BACKEND}/api/v1/services`);
      const services = (await svcResp.json()).items ?? [];
      const serviceTitle = services.find((s: any) => s.id === activity.service_id)?.title;
      expect(serviceTitle).toBeTruthy();

      await waitForRecordsReady(page);

      // Select that service — server request carries service_id=
      const filterResponse = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records') &&
          r.url().includes(`service_id=${activity.service_id}`),
        { timeout: 10_000 },
      );
      await searchAndSelect(
        page,
        page.getByLabel('Фильтр по услуге'),
        serviceTitle,
        activity.service_id,
      );
      await filterResponse;

      // Post-state: our seeded record's row shows the selected service
      const ourRow = page.locator('tbody tr').filter({ hasText: clientName });
      await expect(ourRow.first().locator('td').nth(3)).toContainText(serviceTitle);

      // Every other visible row shows the same service — or "—" when the row
      // belongs to a parallel worker's record whose activity is not in the
      // frontend's (stale, date-scoped) activities map yet. A row showing a
      // DIFFERENT service title is a genuine filter violation and fails.
      const rows = page.locator('tbody tr');
      for (const row of await rows.all()) {
        const text = (await row.locator('td').nth(3).textContent())?.trim() ?? '';
        if (text !== '—') {
          expect(text).toContain(serviceTitle);
        }
      }
    } finally {
      await cleanupRecord(request, seeded.recordId);
      await cleanup(request, `/api/v1/clients/${seeded.clientId}`);
    }
  });

  // ── 18. Multiple filters — URL accumulates both params ───────────────────

  test('18. Multiple filters — compound filtering accumulates params', async ({
    page,
    request,
  }) => {
    // Seed a record on a known activity to learn a real master_id
    const seeded = await createTestRecordWithClient(request, `CompoundFilter ${Date.now()}`);

    try {
      const actResp = await request.get(`${BACKEND}/api/v1/activities/${seeded.activityId}`);
      expect(actResp.ok()).toBeTruthy();
      const activity = await actResp.json();

      // Learn the master's surname fragment for the Combobox search
      // («Фамилия Имя» option labels)
      const mastersResp = await request.get(`${BACKEND}/api/v1/masters`);
      const mastersList = (await mastersResp.json()).items ?? [];
      const masterSurname = mastersList.find((m: any) => m.id === activity.master_id)?.last_name;
      expect(masterSurname).toBeTruthy();

      await waitForRecordsReady(page);

      // First filter: status=waiting
      const statusWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('status=waiting'),
        { timeout: 10_000 },
      );
      await page.locator('[data-testid="booking-filters-status-trigger"]').click();
      await page.locator('[data-testid="booking-filters-status-option-waiting"]').click();
      await statusWait;

      // Second filter: master — the request URL accumulates BOTH params
      const masterWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records') &&
          r.url().includes('status=waiting') &&
          r.url().includes(`master_id=${activity.master_id}`),
        { timeout: 10_000 },
      );
      await searchAndSelect(
        page,
        page.getByLabel('Фильтр по мастеру'),
        masterSurname,
        activity.master_id,
      );
      const masterResponse = await masterWait;

      expect(masterResponse.url()).toContain('status=waiting');
      expect(masterResponse.url()).toContain(`master_id=${activity.master_id}`);

      // Post-state: our seeded record matches both filters; all badges waiting
      const badges = page.locator('tbody tr [data-testid^="status-badge-"]');
      await expect(badges.first()).toBeVisible();
      for (const badge of await badges.all()) {
        await expect(badge).toHaveAttribute('data-testid', 'status-badge-waiting');
      }
    } finally {
      await cleanupRecord(request, seeded.recordId);
      await cleanup(request, `/api/v1/clients/${seeded.clientId}`);
    }
  });

  // ── 19. Price formatting — ruble sign displayed ──────────────────────────

  test('19. Price formatting — ruble sign displayed', async ({ page, request }) => {
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [{ name: `Price Test ${Date.now()}`, price: 3500 }],
    });

    const recordId = record.id;
    const clientId = client.id;

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
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 20. Payment status — displays correctly ──────────────────────────────

  test('20. Payment status — displays payment indicator', async ({ page, request }) => {
    // Seed one record with a payment to guarantee indicator presence
    const { clientId, recordId, paymentId } = await createTestRecordWithPayment(
      request,
      'Оплачено',
    );

    try {
      await waitForRecordsReady(page);

      // Expand date filter via server requests so the seeded record is visible
      const dateFromWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('date_from=2020-01-01'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате от"]').fill('2020-01-01');
      await dateFromWait;
      const dateToWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('date_to=2030-12-31'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате до"]').fill('2030-12-31');
      await dateToWait;

      // Wait for at least one row to appear (our seeded record)
      await expect
        .poll(async () => page.locator('tbody tr').count(), { timeout: 10_000 })
        .toBeGreaterThan(0);

      // Look for payment status indicators in the table
      const paymentIndicators = page.locator('tbody td').filter({
        hasText: /Оплачено|Частично|Не оплачено/,
      });

      // At least one row should have a payment indicator
      const indicatorCount = await paymentIndicators.count();
      expect(indicatorCount).toBeGreaterThan(0);
    } finally {
      if (paymentId) {
        await cleanup(request, `/api/v1/payments/${paymentId}`);
      }
      await cleanupRecord(request, recordId);
      await cleanup(request, `/api/v1/clients/${clientId}`);
    }
  });

  // ── 21. Sorting by payment — ascending groups paid first ─────────────────

  test('21. Sorting by payment — ascending order is Оплачено → Частично → Не оплачено', async ({
    page,
    request,
  }) => {
    // Isolation (spec §9.3): three records on explicitly early-dated activities
    // inside a narrow range no seed data shares (seed weeks are relative to
    // today plus the fixed week 2026-06-15). One record per payment bucket.
    const mkRecord = async (bucket: 'full' | 'partial' | 'none') => {
      const client = await createTestClient(request);
      const activity = await createTestActivity(request, { start: '2026-01-05T10:00:00' });
      const record = await createTestRecord(request, activity.id, client.id);
      let paymentId: string | null = null;
      const amount = bucket === 'full' ? 3500 : bucket === 'partial' ? 1500 : 0;
      if (amount > 0) {
        const resp = await request.post(`${BACKEND}/api/v1/payments`, {
          data: { record_id: record.id, amount, method: 'card' },
        });
        expect(resp.ok()).toBeTruthy();
        paymentId = (await resp.json()).id;
      }
      return { clientId: client.id, recordId: record.id, paymentId };
    };

    const seeded = [await mkRecord('full'), await mkRecord('partial'), await mkRecord('none')];

    try {
      await waitForRecordsReady(page);

      // Narrow the date range to the isolated window — server requests
      const dateFromWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('date_from=2026-01-01'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате от"]').fill('2026-01-01');
      await dateFromWait;
      const dateToWait = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes('date_to=2026-01-10'),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Фильтр по дате до"]').fill('2026-01-10');
      await dateToWait;

      // Click "Оплата" header — first click on a new field sends asc.
      // Predicate matches the full param set (waitForResponse binds the FIRST
      // matching response).
      const sortWait = page.waitForResponse(
        (r) => r.url().includes('sort_by=payment') && r.url().includes('sort_order=asc'),
        { timeout: 10_000 },
      );
      await page.locator('table thead th').filter({ hasText: 'Оплата' }).click();
      await sortWait;

      // Exactly our three isolated records, paid buckets top → bottom
      const rows = page.locator('tbody tr');
      await expect(rows).toHaveCount(3);
      const paymentCell = (i: number) => rows.nth(i).locator('td').nth(8);
      await expect(paymentCell(0)).toContainText('Оплачено');
      await expect(paymentCell(1)).toContainText('Частично');
      await expect(paymentCell(2)).toContainText('Не оплачено');
    } finally {
      for (const s of seeded) {
        if (s.paymentId) {
          await cleanup(request, `/api/v1/payments/${s.paymentId}`);
        }
        await cleanupRecord(request, s.recordId);
        await cleanup(request, `/api/v1/clients/${s.clientId}`);
      }
    }
  });

  // ── 22. Action dropdown smoke — ⋯ menu, Удалить → DeleteDialog, cancel ──

  test('22. Dropdown smoke — ⋯ opens menu, Удалить opens DeleteDialog, cancel closes', async ({
    page,
    request,
  }) => {
    // T8 smoke (spec §5 scenario 3 + §8): the NEW per-row dropdown replaces
    // the ⋯-less pre-#139 table. Factory records ALWAYS create one visit →
    // the no-body dry-run DELETE returns 409 + dependency tree → dialog.
    const clientName = `Dropdown Smoke ${Date.now()}`;
    const client = await createTestClient(request, { name: clientName });
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForRecordsReady(page);

      // Scope to our seeded row by the unique client name (records carries
      // no row testids — Addendum 6: no pre-#139 prefix existed).
      const row = page.locator('tbody tr').filter({ hasText: clientName });
      await expect(row).toBeVisible();

      // ⋯ opens the APG menu — role=menu + data-testid dropdown-<id>
      // (Addendum 4 unification).
      await row.getByRole('button', { name: 'Действия' }).click();
      const menu = page.locator(`[data-testid="dropdown-${record.id}"]`);
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('role', 'menu');

      // «Удалить» fires the dry-run DELETE (no body) → 409 conflict (the
      // record has a visit) → DeleteDialog opens (Addendum 13 / spec §6.9).
      const dryRun = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/records/${record.id}`) &&
          r.request().method() === 'DELETE' &&
          r.request().postData() === null,
        { timeout: 10_000 },
      );
      await menu.getByRole('menuitem', { name: 'Удалить' }).click();
      const dryRunResponse = await dryRun;
      expect(dryRunResponse.status()).toBe(409);
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();

      // Cancel closes the dialog without executing the delete.
      await page.getByTestId('delete-dialog-cancel-btn').click();
      await expect(page.locator('[data-testid="delete-dialog"]')).not.toBeVisible();

      // The row survives the cancelled delete.
      await expect(row).toBeVisible();
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── 23. Search — location filter + client-name q → only matching row ────

  test('23. Search — location filter plus client-name fragment narrows to the matching record', async ({
    page,
    request,
  }) => {
    // GH #212 Task 12 (scenario 2): two records, different clients, SAME
    // activity (hence same location). Location filter alone returns both;
    // typing a fragment of client A's name sends ?q= → only A's row remains
    // and the pager total reflects the narrowed result.
    const ts = Date.now();
    const nameA = `QSearchA-${ts}`;
    const nameB = `QSearchB-${ts}`;
    const clientA = await createTestClient(request, { name: nameA });
    const clientB = await createTestClient(request, { name: nameB });
    const activity = await createTestActivity(request);
    const recordA = await createTestRecord(request, activity.id, clientA.id);
    const recordB = await createTestRecord(request, activity.id, clientB.id);

    try {
      // Learn the location name for the Combobox search
      const locResp = await request.get(`${BACKEND}/api/v1/locations`);
      const locations = (await locResp.json()).items ?? [];
      const locationName = locations.find((l: any) => l.id === activity.location_id)?.name;
      expect(locationName).toBeTruthy();

      await waitForRecordsReady(page);

      // Location filter → server request carries location_id= (both rows match)
      const locationWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records') &&
          r.url().includes(`location_id=${activity.location_id}`),
        { timeout: 10_000 },
      );
      await searchAndSelect(
        page,
        page.getByLabel('Фильтр по локации'),
        locationName,
        activity.location_id,
      );
      await locationWait;

      // Type client A's unique name fragment into the search input —
      // 300ms debounce, then the request accumulates location_id= AND q=.
      const qFragment = `QSearchA-${ts}`;
      const searchWait = page.waitForResponse(
        (r) =>
          r.url().includes('/api/v1/records') &&
          r.url().includes(`location_id=${activity.location_id}`) &&
          r.url().includes('q='),
        { timeout: 10_000 },
      );
      await page.locator('input[aria-label="Поиск по клиенту или услуге"]').fill(qFragment);
      const searchResponse = await searchWait;
      expect(searchResponse.url()).toContain(`q=${qFragment}`);

      // Post-state: exactly one row — client A's record; client B is gone.
      const rows = page.locator('tbody tr');
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText(nameA);
      await expect(rows.first()).not.toContainText(nameB);

      // Pager total reflects the filtered result.
      await expect.poll(() => readServerTotal(page), { timeout: 10_000 }).toBe(1);
    } finally {
      await cleanupRecord(request, recordA.id);
      await cleanupRecord(request, recordB.id);
      await cleanup(request, `/api/v1/clients/${clientA.id}`);
      await cleanup(request, `/api/v1/clients/${clientB.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });
});
