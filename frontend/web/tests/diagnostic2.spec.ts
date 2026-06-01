import { test, expect } from '@playwright/test';

const APPS = [
  { name: 'web', url: 'http://localhost:3000' },
  { name: 'admin', url: 'http://localhost:3001' },
];

for (const app of APPS) {
  test(`Глубинная диагностика ${app.name}`, async ({ page }) => {
    const allRequests: { url: string; status: number; method: string }[] = [];
    const consoleAll: string[] = [];
    const errors: string[] = [];

    page.on('request', (req) => {
      allRequests.push({ url: req.url(), status: 0, method: req.method() });
    });

    page.on('response', (res) => {
      const existing = allRequests.find(r => r.url === res.url() && r.status === 0);
      if (existing) existing.status = res.status();
    });

    page.on('requestfailed', (req) => {
      errors.push(`[FAILED] ${req.method()} ${req.url()} - ${req.failure()?.errorText}`);
    });

    page.on('console', (msg) => {
      const text = msg.text();
      consoleAll.push(`[${msg.type()}] ${text}`);
      if (msg.type() === 'error') errors.push(`[CONSOLE ERROR] ${text}`);
    });

    page.on('pageerror', (err) => {
      errors.push(`[PAGE ERROR] ${err.message}`);
    });

    await page.goto(app.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    console.log(`\n========== ${app.name.toUpperCase()} DEEP DIAGNOSTIC ==========`);
    console.log(`Total requests: ${allRequests.length}`);

    // XHR/fetch requests (not images, css, fonts, etc.)
    const fetchRequests = allRequests.filter(r => 
      r.url.includes('/api/') || 
      (r.url.includes('localhost:') && !r.url.match(/\.(png|jpg|css|woff2?|svg|ico)$/))
    );
    console.log(`API/fetch requests: ${fetchRequests.length}`);
    fetchRequests.forEach(r => console.log(`  ${r.method} ${r.status} ${r.url}`));

    // Check for any 4xx/5xx responses
    const errors4xx5xx = allRequests.filter(r => r.status >= 400);
    if (errors4xx5xx.length > 0) {
      console.log(`❌ ${errors4xx5xx.length} requests with 4xx/5xx:`);
      errors4xx5xx.forEach(r => console.log(`  ${r.status} ${r.url}`));
    }

    if (errors.length > 0) {
      console.log(`❌ Errors (${errors.length}):`);
      errors.forEach(e => console.log(`  ${e}`));
    } else {
      console.log('✅ No errors');
    }

    // Log all console messages for debugging
    if (consoleAll.length > 0) {
      console.log(`\n📋 Console output (last 20):`);
      consoleAll.slice(-20).forEach(l => console.log(`  ${l}`));
    }

    await page.screenshot({ path: `/tmp/deep-diagnostic-${app.name}.png`, fullPage: true });
    
    if (errors.length > 0) {
      test.fail(true, `Issues found in ${app.name}`);
    }
  });
}
