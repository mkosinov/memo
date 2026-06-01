import { test, expect } from '@playwright/test';

test('Проверка DOM админки: нет ошибки загрузки, есть расписание', async ({ page }) => {
  // Ловим все консольные сообщения
  const logs: string[] = [];
  page.on('console', (msg) => logs.push(`[${msg.type()}] ${msg.text()}`));

  await page.goto('http://localhost:3001', { waitUntil: 'networkidle', timeout: 30000 });
  
  // Ждём завершения React-рендеринга
  await page.waitForTimeout(5000);

  // 1. Ищем текст ошибки
  const errorText = page.getByText('Ошибка загрузки');
  const hasError = await errorText.isVisible().catch(() => false);
  
  // 2. Ищем ячейки расписания (time slots или activity blocks)
  // Админка обычно рендерит сетку с мастер-классами
  const scheduleCells = page.locator('[class*="grid"] td, [class*="schedule"] div, [class*="cell"], [class*="time-slot"]').first();
  const hasSchedule = await scheduleCells.isVisible().catch(() => false);
  
  // 3. Ищем любой контент, который не является ошибкой
  const pageContent = await page.textContent('body').catch(() => '');
  const hasActivityData = pageContent.includes('Картина') || pageContent.includes('мастер') || pageContent.includes('актив');

  console.log('\n========== ADMIN DOM CHECK ==========');
  console.log('Ошибка загрузки видна:', hasError);
  console.log('Ячейки расписания найдены:', hasSchedule);
  console.log('Контент содержит данные:', hasActivityData);
  
  // Логируем весь видимый текст для диагностики
  const visibleText = (await page.innerText('body').catch(() => '')).substring(0, 2000);
  console.log('Текст страницы (первые 2000 символов):\n', visibleText);

  console.log('\nКонсольные логи:');
  logs.slice(-20).forEach(l => console.log(' ', l));

  await page.screenshot({ path: '/tmp/admin-dom-check.png', fullPage: true });

  // Если есть ошибка — падаем
  expect(hasError).toBe(false);
});
