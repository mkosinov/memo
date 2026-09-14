import { test, expect } from './fixtures/test';
import { waitForScheduleReady, openModal } from './fixtures/helpers';
import { createTestActivity } from './fixtures/factories';
import type { Page, Locator } from '@playwright/test';

/**
 * GH #260 — schedule z-layering ladder (spec §3.4 rev2.1, §5).
 *
 * Written BEFORE the fix (TDD RED). On the current code the stack badge is
 * z-[110], which sits ABOVE the Topbar (z-40) and the Menubar/sidebar (z-30),
 * so S1 and S3 fail on a z-assertion. S2 (OverlapPopover 120 > badge 110) is
 * already green and stays a regression guard. Task 3 moves the badge to
 * --z-badge (26) and turns S1/S3 green.
 *
 * All numeric pairs are compared ONLY between elements of the ROOT stacking
 * context (badge, menubar, topbar, details-modal, toast). The zoom-popup lives
 * inside the Topbar's sticky z-40 context, so its number is not comparable
 * cross-context — it is protected transitively by the «badge < topbar» pair.
 */
test.describe('Schedule z-layering (#260)', () => {
  const dayStr = new Date().toISOString().slice(0, 10);

  test.beforeEach(async ({ request }) => {
    // Two activities in the same slot, same master (createTestActivity picks
    // masters[0]) => one overlapping stack => the «2 cards» badge (wave5 trick).
    // No explicit cleanup: the auto `seedReset` fixture (#252) restores the
    // seed DB before every test, so leaked rows never reach the next run.
    await createTestActivity(request, { start: `${dayStr}T10:00:00`, capacity: 10 });
    await createTestActivity(request, { start: `${dayStr}T10:00:00`, capacity: 10 });
  });

  // The stack badge: DayColumn's `button[data-popover-toggle]` labelled «N cards».
  const badge = (page: Page): Locator =>
    page.locator('button[data-popover-toggle]').filter({ hasText: /cards/ }).first();

  // The Topbar root carries a stable data-testid="topbar" (added with this
  // spec) so the selector survives Task 4's z-class → z-token migration. There
  // is no <header> element in the app — the Topbar root is a plain <div>.
  const topbar = (page: Page): Locator => page.locator('[data-testid="topbar"]').first();

  const zOf = (loc: Locator): Promise<number> =>
    loc.evaluate((el) => parseInt(getComputedStyle(el).zIndex, 10));

  test('S1: badge sits below the topbar (zoom popover paints above badges)', async ({ page }) => {
    await waitForScheduleReady(page);
    await expect(badge(page)).toBeVisible();
    // Root-context relation that caused the bug: badge 110 > topbar 40 => the
    // whole header (with its zoom popup) painted UNDER the badge. After the fix
    // badge becomes --z-badge (26) < topbar (40).
    expect(await zOf(badge(page))).toBeLessThan(await zOf(topbar(page)));
  });

  test('S2: stack badge click opens OverlapPopover above the badge', async ({ page }) => {
    await waitForScheduleReady(page);
    const b = badge(page);
    await expect(b).toBeVisible();
    await b.click();
    const popover = page.locator('[data-testid="overlap-popover"]');
    await expect(popover).toBeVisible();
    // OverlapPopover inline zIndex 120 > badge 110 — green today and after the
    // fix (badge 26, popover --z-popover-stack 120).
    expect(await zOf(popover)).toBeGreaterThan(await zOf(b));
    // Toggle closed: the badge's onMouseDown stopPropagation defeats the
    // popover's outside-close (DayColumn.tsx:542-546), and the popover anchors
    // BELOW the badge so it never covers the click target.
    await b.click();
    await expect(popover).toBeHidden();
  });

  test('S3: root-context ladder badge < sidebar < topbar < details-modal < toast', async ({ page }) => {
    await waitForScheduleReady(page);

    // Layers that are always present in the root stacking context.
    const badgeZ = await zOf(badge(page));
    const menubarZ = await zOf(page.locator('[data-testid="menubar"]'));
    const topbarZ = await zOf(topbar(page));

    // Assert the always-available pairs FIRST so the RED run fails here on a
    // z-assertion (badge 110 !< menubar 30) — never on toast/modal setup.
    expect(badgeZ).toBeLessThan(menubarZ);
    expect(menubarZ).toBeLessThan(topbarZ);

    // Scenario 3 needs a live toast: ToastContainer renders null when empty, so
    // [data-testid="toast-container"] only exists while a toast is showing.
    // Trigger the side-effect-free Toolbar «copy last week» toast (copyLastWeek
    // is a stub) and capture its z BEFORE opening the modal — the modal covers
    // the screen (fixed inset-0 z-200) and would block the panel clicks. The
    // number is captured, so the toast auto-dismissing (4.5s) later is harmless.
    await page.getByRole('button', { name: 'Открыть панель инструментов' }).click();
    await page.getByRole('button', { name: 'Копировать прошлую неделю' }).click();
    const toast = page.locator('[data-testid="toast-container"]');
    await expect(toast).toBeVisible();
    const toastZ = await zOf(toast);

    // openModal navigates to a week with a seeded record and opens the details
    // modal (same call shape as wave5-x-cards-blurred.spec.ts).
    await openModal(page);
    const modal = page.locator('[data-testid="activity-details-modal"]');
    await expect(modal).toBeVisible();
    const modalZ = await zOf(modal);

    expect(topbarZ).toBeLessThan(modalZ);
    expect(modalZ).toBeLessThan(toastZ);
  });
});
