/**
 * master-role-menu.spec.ts — GH #263 T9, spec scenario S4 (menu by role,
 * «Нет доступа» screen, read-only services screen).
 *
 * Uses the live master session (useMasterSession → storageState logged in by
 * globalSetup, +79990000002/master12345, linked staff card m1).
 *
 * Covered:
 *  - S4a: direct URLs to the 5 admin-only sections → NoAccessScreen
 *    (data-testid="no-access", «Нет доступа к разделу»), URL kept (no
 *    redirect), and the admin-only menu items are absent.
 *  - S4b: menu filtering — Клиенты link absent; Справочники submenu lacks
 *    Сотрудники/Локации/Теги/Должности; Мастера collapsible absent; allowed
 *    items (Расписание/Записи/Услуги/Фото) present.
 *  - S4c: services screen — no «+ Добавить услугу», no «Материалы» tab, no
 *    «Материал» filter select (materials:read not granted).
 */
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';

const ADMIN_ONLY_SECTIONS: Array<{ url: string; screenMarker: RegExp }> = [
  // screenMarker: text unique to the section's real UI — it must NEVER appear
  // when the guard holds (markers mirror the section pages' own headings /
  // toolbar buttons).
  { url: '/clients', screenMarker: /Новый клиент/ },
  { url: '/locations', screenMarker: /Добавить локацию/ },
  { url: '/tags', screenMarker: /Управление тегами/ },
  { url: '/staff', screenMarker: /Управление сотрудниками/ },
  { url: '/positions', screenMarker: /Добавить должность/ },
];

test.describe('GH #263 S4 — master menu + access guard', () => {
  useMasterSession();

  test.describe.configure({ mode: 'serial' });

  test('S4a: direct URLs to admin-only sections show «Нет доступа к разделу»', async ({ page }) => {
    for (const { url, screenMarker } of ADMIN_ONLY_SECTIONS) {
      await page.goto(url);
      const noAccess = page.locator('[data-testid="no-access"]');
      await expect(noAccess).toBeVisible({ timeout: 30_000 });
      await expect(noAccess).toContainText('Нет доступа к разделу');
      // No redirect — the URL stays on the deep link.
      expect(new URL(page.url()).pathname).toBe(url);
      // Children are withheld — the section's own UI never mounts.
      await expect(page.getByText(screenMarker)).toHaveCount(0);
    }
  });

  test('S4b: menu hides admin-only items, keeps allowed ones', async ({ page }) => {
    await page.goto('/schedule');
    const menubar = page.locator('[data-testid="menubar"]');
    await expect(menubar).toBeVisible({ timeout: 30_000 });

    // Admin-only nav item is gone.
    await expect(menubar.getByRole('link', { name: 'Клиенты' })).toHaveCount(0);
    // «Мастера» collapsible is gone.
    await expect(menubar.getByRole('button', { name: 'Мастера', exact: true })).toHaveCount(0);

    // Allowed top-level + standalone items stay.
    for (const label of ['Расписание', 'Записи', 'Фото']) {
      await expect(menubar.locator(`a[aria-label="${label}"]`)).toHaveCount(1);
    }

    // Справочники submenu: only «Услуги» survives.
    const directoriesBtn = menubar.getByRole('button', { name: 'Справочники' });
    await expect(directoriesBtn).toHaveCount(1);
    await directoriesBtn.click();
    for (const label of ['Сотрудники', 'Локации', 'Теги', 'Должности']) {
      await expect(menubar.locator('a', { hasText: label })).toHaveCount(0);
    }
    await expect(menubar.locator('a', { hasText: 'Услуги' }).first()).toBeVisible();
  });

  test('S4c: services screen hides create button and materials surfaces', async ({ page }) => {
    await page.goto('/services');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 30_000 });

    // services:write NOT granted → no create affordance.
    await expect(page.getByRole('button', { name: '+ Добавить услугу' })).toHaveCount(0);

    // materials:read NOT granted → no «Материалы» tab and no «Материал» filter.
    await expect(page.getByRole('button', { name: 'Материалы', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Фильтр по материалу')).toHaveCount(0);

    // The services list itself still renders (services:read granted).
    await expect(page.getByText('Управление услугами')).toBeVisible();
  });
});
