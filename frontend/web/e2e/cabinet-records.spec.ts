/**
 * cabinet-records.spec.ts — #513 Task 7: the «Мои записи» screen
 * (User Scenarios С1 and С5).
 *
 *   С1 — the logged-in seed client (c1 «Анна Иванова», the project's
 *        storageState default) opens /cabinet, gets redirected to
 *        /cabinet/records and sees her seed records: date/time, service,
 *        visitors, statuses, prices.
 *   С5 — an anonymous visitor on a cabinet section sees the login form
 *        and NO data.
 *
 * Seed facts (backend/src/seed/seed.py, fixed week 2026-06-15…, sort =
 * activity start DESC):
 *   r4 → ev_fixed_3: 2026-06-16 15:00–16:00 «Мини-картина акрилом»,
 *        visit v7 «Анна Иванова» 2000 ₽ visited
 *   r1 → ev_fixed_0: 2026-06-15 10:00–12:00 «Морской пейзаж»,
 *        visits v1 «Анна Иванова» 3500 ₽, v2 «Софья Иванова» 2500 ₽ —
 *        both visited
 * So r4 renders FIRST (descending start), r1 second.
 */
import { test, expect } from 'playwright/test';

test.describe('#513 С1 — client sees own records', () => {
  // Runs with the project-default storageState: globalSetup's OTP login
  // as seed client c1 (+79001234567).
  test('redirects /cabinet → /cabinet/records and renders the seed record cards', async ({ page }) => {
    await page.goto('/cabinet');

    // The authenticated /cabinet is a redirect to the first section.
    await expect(page).toHaveURL(/\/cabinet\/records$/);

    // The #523 shell pieces stay: session phone + «Выйти».
    await expect(page.locator('[data-testid="cabinet-phone"]')).toHaveText('+79001234567');
    await expect(page.getByRole('button', { name: 'Выйти' })).toBeVisible();

    // The section nav: three links, «Мои записи» active.
    const nav = page.locator('[data-testid="cabinet-nav"]');
    await expect(nav).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Мои записи' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Мои фото' })).toHaveAttribute(
      'href',
      '/cabinet/photos',
    );
    await expect(nav.getByRole('link', { name: 'Мои платежи' })).toHaveAttribute(
      'href',
      '/cabinet/payments',
    );

    // Two seed records for c1.
    const cards = page.locator('[data-testid="my-record-card"]');
    await expect(cards).toHaveCount(2);

    // First card (latest start): r4 — Мини-картина акрилом, 16 июня 15:00–16:00.
    const first = cards.nth(0);
    await expect(first.locator('[data-testid="my-record-service"]')).toHaveText(
      'Мини-картина акрилом',
    );
    await expect(first.locator('[data-testid="my-record-date"]')).toHaveText('16 июня');
    await expect(first.locator('[data-testid="my-record-time"]')).toHaveText('15:00–16:00');
    await expect(first.getByText('Анна Иванова', { exact: true })).toBeVisible();
    await expect(first.locator('[data-testid="my-visit-status"]')).toHaveText('Состоялось');
    await expect(first.getByText('2 000 ₽')).toBeVisible();

    // Second card: r1 — Морской пейзаж, 15 июня 10:00–12:00, two visitors.
    const second = cards.nth(1);
    await expect(second.locator('[data-testid="my-record-service"]')).toHaveText(
      'Морской пейзаж',
    );
    await expect(second.locator('[data-testid="my-record-date"]')).toHaveText('15 июня');
    await expect(second.locator('[data-testid="my-record-time"]')).toHaveText('10:00–12:00');
    await expect(second.getByText('Анна Иванова', { exact: true })).toBeVisible();
    await expect(second.getByText('Софья Иванова', { exact: true })).toBeVisible();
    const statuses = second.locator('[data-testid="my-visit-status"]');
    await expect(statuses).toHaveCount(2);
    await expect(statuses.nth(0)).toHaveText('Состоялось');
    await expect(statuses.nth(1)).toHaveText('Состоялось');
    await expect(second.getByText('3 500 ₽')).toBeVisible();
    await expect(second.getByText('2 500 ₽')).toBeVisible();

    // No pagination for a single page; no empty state.
    await expect(page.locator('[data-testid="list-pagination"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="my-records-empty"]')).toHaveCount(0);
  });
});

test.describe('#513 С5 — anonymous on a cabinet section', () => {
  // Opt OUT of the project-level storageState (c1's session): a bare
  // `undefined` does not override a project default (the admin donor
  // lesson, mirrored by the smoke spec).
  test.use({ storageState: { cookies: [], origins: [] } });

  test('shows the login form and no data on /cabinet/records', async ({ page }) => {
    await page.goto('/cabinet/records');

    // The #523 login form — phone + «Войти».
    await expect(page.locator('#phone')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();

    // And NO data: no cards, no section nav, no session phone.
    await expect(page.locator('[data-testid="my-record-card"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="cabinet-nav"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="cabinet-phone"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="my-records-empty"]')).toHaveCount(0);
  });
});
