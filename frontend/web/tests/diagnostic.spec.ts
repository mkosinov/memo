import { test, expect } from '@playwright/test';

const APPS = [
  { name: 'web', url: 'http://localhost:3000' },
  { name: 'admin', url: 'http://localhost:3001' },
];

for (const app of APPS) {
  test(`Диагностика ${app.name}: консоль + сетевые запросы`, async ({ page }) => {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const apiResponses: { url: string; status: number }[] = [];

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(`[CONSOLE] ${msg.text()}`);
      }
    });

    page.on('requestfailed', (request) => {
      failedRequests.push(`[FAILED] ${request.url()} - ${request.failure()?.errorText}`);
    });

    page.on('response', (response) => {
      if (response.url().includes('localhost:8000') || response.url().includes('/api/v1/')) {
        apiResponses.push({ url: response.url(), status: response.status() });
      }
    });

    await page.goto(app.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // Логируем диагностику
    console.log(`\n========== ${app.name.toUpperCase()} ==========`);

    if (consoleErrors.length === 0) {
      console.log('✅ Console errors: NONE');
    } else {
      console.log(`❌ Console errors (${consoleErrors.length}):`);
      consoleErrors.forEach(e => console.log(`  ${e}`));
    }

    if (failedRequests.length === 0) {
      console.log('✅ Failed requests: NONE');
    } else {
      console.log(`❌ Failed requests (${failedRequests.length}):`);
      failedRequests.forEach(r => console.log(`  ${r}`));
    }

    if (apiResponses.length === 0) {
      console.log('⚠️  No API requests detected');
    } else {
      console.log(`📡 API (${apiResponses.length}):`);
      apiResponses.forEach(r => console.log(`  ${r.status} ${r.url}`));
    }

    await page.screenshot({ path: `/tmp/diagnostic-${app.name}.png`, fullPage: true });

    // Падаем если есть фатальные ошибки
    if (failedRequests.length > 0) {
      test.fail(true, `Есть упавшие запросы в ${app.name}`);
    }
  });
}
