import { test, expect } from './fixtures/test';
import { gotoScheduleDay } from './fixtures/helpers';

/**
 * E2E: DayView column reorder (GH #138 US-6).
 *
 * Drives the per-column «Переместить влево/вправо» buttons — the production
 * keyboard-accessible reorder controls (SortableColumnHeader.tsx:93-120).
 * Both buttons and the dnd-kit sortable surface commit through the same
 * onColumnDrop → column-order state → patchUserSettings chain, so the
 * user-visible outcome (order change, persistence) is identical.
 *
 * NOTE — dnd-kit KeyboardSensor gap (found during #138 T9, needs a
 * production follow-up): SortableColumnHeader spreads the sortable
 * listeners+attributes on the whole header but never attaches
 * setActivatorNodeRef. Consequences in the browser:
 *   - Space/Enter/arrows on the header start a drag, but arrow moves never
 *     commit (no droppable-rect update → sortableKeyboardCoordinates
 *     returns undefined);
 *   - Enter on the NESTED move-left/move-right <button>s is hijacked by the
 *     sensor (keydown bubbles to the header, preventDefault cancels the
 *     button's default click) — so the buttons are mouse-only today.
 * Pointer clicks (below) are the working interaction and prove the reorder
 * chain; the sensor path needs setActivatorNodeRef + a measuring fix and is
 * out of scope for the e2e migration task.
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
 * Deep-link to the day view of the test date (#138: the URL is the source
 * of truth — /schedule?view=day&date=…).
 */
async function navigateToTestDay(page: import('@playwright/test').Page) {
  await gotoScheduleDay(page, TEST_DATE);

  // Wait for DayView column headers to appear
  await page.waitForSelector('[data-testid^="column-header-m"]', { timeout: 5000 });
}

/**
 * Get current column header names.
 */
async function getColumnHeaders(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('[data-testid^="column-header-m"]').allTextContents();
}

test.describe('DayView Column Reorder (US-6)', () => {
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

  test('column reorder moves column left via the move button', async ({ page }) => {
    await navigateToTestDay(page);

    // Verify at least 2 column headers visible
    const allHeaders = page.locator('[data-testid^="column-header-m"]');
    await expect(allHeaders.nth(1)).toBeVisible({ timeout: 5000 });

    // Get initial column order
    const headersBefore = await getColumnHeaders(page);
    expect(headersBefore.length).toBeGreaterThanOrEqual(2);

    // Move the second column one slot left via its «Переместить влево» button.
    const secondTestId = await allHeaders.nth(1).getAttribute('data-testid');
    expect(secondTestId).toBeTruthy();
    const moveLeft = page.locator(`[data-testid="move-left-${secondTestId!.replace('column-header-', '')}"]`);
    await moveLeft.click();

    // The former second column must now lead; the displaced one follows.
    await expect.poll(async () => (await getColumnHeaders(page))[0], { timeout: 5_000 })
      .toBe(headersBefore[1]);
    const headersAfter = await getColumnHeaders(page);
    expect(headersAfter[1]).toBe(headersBefore[0]);
  });

  test('column order change persists across reload (user settings)', async ({ page }) => {
    await navigateToTestDay(page);

    const allHeaders = page.locator('[data-testid^="column-header-m"]');
    const headersBefore = await getColumnHeaders(page);

    // Move the second column to the front.
    const secondTestId = await allHeaders.nth(1).getAttribute('data-testid');
    const moveLeft = page.locator(`[data-testid="move-left-${secondTestId!.replace('column-header-', '')}"]`);
    await moveLeft.click();
    await expect.poll(async () => (await getColumnHeaders(page))[0], { timeout: 5_000 })
      .toBe(headersBefore[1]);

    // Reload (same deep-linked day URL): the per-user column order survives.
    await page.reload();
    await page.waitForSelector('[data-testid^="column-header-m"]', { timeout: 10_000 });
    const headersAfterReload = await getColumnHeaders(page);
    expect(headersAfterReload[0]).toBe(headersBefore[1]);
  });
});
