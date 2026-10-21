import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import { gotoScheduleDay } from './fixtures/helpers';
import { seedId } from './fixtures/seed-ids';

/**
 * E2E: DayView column reorder with the KEYBOARD (GH #138 US-6).
 *
 * Primary path — dnd-kit KeyboardSensor on the focused sortable header:
 *   Space        pick up the column
 *   ArrowLeft    move it one slot left (over → the left sibling)
 *   Space        drop → onColumnDrop → user-settings persistence
 *
 * GH #138 fix: SortableColumnHeader now attaches setActivatorNodeRef to the
 * element carrying {...listeners}. Without it the KeyboardSensor activated
 * (aria-pressed) but could not resolve/focus/measure the activator, so arrow
 * presses never moved the dragged rect and drops were no-ops; the header also
 * swallowed Enter on the nested move-left/right buttons.
 *
 * The «Переместить влево/вправо» buttons remain a separate pointer-operable
 * UI; one operability assertion guards regression #2 (Enter on the button
 * must click the button, not start a header drag).
 */

const BACKEND = resolveBackendUrl();

// GH #491: seed ids resolve at TEST runtime (beforeAll) — the module stays
// DB-free at import: CI's `playwright --list` collects specs before the
// shard stack seeds the DB.
test.beforeAll(() => {
  MASTER_A = seedId('staff', 'last_name', 'Середа');
  MASTER_B = seedId('staff', 'last_name', 'Большакова');
  LOCATION = seedId('locations', 'title', 'Альпика');
  SERVICE = seedId('services', 'title', 'Картина маслом');
});


// Use a fixed date — we create our own activities there (GH #491: seed ids
// are UUIDs; staff/location/service resolve by business keys).
const TEST_DATE = '2026-06-20';
let MASTER_A = '';
let MASTER_B = '';
let LOCATION = '';
let SERVICE = '';

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
  await page.waitForSelector('[data-testid^="column-header-"]', { timeout: 5000 });
}

/**
 * Get current column header names.
 */
async function getColumnHeaders(page: import('@playwright/test').Page): Promise<string[]> {
  return page.locator('[data-testid^="column-header-"]').allTextContents();
}

/**
 * Move the focused, currently-grabbed column one slot LEFT and settle before
 * dropping. Empirically (probe-verified on this grid): the first ArrowLeft
 * commits over → the left sibling but its translate lands on a later press,
 * so press twice, then wait until the dragged rect rests displaced (non-zero
 * transform) — dropping inside the re-measure window resolves over=null and
 * the reorder is a no-op.
 */
async function settleMoveLeftThenDrop(page: import('@playwright/test').Page, header: ReturnType<typeof page.locator>) {
  await page.keyboard.press('ArrowLeft'); // over → the left sibling
  await page.waitForTimeout(150);
  await page.keyboard.press('ArrowLeft'); // settle translate onto the sibling's rect
  await expect
    .poll(() => header.evaluate((el) => el.style.transform), { timeout: 5_000 })
    .toContain('translate3d(-');
  await page.keyboard.press('Space'); // drop
}

test.describe('DayView Column Reorder — keyboard (US-6)', () => {
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

  test('Space lifts, ArrowLeft moves, Space drops — column order changes', async ({ page }) => {
    await navigateToTestDay(page);

    const allHeaders = page.locator('[data-testid^="column-header-"]');
    await expect(allHeaders.nth(1)).toBeVisible({ timeout: 5000 });

    const headersBefore = await getColumnHeaders(page);
    expect(headersBefore.length).toBeGreaterThanOrEqual(2);

    // Focus the SECOND column and drive the keyboard drag.
    const header = allHeaders.nth(1);
    await header.focus();
    await page.keyboard.press('Space'); // pick up

    // dnd-kit marks the activator pressed while the keyboard drag is active.
    await expect(header).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

    // Move one slot left and drop once the dragged rect has settled.
    await settleMoveLeftThenDrop(page, header);

    // The former second column must now lead; the displaced one follows.
    await expect.poll(async () => (await getColumnHeaders(page))[0], { timeout: 10_000 })
      .toBe(headersBefore[1]);
    const headersAfter = await getColumnHeaders(page);
    expect(headersAfter[1]).toBe(headersBefore[0]);
    // Everything else kept its relative order.
    expect(headersAfter.slice(2)).toEqual(headersBefore.slice(2));
  });

  test('keyboard reorder persists across reload (user settings)', async ({ page }) => {
    await navigateToTestDay(page);

    const allHeaders = page.locator('[data-testid^="column-header-"]');
    const headersBefore = await getColumnHeaders(page);

    // Keyboard reorder: grab the second column, move left, drop.
    const header = allHeaders.nth(1);
    await header.focus();
    await page.keyboard.press('Space');
    await expect(header).toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 });

    // GH #478-class save/reload race (PR #514 shard 1, «Flaky: 1»): the drop
    // persists the new order as a fire-and-forget PATCH /api/v1/user-settings
    // (useColumnReorder → patchUserSettings, no await) — the DOM poll below
    // passes on the React commit alone, so under CI load page.reload() could
    // beat the still-in-flight write: the fresh boot's GET /user-settings
    // would read the OLD row and re-seed the pre-reorder order. Arm the
    // listener BEFORE the drop (waitForResponse only sees responses from
    // now on), then await its 200 — response receipt means the backend row
    // is committed, so the reload deterministically reads the NEW order.
    // Same guard family as #479 (records.spec.ts expect.poll race-guard)
    // and the user-settings-guarantee.spec.ts С3 waitForResponse corridor.
    const settingsSaved = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/user-settings')
        && resp.request().method() === 'PATCH',
      { timeout: 30_000 },
    );
    await settleMoveLeftThenDrop(page, header);
    expect((await settingsSaved).status()).toBe(200);
    await expect.poll(async () => (await getColumnHeaders(page))[0], { timeout: 10_000 })
      .toBe(headersBefore[1]);

    // Reload on the same deep-linked day URL: the per-user column order survives.
    await page.reload();
    await page.waitForSelector('[data-testid^="column-header-"]', { timeout: 10_000 });
    const headersAfterReload = await getColumnHeaders(page);
    expect(headersAfterReload[0]).toBe(headersBefore[1]);
  });

  test('Enter on the move-left button clicks it (no key hijack by the header drag sensor)', async ({ page }) => {
    await navigateToTestDay(page);

    const allHeaders = page.locator('[data-testid^="column-header-"]');
    const headersBefore = await getColumnHeaders(page);

    // Regression guard (GH #138): Enter on the nested move-left button used to
    // be swallowed by the header's KeyboardSensor (preventDefault) — it had to
    // click the button instead of starting a header drag.
    const secondTestId = await allHeaders.nth(1).getAttribute('data-testid');
    const moveLeft = page.locator(`[data-testid="move-left-${secondTestId!.replace('column-header-', '')}"]`);
    await moveLeft.focus();
    await page.keyboard.press('Enter');

    await expect.poll(async () => (await getColumnHeaders(page))[0], { timeout: 10_000 })
      .toBe(headersBefore[1]);
    // The header itself never entered drag mode.
    await expect(allHeaders.nth(1)).not.toHaveAttribute('aria-pressed', 'true');
  });
});
