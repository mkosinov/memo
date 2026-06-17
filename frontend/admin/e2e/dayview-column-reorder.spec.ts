import { test, expect } from '@playwright/test';

/**
 * E2E tests for DayView column reorder.
 *
 * We use a custom __memo-column-reorder event because Playwright's dragTo() cannot
 * properly propagate DataTransfer data through React's synthetic event system.
 * The same pattern is used for __memo-open-modal (activity details modal).
 */

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

// Use a future date that has no seed data — we create our own activities
const TEST_DATE = '2026-06-20';
const MASTER_A = 'm1';
const MASTER_B = 'm2';
const LOCATION = 'alpika';
const SERVICE = 's1';

async function createActivity(
  request: import('@playwright/test').APIRequestContext,
  masterId: string,
  startHour: number,
) {
  return request.post(`${BACKEND}/api/v1/activities`, {
    data: {
      master_id: masterId,
      service_id: SERVICE,
      location_id: LOCATION,
      start: `${TEST_DATE}T${String(startHour).padStart(2, '0')}:00:00`,
      duration: 120,
      capacity: 8,
      is_private: false,
    },
  });
}

async function cleanupActivity(
  request: import('@playwright/test').APIRequestContext,
  id: string,
) {
  await request.delete(`${BACKEND}/api/v1/activities/${id}`).catch(() => {});
}

/**
 * Navigate to day view and select the test date with activities.
 */
async function navigateToTestDay(page: import('@playwright/test').Page) {
  await page.goto('/schedule');
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });

  // Navigate to test date via custom event
  await page.evaluate((date: string) => {
    document.dispatchEvent(new CustomEvent('__memo-switch-to-day-view', { detail: { date } }));
  }, `${TEST_DATE}T12:00:00`);

  // Wait for DayView column headers to appear
  await page.waitForSelector('[data-testid^="column-header-m"]', { timeout: 5000 });
}

/**
 * Get current column header names.
 */
async function getColumnHeaders(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('[data-testid^="column-header-m"]').allTextContents();
}

/**
 * Simulate column reorder via custom event.
 *
 * Playwright's dragTo() and manual DragEvent dispatch don't work with React's
 * synthetic event system — DataTransfer.setData/getData don't propagate. So we
 * dispatch a custom __memo-column-reorder event that DayView listens to and
 * calls onColumnDrop directly.
 */
async function simulateColumnReorder(
  page: import('@playwright/test').Page,
  draggedId: string,
  targetId: string,
) {
  await page.evaluate(({ src, tgt }) => {
    document.dispatchEvent(new CustomEvent('__memo-column-reorder', {
      detail: { draggedId: src, targetId: tgt },
    }));
  }, { src: draggedId, tgt: targetId });

  // Wait for React state update and re-render
  await page.waitForTimeout(500);
}

test.describe('DayView Column Reorder DnD', () => {
  let activityIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    // Create 2 activities for different masters on the test date
    const resp1 = await createActivity(request, MASTER_A, 10);
    const json1 = await resp1.json();
    activityIds.push(json1.id);

    const resp2 = await createActivity(request, MASTER_B, 11);
    const json2 = await resp2.json();
    activityIds.push(json2.id);
  });

  test.afterEach(async ({ request }) => {
    for (const id of activityIds) {
      await cleanupActivity(request, id);
    }
    activityIds = [];
  });

  test('column reorder swaps column order', async ({ page }) => {
    await navigateToTestDay(page);

    // Verify at least 2 column headers visible
    const allHeaders = page.locator('[data-testid^="column-header-m"]');
    await expect(allHeaders.nth(1)).toBeVisible({ timeout: 5000 });

    // Get initial column order
    const headersBefore = await getColumnHeaders(page);
    expect(headersBefore.length).toBeGreaterThanOrEqual(2);

    // Identify first two column testids
    const firstTestId = await allHeaders.first().getAttribute('data-testid');
    const secondTestId = await allHeaders.nth(1).getAttribute('data-testid');
    expect(firstTestId).toBeTruthy();
    expect(secondTestId).toBeTruthy();

    const draggedId = firstTestId!.replace('column-header-', '');
    const targetId = secondTestId!.replace('column-header-', '');

    // Reorder: drag SECOND column to FIRST position to see a visible change
    await simulateColumnReorder(page, targetId, draggedId);

    // Get new column order
    const headersAfter = await getColumnHeaders(page);

    // Assert order changed
    expect(headersAfter).not.toEqual(headersBefore);
  });
});
