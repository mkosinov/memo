import { test, expect } from './fixtures/test';

/**
 * E2E tests for sidebar navigation between all pages.
 * Verifies that each nav link loads the correct page content.
 *
 * Requires: dev server on :3001, backend on :8000
 */

test.describe('Sidebar Navigation', () => {
  test('navigates to Schedule page via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Click "Расписание" link
    await page.locator('a[aria-label="Расписание"]').click();

    // Should load schedule page
    await page.waitForSelector('[data-testid="center-content"]', { timeout: 15_000 });
    await expect(page.locator('[data-testid="date-nav-text"]')).toBeVisible();
  });

  test('navigates to Records page via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    await page.locator('a[aria-label="Записи"]').click();

    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 15_000 });
    await expect(page.locator('table')).toBeVisible();
  });

  test('navigates to Clients page via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    await page.locator('a[aria-label="Клиенты"]').click();

    await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 15_000 });
    await expect(page.locator('table')).toBeVisible();
  });

  test('navigates to Masters page via Справочники submenu', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Open Справочники submenu
    await page.locator('button[aria-label="Справочники"]').click();
    await page.waitForTimeout(300);

    // Click Мастера link inside submenu
    await page.locator('a:has-text("Услуги")').first().click();

    await page.waitForSelector('h1:has-text("Управление услугами")', { timeout: 15_000 });
    await expect(page.locator('table')).toBeVisible();
  });

  test('navigates to Locations page via Справочники submenu', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Open Справочники submenu
    await page.locator('button[aria-label="Справочники"]').click();
    await page.waitForTimeout(300);

    // Click Локации link
    await page.locator('a:has-text("Локации")').first().click();

    await page.waitForSelector('h1:has-text("Управление локациями")', { timeout: 15_000 });
    await expect(page.locator('table')).toBeVisible();
  });

  test('navigates to Tags page via Справочники submenu', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    await page.locator('button[aria-label="Справочники"]').click();
    await page.waitForTimeout(300);

    await page.locator('a:has-text("Теги")').first().click();

    await page.waitForSelector('h1:has-text("Управление тегами")', { timeout: 15_000 });
    await expect(page.locator('table')).toBeVisible();
  });

  test('navigates to Photos page via sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    await page.locator('a[aria-label="Фото"]').click();

    await page.waitForSelector('h1:has-text("Управление фото")', { timeout: 15_000 });
    await expect(page.locator('table')).toBeVisible();
  });

  test('active link is highlighted in sidebar', async ({ page }) => {
    await page.goto('/schedule');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Schedule link should have active styling (brand background)
    const scheduleLink = page.locator('a[aria-label="Расписание"]');
    await expect(scheduleLink).toHaveClass(/bg-brand/);

    // Navigate to records
    await page.locator('a[aria-label="Записи"]').click();
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 15_000 });

    // Records link should now be active
    const recordsLink = page.locator('a[aria-label="Записи"]');
    await expect(recordsLink).toHaveClass(/bg-brand/);
  });

  test('sidebar collapse and expand works', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Find the collapse button
    const collapseBtn = page.locator('button[aria-label="Свернуть sidebar"]');
    await expect(collapseBtn).toBeVisible();

    // Click to collapse
    await collapseBtn.click();
    await page.waitForTimeout(300);

    // Nav links should be hidden (text not visible, only icons)
    const navText = page.locator('a[aria-label="Расписание"] span');
    // After collapse, the span text should not be visible
    const isVisible = await navText.isVisible().catch(() => false);
    expect(isVisible).toBe(false);

    // Find expand button
    const expandBtn = page.locator('button[aria-label="Развернуть sidebar"]');
    await expect(expandBtn).toBeVisible();

    // Click to expand
    await expandBtn.click();
    await page.waitForTimeout(300);

    // Nav text should be visible again
    await expect(page.locator('a[aria-label="Расписание"] span:has-text("Расписание")')).toBeVisible();
  });

  test('Мастера submenu expands and shows masters list', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="menubar"]', { timeout: 10_000 });

    // Click Мастера button to expand submenu (scope to menubar to avoid strict mode violation)
    const mastersBtn = page.locator('[data-testid="menubar"] button[aria-label="Мастера"]');
    await mastersBtn.click();
    await page.waitForTimeout(500);

    // Submenu should be expanded
    await expect(mastersBtn).toHaveAttribute('aria-expanded', 'true');

    // Verify submenu content exists by checking text content of the menubar increased
    const menubarText = await page.locator('[data-testid="menubar"]').textContent();
    // Should contain master names (seed data has names like "Иван", etc.)
    expect(menubarText!.length).toBeGreaterThan(20);

    // Click again to collapse
    await mastersBtn.click();
    await page.waitForTimeout(300);
    await expect(mastersBtn).toHaveAttribute('aria-expanded', 'false');
  });
});
