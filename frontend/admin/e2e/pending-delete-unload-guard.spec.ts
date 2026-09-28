import { test, expect } from './fixtures/test';
import type { Dialog, Page, Request } from '@playwright/test';
import { queryDBRow } from './fixtures/db-query';
import { createTestActivity, cleanup } from './fixtures/factories';
import { waitForScheduleReady } from './fixtures/helpers';
import { clickFabRobust } from './fixtures/server-push';

/**
 * GH #397 — beforeunload guard over the pending-actions pipeline
 * (spec §7, scenario C3 best-effort e2e). The Chromium-native leave dialog
 * is driven through Playwright dialog events; the determinism recipe
 * (spec §7, fixed):
 *
 *  - the `page.on('dialog')` recorder is armed BEFORE the unload action;
 *  - the user gesture is the delete click itself (Chromium only shows a
 *    beforeunload dialog after a user gesture on the page);
 *  - the tab-close path goes through page.close({ runBeforeUnload: true });
 *  - the reload path is page.reload() with the dialog accepted / dismissed.
 *
 * Deferred-delete setup reuses the #286 recipe (activity card in delete
 * mode): optimistic removal + 5s undo window; the COMMIT DELETE carries a
 * JSON body while the click's dry-run has none (postData() === null).
 *
 * Full Cycle per test: SETUP via factories → UI action → UI asserts →
 * DB asserts (SQLite) → cleanup in finally. The close-path test asserts
 * only the guard-armed FACT (dialog event); the row's fate after the tab
 * is closed is not observable and deliberately not checked.
 */

/** The deferred-delete undo window (ms) — keep in sync with the pipeline. */
const WINDOW_MS = 5_000;

/** The undo toast that carries the deferred-delete message (#94 countdown). */
function undoToast(page: Page) {
  return page.locator('[data-testid="toast-info"]').filter({ hasText: 'Удалено. Отменить' });
}

/** Enable «Режим удаления» in the right panel (open through the FAB if
 *  collapsed — clickFabRobust waits out corner-sharing toasts, #239). */
async function enableDeleteMode(page: Page) {
  const panel = page.locator('[data-testid="right-panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await clickFabRobust(page);
  }
  await page.getByRole('button', { name: 'Режим удаления' }).click();
}

/** Click the activity card (real mouse first; the WeekView carousel may
 *  demote overlapping cards to pointer-events:none — dispatchEvent reaches
 *  the same React handler, #286 S5 pattern). */
async function clickCard(page: Page, activityId: string) {
  const card = page.locator(`[data-testid="activity-${activityId}"]`);
  await card.click({ timeout: 5_000 }).catch(() => card.dispatchEvent('click'));
  return card;
}

/** COMMIT-DELETE waiter: the deferred commit carries a JSON body
 *  (`expected`); the click's dry-run (?dry_run=true) has none. */
function commitDeleteWait(page: Page, activityId: string) {
  return page.waitForResponse(
    (r) =>
      r.url().includes(`/api/v1/activities/${activityId}`) &&
      r.request().method() === 'DELETE' &&
      r.request().postData() !== null,
    { timeout: 20_000 },
  );
}

/** Tracker of COMMITTING activity deletes (DELETE with a NON-EMPTY body).
 *  Page-level listeners survive reloads, so the tracker also covers the
 *  fresh document after an accepted leave. */
function trackBodyDeletes(page: Page, activityId: string) {
  const bodyDeletes: string[] = [];
  const onRequest = (req: Request) => {
    if (
      req.method() === 'DELETE' &&
      req.url().includes(`/api/v1/activities/${activityId}`) &&
      req.postData() !== null
    ) {
      bodyDeletes.push(req.url());
    }
  };
  page.on('request', onRequest);
  return { bodyDeletes, stop: () => page.off('request', onRequest) };
}

/**
 * Dialog recorder — records every native dialog and hands each one to the
 * test through `next()`. Registering the listener BEFORE the action is a
 * spec §7 precondition: with no listener Playwright auto-dismisses every
 * dialog, which for beforeunload CANCELS the navigation silently — the
 * recorder guarantees the event can never be eaten unnoticed. The test
 * owns the dialog it takes (accept()/dismiss()).
 */
function armDialogRecorder(page: Page) {
  const seen: Dialog[] = [];
  const waiters: ((d: Dialog) => void)[] = [];
  page.on('dialog', (d) => {
    seen.push(d);
    waiters.splice(0).forEach((resolve) => resolve(d));
  });
  return {
    seen,
    next: () => new Promise<Dialog>((resolve) => waiters.push(resolve)),
  };
}

/**
 * Start a deferred activity delete (delete mode + card click) and wait
 * until the pipeline is provably armed: optimistic removal + undo toast
 * visible — the same render pass that raised the pending counter. The
 * small buffer lets the guard's useEffect attach the beforeunload
 * listener (useEffect runs after paint; the toast check polls the DOM).
 */
async function startDeferredDelete(page: Page, activityId: string) {
  await enableDeleteMode(page);
  await clickCard(page, activityId);
  await expect(page.locator(`[data-testid="activity-${activityId}"]`)).not.toBeVisible();
  await expect(undoToast(page)).toBeVisible();
  await page.waitForTimeout(150);
}

test.describe('Pending-delete unload guard (GH #397, C3 best-effort)', () => {
  // ── C3 «Покинуть»: leave accepted in-window — deletion cancelled ────────

  test('C3 leave: reload in window, dialog accepted — row back after load, no commit DELETE', async ({
    page,
    request,
  }) => {
    const activity = await createTestActivity(request);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Recorder + tracker armed BEFORE the action (spec §7).
      const dialogs = armDialogRecorder(page);
      const { bodyDeletes, stop } = trackBodyDeletes(page, activity.id);

      await startDeferredDelete(page, activity.id);

      // Leave in-window: the reload raises the native dialog; accept =
      // leave with consent → the pending timer dies with the old document.
      const reloadP = page.reload();
      const dialog = await dialogs.next();
      expect(dialog.type()).toBe('beforeunload');
      await dialog.accept();
      await reloadP;

      // After the fresh load the row is back (the deletion never
      // committed)…
      await expect(card).toBeVisible({ timeout: 10_000 });
      // …and the activity is alive in the DB…
      const row = queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`);
      expect(row).not.toBeNull();
      // …and letting the original window fully elapse proves no committing
      // DELETE was ever sent (the timer died with the unloaded document).
      await page.waitForTimeout(WINDOW_MS + 500);
      expect(bodyDeletes).toHaveLength(0);
      stop();
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── C3 «Остаться»: leave refused in-window — window elapses, row gone ───

  test('C3 stay: reload in window, dialog dismissed — window elapses, commit DELETE, row gone', async ({
    page,
    request,
  }) => {
    const activity = await createTestActivity(request);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // Register BEFORE the click so the listener cannot miss the
      // window-end commit response.
      const commitWait = commitDeleteWait(page, activity.id);
      const dialogs = armDialogRecorder(page);

      await startDeferredDelete(page, activity.id);

      // Stay in-window: the reload raises the dialog; dismiss = stay →
      // Chromium cancels the reload (the promise may reject or hang —
      // caught, never awaited).
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).__memoC3Stay = true;
      });
      const reloadP = page.reload().catch(() => {});
      const dialog = await dialogs.next();
      expect(dialog.type()).toBe('beforeunload');
      await dialog.dismiss();

      // The same document survived the cancelled reload…
      expect(
        await page.evaluate(
          () => (window as unknown as Record<string, unknown>).__memoC3Stay,
        ),
      ).toBe(true);
      void reloadP;

      // …the window elapses untouched → the commit DELETE fires → 204.
      const commit = await commitWait;
      expect(commit.status()).toBe(204);

      // Drain buffer: the inflight decrement lands after the response,
      // the guard's effect cleanup right after it.
      await page.waitForTimeout(1_000);

      // Fresh load: the row is gone from the grid and from the DB. The
      // defensive auto-accept only guards the verification navigation
      // against a drain race — by now the pipeline is empty and nothing
      // is left to cancel.
      page.on('dialog', (d) => void d.accept().catch(() => {}));
      await waitForScheduleReady(page);
      await expect(page.locator(`[data-testid="activity-${activity.id}"]`)).toHaveCount(0);
      expect(queryDBRow(`SELECT id FROM activities WHERE id='${activity.id}'`)).toBeNull();
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── Negative: pipeline drained — close raises NO dialog (guard removed) ──

  test('negative: window elapsed, pipeline drained — page.close raises no dialog', async ({
    page,
    request,
  }) => {
    const activity = await createTestActivity(request);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      const commitWait = commitDeleteWait(page, activity.id);

      await startDeferredDelete(page, activity.id);

      // Let the window elapse: the commit fires and completes → both
      // counters drain → the guard's effect cleanup removes the listener.
      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      await page.waitForTimeout(1_000); // effect-flush buffer

      // Recorder armed BEFORE the close; a stray dialog is dismissed so
      // the close could never get stuck on an unhandled dialog.
      const seen: Dialog[] = [];
      page.on('dialog', (d) => {
        seen.push(d);
        void d.dismiss().catch(() => {});
      });

      await page.close({ runBeforeUnload: true });
      await page.waitForEvent('close', { timeout: 10_000 }).catch(() => {});
      expect(page.isClosed()).toBe(true);
      expect(seen).toHaveLength(0);
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  // ── Positive close: in-window close — the dialog event arrives ──────────

  test('positive close: delete → page.close({ runBeforeUnload: true }) in window — dialog arrives', async ({
    page,
    request,
  }) => {
    const activity = await createTestActivity(request);

    try {
      await waitForScheduleReady(page);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      const dialogs = armDialogRecorder(page);

      await startDeferredDelete(page, activity.id);

      // Close the tab in-window: the guard must raise the native dialog
      // (the FACT of being armed is the assertion — the row's fate after
      // the close is deliberately not checked; the finally-cleanup owns
      // the leftover activity).
      const closeP = page.close({ runBeforeUnload: true });
      const dialog = await dialogs.next();
      expect(dialog.type()).toBe('beforeunload');
      await dialog.accept();
      await closeP;
      await page.waitForEvent('close', { timeout: 10_000 }).catch(() => {});
      expect(page.isClosed()).toBe(true);
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });
});
