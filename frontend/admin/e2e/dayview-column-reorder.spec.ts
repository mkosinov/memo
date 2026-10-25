import { resolveBackendUrl } from './lib/backend-url';
import { test, expect } from './fixtures/test';
import { gotoScheduleDay } from './fixtures/helpers';
import { seedId } from './fixtures/seed-ids';
import {
  DND_LIVE_REGION_SELECTOR,
  activeIdFromAnnouncement,
  hasLeftSelf,
} from './lib/dnd-announcements';

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
 * dropping. State machine per spec #535 §Часть 3 (US-4): behave like a live
 * human — «нажал, не подвинулось — нажал ещё раз» (pressed, didn't move —
 * pressed again).
 *
 * PROBE ARTIFACT (шаг 0, dev grid 2026-10-25; installed @dnd-kit core
 * 6.3.1 + accessibility 3.1.1, 4/4 drags identical — see
 * e2e/lib/dnd-announcements.ts for the announcement strings):
 *   Space        → announcement "moved over droppable area X" (self-over;
 *                  "Picked up …" is superseded within the pickup commit),
 *                  transform translate3d(0px, …)
 *   ArrowLeft #1 → announcement "is no longer over a droppable area.",
 *                  transform '' (the pickup transform wiped)
 *   ArrowLeft #2 → announcement "moved over droppable area Y" (Y≠X — the
 *                  left sibling) AND translate3d(-164px, …) in the SAME
 *                  commit; a further press is a no-op
 * Because the over-commit to the sibling and the settle translate land in
 * one commit, the settle polls below (kept verbatim from :103–109) can only
 * pass on the press that leaves the drag OFF the sibling — so the move
 * phase's success predicate is «the drag has left X» (moved over Y≠X OR no
 * longer over), and its retry condition is the spec's own «the last
 * announcement still names X, or nothing new has arrived» (a swallowed
 * press leaves the self-over/pickup text in place).
 *
 * Machine: pickup (unchanged, done by the caller: Space + aria-pressed
 * guard) → move phase: ArrowLeft (≤3 attempts), poll (≤2 s) the dnd-kit
 * announcements node until the drag has left X → settle phase UNCHANGED
 * (poll transform '', then the single settle ArrowLeft — always one press,
 * NOT counted in the ≤3 limit — then poll translate3d(-) → drop (Space).
 * Attempt exhaustion fails the test with the announcements node text for
 * recurrence diagnostics (spec state 5). Every observable is gated on its
 * own DOM state (#479/#138 poll-guard pattern, GH #499): under CI load a
 * fixed nap between presses can desynchronize the choreography and turn
 * the drop into a no-op.
 */
const MAX_MOVE_ATTEMPTS = 3;

async function settleMoveLeftThenDrop(page: import('@playwright/test').Page, header: ReturnType<typeof page.locator>) {
  // Locate the dnd-kit announcements node among the several live regions the
  // page may carry (several #DndLiveRegion-N nodes can sit in the DOM; the
  // first in DOM order may be an empty stale one — unified-rows.spec.ts:570)
  // and fix the dragged column id X from its current (pickup) announcement.
  let ann: ReturnType<typeof page.locator> | null = null;
  let activeId = '';
  try {
    await expect
      .poll(
        async () => {
          const regions = page.locator(DND_LIVE_REGION_SELECTOR);
          for (let i = 0; i < await regions.count(); i++) {
            const region = regions.nth(i);
            const id = activeIdFromAnnouncement((await region.textContent()) ?? '');
            if (id) {
              ann = region;
              activeId = id;
              return true;
            }
          }
          return false;
        },
        { timeout: 5_000 },
      )
      .toBe(true);
  } catch {
    const dump = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[aria-live], [role="status"]')).map(
        (el) => `<${el.tagName.toLowerCase()} id="${el.id}" aria-live="${el.getAttribute('aria-live')}">${(el.textContent || '').trim()}</${el.tagName.toLowerCase()}>`,
      ),
    );
    throw new Error(
      `dnd-kit announcements node never spoke after pickup: no ${DND_LIVE_REGION_SELECTOR} node carries a "Draggable item …" announcement. Live regions on the page: ${dump.join(' | ')}`,
    );
  }
  if (!ann) throw new Error('unreachable: announcements poll passed without a node');
  // Explicit type: TS's closure-blind flow analysis narrows `ann` to `never`
  // here (assignments inside the poll callback above are not tracked).
  const announcer: import('@playwright/test').Locator = ann;

  // Move phase: press ArrowLeft until the announcements confirm the drag has
  // left its own slot (≤3 attempts, ≤2 s poll each). A swallowed press leaves
  // the announcement naming X (pickup self-over) — press again like a human.
  for (let attempt = 1; attempt <= MAX_MOVE_ATTEMPTS; attempt++) {
    await page.keyboard.press('ArrowLeft'); // move attempt
    try {
      await expect
        .poll(async () => hasLeftSelf((await announcer.textContent()) ?? '', activeId), { timeout: 2_000 })
        .toBe(true);
      break; // the drag has left X — the over-commit sequence has begun
    } catch {
      if (attempt === MAX_MOVE_ATTEMPTS) {
        throw new Error(
          `dayview keyboard drag «пустышка» held after ${MAX_MOVE_ATTEMPTS} ArrowLeft presses; the dnd-kit announcements node says: "${(await announcer.textContent()) ?? ''}"`,
        );
      }
    }
  }

  // …committed once the pickup transform (translate3d(0px, …)) is wiped.
  await expect
    .poll(() => header.evaluate((el) => el.style.transform), { timeout: 5_000 })
    .toBe('');
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
