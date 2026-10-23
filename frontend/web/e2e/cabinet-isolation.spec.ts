/**
 * cabinet-isolation.spec.ts — #513 Task 10: User Scenario С2 (data
 * isolation between seed clients).
 *
 *   С2 — logged in as c1 «Анна Иванова» (the project's storageState
 *        default), the second seed client's entities are absent from
 *        ALL THREE cabinet screens, while c1's own entities stay
 *        visible (a positive control per screen — absence must never
 *        pass on an empty screen).
 *
 * Seed facts (backend/src/seed/seed.py) — c2 «Мария Петрова»
 * (+79002345678) owns exactly:
 *   record r2 → ev_fixed_1: 2026-06-15 12:00–13:30 «Ручная лепка»,
 *        visits vis3 «Мария Петрова» + vis4 «Артём Петров» (visited)
 *   photo ph_c2_private → /images/maria-canvas.jpg, is_public=false,
 *        created 2026-06-23
 *   payment p2 → r2, 4 000 ₽, card
 *
 * Discriminators are chosen to be unique to c2 on each screen:
 * «Ручная лепка» (only r2's service — c1's are «Морской пейзаж» and
 * «Мини-картина акрилом»), maria-canvas.jpg (only ph_c2_private), and
 * «4 000 ₽» (only p2 — c1's payments are 6 000 ₽ and 2 000 ₽). The
 * exact c1 counts (2 record cards / 3 photo cards / 2 payment rows)
 * double as the strongest isolation pin: any c2 leak shifts them.
 *
 * Negative assertions (class 2 — never-appeared probes) run ONLY after
 * each screen's positive control has settled the DOM, so a late render
 * cannot silently green them.
 */
import { test, expect } from 'playwright/test';

test.describe('#513 С2 — the second seed client’s entities are absent from all three screens', () => {
  // Runs with the project-default storageState: globalSetup's OTP login
  // as seed client c1 (+79001234567).

  test('records: c1’s two cards render; c2’s r2 «Ручная лепка» leaks nowhere', async ({ page }) => {
    await page.goto('/cabinet/records');
    await expect(page).toHaveURL(/\/cabinet\/records$/);

    // POSITIVE control — c1's own records ARE on screen (settle anchor):
    // r4 first (latest start), r1 second.
    const cards = page.locator('[data-testid="my-record-card"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.locator('[data-testid="my-record-service"]')).toHaveText([
      'Мини-картина акрилом',
      'Морской пейзаж',
    ]);

    // NEGATIVE — c2's r2: its service title, its time slot and its
    // visitor names are all absent from the settled screen.
    await expect(page.getByText('Ручная лепка')).toHaveCount(0);
    await expect(page.getByText('12:00–13:30')).toHaveCount(0);
    await expect(page.getByText('Мария Петрова')).toHaveCount(0);
    await expect(page.getByText('Артём Петров')).toHaveCount(0);
  });

  test('photos: c1’s three cards render; c2’s maria-canvas.jpg leaks nowhere', async ({ page }) => {
    await page.goto('/cabinet/photos');
    await expect(page).toHaveURL(/\/cabinet\/photos$/);

    // POSITIVE control — c1's own photos ARE on screen (settle anchor).
    const cards = page.locator('[data-testid="my-photo-card"]');
    await expect(cards).toHaveCount(3);
    await expect(cards.locator('img[src="/images/client-work-1.jpg"]')).toHaveCount(1);

    // NEGATIVE — c2's ph_c2_private: neither the image element nor the
    // bare filename appears anywhere on the screen.
    await expect(page.locator('img[src="/images/maria-canvas.jpg"]')).toHaveCount(0);
    await expect(page.getByText('maria-canvas.jpg')).toHaveCount(0);
  });

  test('payments: c1’s two rows render; c2’s p2 «4 000 ₽» leaks nowhere', async ({ page }) => {
    await page.goto('/cabinet/payments');
    await expect(page).toHaveURL(/\/cabinet\/payments$/);

    // POSITIVE control — c1's own payments ARE on screen (settle anchor).
    const rows = page.locator('[data-testid="my-payment-row"]');
    await expect(rows).toHaveCount(2);
    await expect(page.getByText('6 000 ₽')).toHaveCount(1);

    // NEGATIVE — c2's p2: its amount row is absent, and so is r2's
    // service title (the lesson-context leak path for p2).
    await expect(page.getByText('4 000 ₽')).toHaveCount(0);
    await expect(page.getByText('Ручная лепка')).toHaveCount(0);
  });
});
