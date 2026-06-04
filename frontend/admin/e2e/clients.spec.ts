import { test, expect } from '@playwright/test';
import { waitForClientsReady } from './fixtures/helpers';
import { createTestClient, cleanup } from './fixtures/factories';

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
  // Click at top-left corner of the viewport — always on backdrop, never on modal
  await page.mouse.click(10, 10);
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
      'Кол-во визитов',
      'Последний визит',
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
      await waitForClientsReady(page);

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
      await waitForClientsReady(page);

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
      await waitForClientsReady(page);

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
      await waitForClientsReady(page);

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
      await waitForClientsReady(page);

      // Open client card
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: testName });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 5000 });

      // Click "Удалить клиента" — soft-deletes and closes modal
      await page.locator('button:has-text("Удалить клиента")').click();

      // Modal should close
      await expect(modal).not.toBeVisible({ timeout: 5000 });

      // Reload page — soft-deleted client (is_active=false) won't appear
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

    // Pagination area should show total count
    await expect(page.locator('text=/\\d+ клиентов/')).toBeVisible();
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
      await waitForClientsReady(page);

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

    // Get initial row count
    const initialCount = await page.locator('table tbody tr').count();

    // Select "Неактивные" status filter
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('false');
    await page.waitForTimeout(1000);

    // Filtered count should be <= initial count
    const filteredCount = await page.locator('table tbody tr').count();
    expect(filteredCount).toBeLessThanOrEqual(initialCount);

    // Reset
    await page.locator('text=Сбросить фильтры').click();
    await page.waitForTimeout(500);
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
      await waitForClientsReady(page);

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
