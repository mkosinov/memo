import { test, expect } from '@playwright/test';

test('Masters submenu shows list', async ({ page }) => {
  await page.goto('http://localhost:3000');
  
  // Wait for page to load
  await page.waitForLoadState('networkidle');
  
  // Take screenshot before clicking
  await page.screenshot({ path: '/tmp/before-click.png', fullPage: false });
  
  // Click Мастера button
  const mastersButton = page.getByRole('button', { name: /Мастера/i });
  await mastersButton.click();
  
  // Wait a bit for submenu to render
  await page.waitForTimeout(1000);
  
  // Take screenshot after clicking
  await page.screenshot({ path: '/tmp/after-click.png', fullPage: false });
  
  // Check that submenu has content (not empty)
  const expandedButton = page.locator('button[aria-expanded="true"]');
  await expect(expandedButton).toBeVisible();
  
  // Count master items in submenu
  const submenu = expandedButton.locator('..').locator('div').last();
  const masterItems = submenu.locator('div').filter({ hasText: /.+/ });
  const count = await masterItems.count();
  
  console.log(`Found ${count} master items in submenu`);
  
  // Should have at least 1 master
  expect(count).toBeGreaterThan(0);
});
