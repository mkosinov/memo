import { test, expect } from './fixtures/test';
import { waitForScheduleReady } from './fixtures/helpers';

/**
 * E2E tests for Schedule page: week navigation, today button,
 * activity cards, day columns, and drag-and-drop.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Click the "next period" arrow in the topbar. */
async function clickNextWeek(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="date-nav-next"]').click();
}

/** Click the "previous period" arrow in the topbar. */
async function clickPrevWeek(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="date-nav-prev"]').click();
}

// ---------------------------------------------------------------------------
// Tests — Schedule Page
// ---------------------------------------------------------------------------

test.describe('Schedule — Week Navigation and UI', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ── 1. Week navigation — arrows change displayed week ──────────────────

  test('week navigation — arrows change displayed week', async ({ page }) => {
    const dateRange = page.locator('[data-testid="date-nav-text"]');
    await expect(dateRange).toBeVisible();

    const initialText = await dateRange.textContent();

    // Click next week arrow
    await clickNextWeek(page);
    await page.waitForTimeout(500);

    // Date range should change
    const nextWeekText = await dateRange.textContent();
    expect(nextWeekText).not.toBe(initialText);

    // Click back to previous week
    await clickPrevWeek(page);
    await page.waitForTimeout(500);

    // Should restore the original week
    const restoredText = await dateRange.textContent();
    expect(restoredText).toBe(initialText);
  });

  // ── 2. Today button — returns to current week ──────────────────────────

  test('today button — returns to current week', async ({ page }) => {
    const dateRange = page.locator('[data-testid="date-nav-text"]');
    await expect(dateRange).toBeVisible();

    const currentWeekText = await dateRange.textContent();

    // Navigate to different week
    await clickNextWeek(page);
    await page.waitForTimeout(500);

    const nextWeekText = await dateRange.textContent();
    expect(nextWeekText).not.toBe(currentWeekText);

    // Click today button
    await page.locator('button:has-text("Сегодня")').click();
    await page.waitForTimeout(500);

    // Should be back on current week
    const restoredText = await dateRange.textContent();
    expect(restoredText).toBe(currentWeekText);

    // Now-line renders only on current week AND only after 09:00 local time
    // (gridStartMinutes=540 → nowPos < 0 before 09:00 → component hides the line),
    // so we don't hard-assert here.
  });

  // ── 3. Activity cards — visible on schedule ────────────────────────────

  test('activity cards — visible on schedule', async ({ page }) => {
    const cards = page.locator('[data-testid^="activity-"]');

    // At least one activity card should be visible
    await expect(cards.first()).toBeVisible({ timeout: 15_000 });

    // Each card should have a quick-add button
    const firstCard = cards.first();
    await expect(firstCard.locator('[data-testid="btn-quick-add"]')).toBeVisible();
  });

  // ── 4. Day columns — 7 columns for Mon-Sun ────────────────────────────

  test('day columns — 7 columns for Mon-Sun', async ({ page }) => {
    await page.waitForSelector('[data-testid="center-content"]', { timeout: 15_000 });

    // Should have 7 day columns (0=Mon through 6=Sun)
    for (let i = 0; i < 7; i++) {
      await expect(page.locator(`[data-testid="day-column-${i}"]`)).toBeVisible();
    }
  });

  // ── 5. Drag and drop — activity moves (card still visible after drag) ─

  test('drag and drop — activity card remains visible after drag', async ({ page }) => {
    const firstCard = page.locator('[data-testid^="activity-"]').first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });

    const box = await firstCard.boundingBox();
    expect(box).not.toBeNull();

    // Activate draggable (need >5px movement for PointerSensor activation)
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    const endY = startY + 120; // drag down by 120px (well past 5px threshold)

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move in steps so @dnd-kit detects the drag gesture
    await page.mouse.move(startX, endY, { steps: 10 });
    await page.mouse.up();

    // Card should still be visible (either moved to new slot or snapped back)
    await expect(firstCard).toBeVisible();
  });

  // ── 6. Now-line — visible on current week after 09:00 local ────────────

  test('now-line — visible on current week (after 09:00 grid start)', async ({ page }) => {
    const now = new Date();
    const hours = now.getHours();

    const nowLine = page.locator('[data-testid="now-line"]');

    // Component dependency: the schedule grid starts at 09:00 local
    // (gridStartMinutes = 540). Before 09:00 nowPos is negative and the
    // component legitimately hides the now-line, so only from 09:00 onward
    // can we hard-assert visibility (GH #247).
    if (hours >= 9 && hours < 22) {
      await expect(nowLine).toBeVisible({ timeout: 5_000 });
    } else {
      // Before 09:00 (or late evening) the line may or may not be visible —
      // just verify the page renders without crashing.
      await page.waitForTimeout(500);
    }
  });

  // ── 7. Week navigation — round trip integrity ──────────────────────────

  test('week navigation — multiple round trips preserve consistency', async ({ page }) => {
    const dateRange = page.locator('[data-testid="date-nav-text"]');
    await expect(dateRange).toBeVisible();

    const originalText = await dateRange.textContent();

    // Navigate forward twice
    await clickNextWeek(page);
    await page.waitForTimeout(300);
    await clickNextWeek(page);
    await page.waitForTimeout(300);

    const twoWeeksAhead = await dateRange.textContent();
    expect(twoWeeksAhead).not.toBe(originalText);

    // Navigate back twice — should return to original
    await clickPrevWeek(page);
    await page.waitForTimeout(300);
    await clickPrevWeek(page);
    await page.waitForTimeout(300);

    const restoredText = await dateRange.textContent();
    expect(restoredText).toBe(originalText);
  });
});
