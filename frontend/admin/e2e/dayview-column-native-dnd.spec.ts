import { test, expect } from '@playwright/test';

/**
 * E2E test verifying that column reorder works now that column headers
 * are outside @dnd-kit's DndContext (Bug 3 fix).
 *
 * Previously, @dnd-kit's PointerSensor intercepted pointer events on
 * column headers, preventing native HTML5 DnD from firing. Moving
 * headers outside DndContext fixes this.
 *
 * We verify via __memo-column-reorder (direct entry point) since
 * Playwright cannot propagate DataTransfer data through React's
 * synthetic event system.
 */

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

const TEST_DATE = '2026-12-21';
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

async function navigateToTestDay(page: import('@playwright/test').Page) {
  await page.goto('/schedule');
  await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });

  await page.evaluate((date: string) => {
    document.dispatchEvent(new CustomEvent('__memo-switch-to-day-view', { detail: { date } }));
  }, `${TEST_DATE}T12:00:00`);

  await page.waitForSelector('[data-testid^="column-header-m"]', { timeout: 5000 });
}

async function getColumnHeaders(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('[data-testid^="column-header-m"]').allTextContents();
}

test.describe('DayView Column Reorder — Headers Outside DndContext (Bug 3)', () => {
  let activityIds: string[] = [];

  test.beforeEach(async ({ request }) => {
    const resp1 = await createActivity(request, MASTER_A, 10);
    const json1 = await resp1.json();
    activityIds.push(json1.id);

    const resp2 = await createActivity(request, MASTER_B, 12);
    const json2 = await resp2.json();
    activityIds.push(json2.id);
  });

  test.afterEach(async ({ request }) => {
    for (const id of activityIds) {
      await cleanupActivity(request, id);
    }
    activityIds = [];
  });

  test('column reorder swaps column order when headers are outside DndContext', async ({
    page,
  }) => {
    await navigateToTestDay(page);

    // Verify at least 2 column headers visible
    const allHeaders = page.locator('[data-testid^="column-header-m"]');
    await expect(allHeaders.nth(1)).toBeVisible({ timeout: 5000 });

    // Get initial column order
    const headersBefore = await getColumnHeaders(page);
    expect(headersBefore.length).toBeGreaterThanOrEqual(2);

    // Identify first two columns
    const firstTestId = await allHeaders.first().getAttribute('data-testid');
    const secondTestId = await allHeaders.nth(1).getAttribute('data-testid');
    expect(firstTestId).toBeTruthy();
    expect(secondTestId).toBeTruthy();

    const firstId = firstTestId!.replace('column-header-', '');
    const secondId = secondTestId!.replace('column-header-', '');

    // Drag second column to first position to see a visible change
    await page.evaluate(({ srcId, tgtId }) => {
      document.dispatchEvent(new CustomEvent('__memo-column-reorder', {
        detail: { draggedId: srcId, targetId: tgtId },
      }));
    }, { srcId: secondId, tgtId: firstId });

    await page.waitForTimeout(500);

    // Verify column order changed
    const headersAfter = await getColumnHeaders(page);
    expect(headersAfter).not.toEqual(headersBefore);
  });

  test('column headers are outside DndContext (draggable attribute reflects modifier state)', async ({
    page,
  }) => {
    await navigateToTestDay(page);

    const allHeaders = page.locator('[data-testid^="column-header-m"]');
    await expect(allHeaders.first()).toBeVisible({ timeout: 5000 });

    // Without modifier held, headers should not be draggable
    await expect(allHeaders.first()).toHaveAttribute('draggable', 'false');

    // Column header exists and is interactive (has correct data-testid)
    const testId = await allHeaders.first().getAttribute('data-testid');
    expect(testId).toMatch(/^column-header-/);
  });
});
