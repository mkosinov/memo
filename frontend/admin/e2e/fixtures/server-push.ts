/**
 * server-push.ts — shared fixture + helpers for the #239 SSE channel specs
 * (server-push-invalidation.spec.ts, server-push-offline.spec.ts).
 *
 * Two browser contexts = two admins (A and B): separate contexts give
 * separate module-level tab identities (spec §2.4), so B's UI writes carry
 * B's X-Memo-Tab-Id and A must see the external toast.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { waitForScheduleReady, openAddTab } from './helpers';

/** Spec §6 — "within seconds"; deliberately BELOW the app-wide staleTime
 *  (30s) and the dictionary staleTime (1h): a test that passes without the
 *  SSE channel would be testing staleTime, not the channel. */
export const PUSH_WINDOW = 5_000;

/** Reconnect convergence budget (spec §6 С5 — "within ~10s of back online"). */
export const RECONNECT_WINDOW = 10_000;

/** Direct backend base for bare-API cleanup (same default as factories). */
export const API_BASE = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Unique marker prefix so parallel specs never collide. */
export function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Assert that a "Данные обновлены" info toast is (or becomes) visible.
 *
 * Scoped with a text filter + `.first()`: parallel specs broadcasting their
 * own pushes land foreign toasts on every open context, so several
 * toast-info elements can be stacked at once (container shows up to 5) —
 * an unscoped getByTestId('toast-info') would trip strict mode.
 */
export function expectUpdateToast(page: Page) {
  return expect(
    page.getByTestId('toast-info').filter({ hasText: 'Данные обновлены' }).first(),
  ).toBeVisible({ timeout: PUSH_WINDOW });
}

/**
 * Assert that NO "Данные обновлены" toast is on screen (own-mutation
 * silence, spec §6 С6 — origin matches this tab).
 *
 * NON-RETRYING probe placed INSIDE the toast lifetime, called immediately
 * after the own mutation resolves: the SSE echo arrives within milliseconds,
 * the toast (if suppression is broken) lives ~4.5s — a 2s wait puts the
 * snapshot safely past echo latency and well before auto-dismiss. The
 * instant `expect(count).toBe(0)` cannot be absorbed by Playwright's retry:
 * a retrying anti-assertion (`toHaveCount(0, {timeout})`) would poll until
 * the transient toast dies on its own and pass vacuously.
 */
export async function expectNoUpdateToast(page: Page) {
  await page.waitForTimeout(2_000); // echo latency (ms) << 2s << toast lifetime (~4.5s)
  const count = await page
    .getByTestId('toast-info')
    .filter({ hasText: 'Данные обновлены' })
    .count();
  expect(count, 'own mutation must not raise the «Данные обновлены» toast').toBe(0);
}

/**
 * Dismiss/wait out transient toast overlays before a click.
 *
 * The toast container (fixed bottom-right, z-[250]) shares the screen corner
 * with the StampFab (fixed bottom-right, z-50); a toast overlapping the FAB
 * swallows the click and the panel never opens. Foreign pushes from parallel
 * specs can pop a toast at ANY moment, so a one-shot wait is not enough —
 * retry the click until it lands, re-waiting out overlays after each miss.
 */
export async function clickFabRobust(page: Page, timeoutMs = 15_000) {
  const fab = page.getByRole('button', { name: 'Открыть панель инструментов' });
  const toasts = page.locator('[data-testid^="toast-"]');
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    await expect(fab).toBeVisible({ timeout: 5_000 });
    if ((await toasts.count()) > 0) {
      // Overlay present — let it die (toast life ~4.5s), then re-check.
      await toasts
        .first()
        .waitFor({ state: 'detached', timeout: Math.max(1, deadline - Date.now()) })
        .catch(() => {});
    }
    try {
      await fab.click({ timeout: 2_000 }); // no force — hit-target check is the guard
      return;
    } catch {
      if (Date.now() > deadline) throw new Error('FAB click never landed (overlay retries exhausted)');
    }
  }
}

/**
 * Create a record through B's UI (schedule → quick add → new booking tab)
 * so the write carries B's real tab header. The booking lands on an
 * activity of the CURRENT week so the record is inside the records page's
 * default date range. Returns the record payload from the POST /api/v1/records
 * response (for cleanup).
 */
export async function createRecordViaUI(pageB: Page, clientName: string) {
  await waitForScheduleReady(pageB);
  const today = new Date().toISOString().slice(0, 10);
  await openAddTab(pageB, { date: today });

  const phone = `+7999${Date.now().toString().slice(-7)}`;
  await pageB.getByTestId('input-phone').fill(phone);
  await pageB.getByTestId('input-client-name').fill(clientName);

  const createResponse = pageB.waitForResponse(
    (r) => r.url().includes('/api/v1/records') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  await pageB.getByTestId('btn-create-record').click();
  const resp = await createResponse;
  expect(resp.status()).toBe(201);
  return (await resp.json()) as { id: string; client_id: string };
}

/**
 * Two-context fixture: pageA (observer, context also exposed as ctxA for
 * setOffline outage emulation) and pageB (writer).
 */
export const serverPushPages = test.extend<{
  pageA: Page;
  ctxA: BrowserContext;
  pageB: Page;
}>({
  pageA: async ({ browser }, use) => {
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await use(pageA);
    await ctxA.close();
  },
  ctxA: async ({ pageA }, use) => {
    // pageA's owning context — same object Playwright created above.
    await use(pageA.context());
  },
  pageB: async ({ browser }, use) => {
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await use(pageB);
    await ctxB.close();
  },
});
