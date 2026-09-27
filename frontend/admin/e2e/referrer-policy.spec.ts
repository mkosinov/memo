/**
 * referrer-policy.spec.ts — GH #384.
 *
 * Every admin response carries `Referrer-Policy: no-referrer`, and an
 * outbound cross-origin navigation from an admin page carries no Referer.
 *
 * The header assertions run against a SAMPLED route set: they catch config
 * loss as a whole, not a future per-route override (spec §2). The behavioral
 * check injects a plain external anchor (no rel="noreferrer") so it tests
 * the PAGE-LEVEL policy, not per-link markup discipline; Playwright route
 * interception has no real network egress.
 */
import { test, expect } from './fixtures/test';

test.describe('Referrer-Policy: no-referrer', () => {
  for (const route of ['/login', '/clients', '/locations', '/no-such-page-404', '/logo-white.png']) {
    test(`response carries the policy: ${route}`, async ({ request }) => {
      const res = await request.get(route);
      expect(res.headers()['referrer-policy'], `Referrer-Policy on ${route}`).toBe('no-referrer');
    });
  }

  test('a /_next/static chunk carries the policy', async ({ request }) => {
    const login = await request.get('/login');
    const html = await login.text();
    const chunk = html.match(/\/_next\/static\/[^"']+\.js/);
    expect(chunk, 'a build chunk URL in the login page HTML').toBeTruthy();
    const res = await request.get(chunk![0]);
    expect(res.ok(), `chunk ${chunk![0]} loads`).toBeTruthy();
    expect(res.headers()['referrer-policy'], 'Referrer-Policy on a static chunk').toBe('no-referrer');
  });

  test('outbound external navigation sends no Referer', async ({ page }) => {
    const intercepted = new Promise<Record<string, string>>((resolve) => {
      void page.route('**/echo-ext', (route) => {
        resolve(route.request().headers());
        void route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body>echo</body></html>' });
      });
    });

    await page.goto('/login');
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = 'https://external.example/echo-ext';
      a.className = 'external-echo';
      a.textContent = 'external';
      document.body.appendChild(a);
    });
    await page.click('a.external-echo');

    const headers = await intercepted;
    expect(headers['referer'], 'Referer must be absent under no-referrer').toBeUndefined();
  });
});
