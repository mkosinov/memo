/**
 * S3 — Delete Master WITH activities → blocked, archive instead (Mode B)
 * (#207 §12).
 *
 * Flow: no-body DELETE → 409 with `activities` (allowed_actions: []) →
 * DeleteDialog Mode B: "Нельзя удалить: есть 3 активности.", primary =
 * "Архивировать", NO "Удалить". Archive → POST /masters/{id}/archive →
 * 200 with `archived: true`; row leaves the active view and returns via
 * the archived filter. "Восстановить" → restore → `archived: false`.
 */
import { test, expect } from './fixtures/test';
import { cleanup, createTestActivity, createTestMaster } from './fixtures/factories';
import {
  clickRowArchiveAction,
  clickRowDelete,
  openRowActionDropdown,
  waitForMastersReady,
  waitForToast,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

test.describe('S3 — Master delete blocked by activities → archive instead', () => {
  test('Mode B dialog blocks delete; archive and restore round-trip', async ({ page, request }) => {
    // 1. SETUP — master with 3 activities (the blocking dependency).
    const master = await createTestMaster(request);
    const activities = [];
    try {
      for (let i = 0; i < 3; i += 1) {
        // Point each activity at THIS master (factory defaults use masters[0]).
        activities.push(await createTestActivity(request, { master_id: master.id }));
      }

      await waitForMastersReady(page);
      const row = page.locator(`[data-testid="master-row-${master.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — request delete. Capture the dry-run 409 tree.
      const dryRunPromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/masters/${master.id}`) && resp.status() === 409
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();
      expect(dryRunJson.dependencies).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity: 'activities', count: 3, allowed_actions: [] }),
      ]));

      // 3. VERIFY UI — Mode B: block message, archive primary, no delete.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="delete-dialog-title"]')).toContainText(master.last_name);
      await expect(page.locator('[data-testid="delete-dialog-block-message"]'))
        .toHaveText('Нельзя удалить: есть 3 активности.');
      await expect(page.locator('[data-testid="delete-dialog-archive-btn"]')).toBeVisible();
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="delete-dialog-confirm-input"]')).toHaveCount(0);

      // 4. ACTION — archive. Capture the POST /archive call.
      const archivePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/masters/${master.id}/archive`) && resp.request().method() === 'POST'
      );
      await page.locator('[data-testid="delete-dialog-archive-btn"]').click();
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect((await archive.json()).archived).toBe(true);
      // Dialog path emits no toast (only the dropdown toggle does) — the
      // dialog closing + list refetch are the observable effects here.
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);

      // VERIFY — archived:true server-side + the row leaves the active list.
      expect((await (await request.get(`${BACKEND}/api/v1/masters/${master.id}`)).json()).archived).toBe(true);
      expect(queryDBRow(`SELECT is_active FROM masters WHERE id='${master.id}'`)!.is_active).toBe(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // 5. Switch to the archived view — the row is listed there and offers restore.
      await page.getByLabel('Фильтр по статусу').selectOption('archived');
      await expect(row).toBeVisible({ timeout: 10_000 });
      const archivedDropdown = await openRowActionDropdown(row);
      await expect(
        archivedDropdown.getByRole('menuitem', { name: 'Восстановить' }),
      ).toBeVisible();

      // 6. ACTION — restore. Capture the POST /restore call.
      const restorePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/masters/${master.id}/restore`) && resp.request().method() === 'POST'
      );
      await clickRowArchiveAction(archivedDropdown, 'Восстановить');
      const restore = await restorePromise;
      expect(restore.status()).toBe(200);
      expect((await restore.json()).archived).toBe(false);
      await waitForToast(page, 'Мастер восстановлен');
      await expect(queryDBRow(`SELECT is_active FROM masters WHERE id='${master.id}'`)!.is_active).toBe(1);

      // VERIFY — back in the active list.
      await page.getByLabel('Фильтр по статусу').selectOption('active');
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      for (const activity of activities) {
        await cleanup(request, `/api/v1/activities/${activity.id}`);
      }
      // Activities gone → no-body DELETE now succeeds (no deps remain).
      await cleanup(request, `/api/v1/masters/${master.id}`);
    }
  });
});
