/**
 * cabinet-photos.spec.ts — #513 Task 8: the «Мои фото» screen
 * (User Scenario С3).
 *
 *   С3 — the logged-in seed client (c1 «Анна Иванова», the project's
 *        storageState default) opens /cabinet/photos and sees ALL her
 *        photos, including the NON-public one with the badge
 *        «Не опубликовано»; that photo is absent from the guest gallery.
 *
 * Seed facts (backend/src/seed/seed.py; sort = created_at DESC):
 *   ph_c1_private → /images/cabinet-draft.jpg, is_public=false,
 *                   2026-06-22 — renders FIRST (newest)
 *   ph2           → /images/client-work-2.jpg, is_public=true, 2026-06-16
 *   ph1           → /images/client-work-1.jpg, is_public=true, 2026-06-15
 *   (c2's maria-canvas.jpg must never appear — isolation)
 *
 * Render path (#513 decision, fixed in this task): photos render by the
 * SAME mechanism as the guest gallery — a plain <img> whose src is the
 * filename served from frontend/web/public/images/. Non-public names are
 * covered by the same static dir: is_public filters only LISTS, never
 * bytes, so the seed's c1-owned files were added there (client-work-1,
 * client-work-2, cabinet-draft). The naturalWidth polls pin that the
 * files are actually served — not just referenced.
 */
import { test, expect } from 'playwright/test';

test.describe('#513 С3 — client sees all own photos, incl. the non-public one', () => {
  // Runs with the project-default storageState: globalSetup's OTP login
  // as seed client c1 (+79001234567).
  test('cabinet shows the seed photos with publication badges; the guest gallery omits the non-public file', async ({ page }) => {
    await page.goto('/cabinet/photos');
    await expect(page).toHaveURL(/\/cabinet\/photos$/);

    // The section nav: «Мои фото» active.
    const nav = page.locator('[data-testid="cabinet-nav"]');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Мои фото' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // All three c1 photos (is_public never filters the cabinet list).
    const cards = page.locator('[data-testid="my-photo-card"]');
    await expect(cards).toHaveCount(3);

    // The NON-public photo: newest first, badge «Не опубликовано».
    const privateCard = cards.filter({
      has: page.locator('img[src="/images/cabinet-draft.jpg"]'),
    });
    await expect(privateCard).toHaveCount(1);
    await expect(privateCard.locator('[data-testid="my-photo-badge"]')).toHaveText(
      'Не опубликовано',
    );

    // The two public ones carry «Опубликовано».
    const publicBadges = cards
      .filter({ hasNot: page.locator('img[src="/images/cabinet-draft.jpg"]') })
      .locator('[data-testid="my-photo-badge"]');
    await expect(publicBadges).toHaveCount(2);
    await expect(publicBadges.nth(0)).toHaveText('Опубликовано');
    await expect(publicBadges.nth(1)).toHaveText('Опубликовано');

    // Render path pinned: every card's file is actually SERVED (naturalWidth
    // > 0) — the static public/images mechanism covers non-public names.
    const images = cards.locator('img');
    for (let i = 0; i < 3; i++) {
      await expect
        .poll(() => images.nth(i).evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
    }

    // Isolation sanity (С2 will pin it fully): c2's photo never renders.
    await expect(page.locator('img[src="/images/maria-canvas.jpg"]')).toHaveCount(0);

    // One page — no pagination, no empty state.
    await expect(page.locator('[data-testid="list-pagination"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="my-photos-empty"]')).toHaveCount(0);

    // ── The guest gallery side of С3 ────────────────────────────────
    await page.goto('/');

    const gallery = page.locator('[data-testid="guest-gallery"]');
    await expect(gallery).toBeVisible();

    // Positive control: the same static mechanism serves c1's PUBLIC
    // photo in the gallery.
    await expect(
      gallery.locator('img[src="/images/client-work-1.jpg"]'),
    ).toHaveCount(1);

    // The non-public file is absent everywhere on the public page.
    await expect(page.locator('img[src="/images/cabinet-draft.jpg"]')).toHaveCount(0);
  });
});
