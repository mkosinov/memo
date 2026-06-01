import { test, expect } from '@playwright/test';

test('Карточка мастер-класса отрисовывается с данными', async ({ page }) => {
  await page.goto('/');

  // Ждем загрузки данных с API — real card (не custom-booking)
  const card = page.locator(
    '[data-testid="activity-card"]:not([data-card-id="custom-booking"]):not([data-card-id="empty-background-card"])',
  ).first();
  await expect(card).toBeVisible({ timeout: 20000 });

  // Проверяем, что карточка содержит название мастер-класса (любое из seed-данных)
  await expect(card.locator('h3')).toHaveCount(1);
  const title = await card.locator('h3').textContent();
  expect(title?.trim().length).toBeGreaterThan(0);

  // Проверяем, что отрисовалась цена (число с символом ₽)
  await expect(card).toContainText('₽');

  // Проверяем, что есть кнопка "Подробнее"
  await expect(card.getByRole('button', { name: 'Подробнее' })).toBeVisible();

  // Проверяем, что теги отрисовались (data-testid добавлен к категории)
  const tags = card.locator('[data-testid="activity-category"]');
  await expect(tags.first()).toBeVisible();

  console.log('Визуальная проверка DOM: OK');
});
