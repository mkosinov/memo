import { SEED_WEEK_MONDAY } from './fixtures/seed-week';
import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

test('US-M09: Modal does not jump when switching tabs [GH #156 — unblocked by #124 Wave 1 openModal fix]', async ({ page }) => {
  await page.goto(`/schedule?date=${SEED_WEEK_MONDAY}`);
  await waitForScheduleReady(page);

  await openModal(page);
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible();

  // Measure initial position
  const initialBox = await dialog.boundingBox();
  expect(initialBox).not.toBeNull();

  // Switch to first client tab
  const clientTab = page.locator('[data-testid^="tab-client-"]').first();
  await expect(clientTab).toBeVisible({ timeout: 5_000 });
  await clientTab.click();
  await page.waitForTimeout(300);
  const recordsBox = await dialog.boundingBox();

  // Switch back to Settings
  await page.locator('[data-testid="tab-settings"]').click();
  await page.waitForTimeout(300);
  const settingsBox = await dialog.boundingBox();

  // Width must be unchanged across all three states
  expect(recordsBox?.width).toBe(initialBox?.width);
  expect(settingsBox?.width).toBe(initialBox?.width);

  // Height is fixed (within tolerance)
  expect(Math.abs((recordsBox?.height ?? 0) - (initialBox?.height ?? 0))).toBeLessThan(5);
  expect(Math.abs((settingsBox?.height ?? 0) - (initialBox?.height ?? 0))).toBeLessThan(5);

  // X position unchanged (no horizontal shift)
  expect(recordsBox?.x).toBe(initialBox?.x);
  expect(settingsBox?.x).toBe(initialBox?.x);
});

/**
 * Max scrollHeight across the modal scroll body and ALL its descendants —
 * a proxy for the ACTIVE tab's natural content height (GH #598 US-1).
 * Whichever level owns the scroll (the outer body for «Настройки», the
 * nested client-tab div for «Клиент»), its scrollHeight reports the FULL
 * content height whatever the fixed shell clips — so the max over the tree
 * is the height the auto-sized modal would have grown to.
 */
async function naturalScrollHeight(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const body = document.querySelector(
      '[data-testid="activity-details-modal-scroll-body"]',
    );
    if (!body) return -1;
    let max = 0;
    const stack: Element[] = [body];
    while (stack.length > 0) {
      const el = stack.pop()!;
      if (el.scrollHeight > max) max = el.scrollHeight;
      for (let i = 0; i < el.children.length; i++) {
        stack.push(el.children[i]);
      }
    }
    return max;
  });
}

// GH #598 US-1 (spec §6): the container keeps a fixed ≈85dvh height across
// tab switches even when the tabs' NATURAL heights differ wildly. The seed
// data alone cannot prove that (both tabs may fit under the old auto-size
// ceiling — the #156 discrimination defect): this test factories a record
// with 15 visits, so the «Клиент» tab's natural height runs far past the
// fixed body while «Настройки» stays compact. Under the pre-#598 auto-size
// the modal would jump between the two tabs; now the geometry must hold.
test('US-1: fixed ≈85% viewport height across tabs — deliberately different natural tab heights [GH #598]', async ({
  page,
  request,
}) => {
  // 1. SETUP — client + activity on the seed reference week + a 15-visit
  //    record (each visit is a table row in the client tab). Capacity is
  //    raised for the factory activity: the create guard rejects
  //    occupied+seats > capacity with 409 (domain records.md), and the
  //    default capacity 8 cannot host 15 seats.
  const ts = Date.now();
  const client = await createTestClient(request);
  const activity = await createTestActivity(request, { capacity: 20 });
  const visits = Array.from({ length: 15 }, (_, i) => ({
    name: `us1-visit-${i}-${ts}`,
    price: 3500,
  }));
  const record = await createTestRecord(request, activity.id, client.id, {
    visits,
  });
  const recordAny = record as any;

  try {
    // 2. ACTION — open the activity modal scoped to the record (edit mode,
    //    «Настройки» active by default), then switch Настройки → Клиент →
    //    Настройки, settling each tab's data before measuring.
    await openModal(page, { recordId: recordAny.id });
    const container = page.locator(
      '[data-testid="activity-details-modal-container"]',
    );
    await expect(container).toBeVisible();
    await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const settingsBox = await container.boundingBox();

    const clientTab = page.locator(
      `[data-testid="tab-client-${recordAny.id}"]`,
    );
    await expect(clientTab).toBeVisible({ timeout: 15_000 });
    await clientTab.click();
    // Settle on the LAST factory visit row before measuring (per-row
    // testid — ids come from the create response).
    const lastVisitId = recordAny.visits[recordAny.visits.length - 1].id;
    await expect(
      page.locator(`[data-testid="visit-row-${lastVisitId}"]`),
    ).toBeVisible({ timeout: 15_000 });
    const clientBox = await container.boundingBox();
    const clientNatural = await naturalScrollHeight(page);

    await page.locator('[data-testid="tab-settings"]').click();
    await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();
    const settingsBox2 = await container.boundingBox();
    const settingsNatural = await naturalScrollHeight(page);

    // 3. VERIFY UI — geometry (not a class string):
    //    ≈85% of the viewport height (h-[85dvh]; 10px tolerance for
    //    rounding),
    expect(Math.abs((settingsBox?.height ?? 0) - viewportHeight * 0.85)).toBeLessThanOrEqual(10);
    //    invariant within the 5px #156 tolerance across both switches,
    expect(Math.abs((clientBox?.height ?? 0) - (settingsBox?.height ?? 0))).toBeLessThan(5);
    expect(Math.abs((settingsBox2?.height ?? 0) - (settingsBox?.height ?? 0))).toBeLessThan(5);
    //    and the fixed shell actually clips the client tab (its natural
    //    content exceeds the container).
    expect(clientNatural).toBeGreaterThan(clientBox?.height ?? 0);

    //    Discrimination guard: the tabs' natural heights differ by far
    //    more than the 5px tolerance — under auto-size the modal WOULD
    //    jump, so this test can never stay green against the old shell.
    expect(clientNatural - settingsNatural).toBeGreaterThan(150);
  } finally {
    // 4. CLEANUP — always runs
    await cleanupRecord(request, recordAny.id);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
    await cleanup(request, `/api/v1/clients/${client.id}`);
  }
});
