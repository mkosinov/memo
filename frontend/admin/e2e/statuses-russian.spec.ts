import { test, expect } from './fixtures/test';
import { waitForScheduleReady, waitForRecordsReady } from './fixtures/helpers';

test('US-ST01: All status displays use Russian names', async ({ page }) => {
  // Visit /records (or wherever statuses appear as text)
  await page.goto('/records');
  await waitForRecordsReady(page);

  // If there are records, check status cells
  const statusCells = page.locator('[data-testid="record-status"]');
  const count = await statusCells.count();
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      const text = (await statusCells.nth(i).textContent())?.trim() ?? '';
      expect(['Ожидание', 'Посетил', 'Отменил', 'Неявка']).toContain(text);
    }
  }

  // Also check the status filter dropdown (if present)
  const filter = page.locator('select[aria-label="Фильтр по статусу"]');
  if (await filter.count() > 0) {
    const options = await filter.locator('option').allTextContents();
    for (const opt of options) {
      if (opt === '' || opt === 'Все') continue;
      expect(['Ожидание', 'Посетил', 'Отменил', 'Неявка']).toContain(opt);
    }
  }
});
