/**
 * S3 — Delete Staff card WITH activities → blocked, archive instead (Mode B)
 * (#207 §12, GH #266: the flow moved from /masters to /staff).
 *
 * Flow: no-body DELETE → 409 with `activities` (allowed_actions: []) →
 * DeleteDialog Mode B: "Нельзя удалить: есть 3 активности.", primary =
 * "Архивировать", NO "Удалить". Archive → POST /staff/{id}/archive (body =
 * D6 defaults, both true) → 200 with `archived: true`; row leaves the active
 * view and returns via the archived filter. "Вернуть из архива" → restore →
 * `archived: false` (the PERSON only — master/user flags are explicit, D3).
 */
import { test, expect } from './fixtures/test';
import { cleanup, createTestActivity, createTestMaster } from './fixtures/factories';
import {
  clickRowDelete,
  clickRowStaffArchiveAction,
  openRowActionDropdown,
  waitForStaffReady,
  waitForToast,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

test.describe('S3 — Staff delete blocked by activities → archive instead', () => {
  test('Mode B dialog blocks delete; archive and restore round-trip', async ({ page, request }) => {
    // 1. SETUP — staff card (with master section) + 3 activities (the blocking dep).
    const master = await createTestMaster(request);
    const activities = [];
    try {
      for (let i = 0; i < 3; i += 1) {
        // Point each activity at THIS master (factory defaults use masters[0]).
        activities.push(await createTestActivity(request, { master_id: master.id }));
      }

      await waitForStaffReady(page);
      const row = page.locator(`[data-testid="master-row-${master.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — request delete. Capture the dry-run 409 tree.
      const dryRunPromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/staff/${master.id}`) && resp.status() === 409
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

      // 4. ACTION — archive. Capture the POST /archive call (the dialog path
      // sends the D6 checkbox body — both defaults true).
      const archivePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/staff/${master.id}/archive`) && resp.request().method() === 'POST'
      );
      await page.locator('[data-testid="delete-dialog-archive-btn"]').click();
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect((await archive.json()).archived).toBe(true);
      // Dialog path emits no toast (only the dropdown D6 dialog does) — the
      // dialog closing + list refetch are the observable effects here.
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);

      // VERIFY — archived:true server-side + the row leaves the active list.
      // (GET /masters/{id} was removed in #266 — the card reads from /staff.)
      expect((await (await request.get(`${BACKEND}/api/v1/staff/${master.id}`)).json()).archived).toBe(true);
      expect(queryDBRow(`SELECT is_active FROM staff WHERE id='${master.id}'`)!.is_active).toBe(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // 5. Switch to the archived view — the row is listed there and offers restore.
      await page.getByLabel('Фильтр по статусу').selectOption('archived');
      await expect(row).toBeVisible({ timeout: 10_000 });
      const archivedDropdown = await openRowActionDropdown(row);
      await expect(
        archivedDropdown.getByRole('menuitem', { name: 'Вернуть из архива' }),
      ).toBeVisible();

      // 6. ACTION — restore. Capture the POST /restore call (#266 terminology:
      // «Вернуть из архива», D2/D11).
      const restorePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/staff/${master.id}/restore`) && resp.request().method() === 'POST'
      );
      await clickRowStaffArchiveAction(archivedDropdown, 'Вернуть из архива');
      const restore = await restorePromise;
      expect(restore.status()).toBe(200);
      expect((await restore.json()).archived).toBe(false);
      await waitForToast(page, 'Сотрудник возвращён из архива');
      await expect(queryDBRow(`SELECT is_active FROM staff WHERE id='${master.id}'`)!.is_active).toBe(1);
      // D3: restore returns the PERSON only — the master section stays archived
      // (the archive dialog flipped it with the preselected checkbox).
      await expect(queryDBRow(`SELECT is_active FROM masters WHERE staff_id='${master.id}'`)!.is_active).toBe(0);

      // VERIFY — back in the active list.
      await page.getByLabel('Фильтр по статусу').selectOption('active');
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      for (const activity of activities) {
        await cleanup(request, `/api/v1/activities/${activity.id}`);
      }
      // Activities gone → no-body DELETE now succeeds (no deps remain).
      await cleanup(request, `/api/v1/staff/${master.id}`);
    }
  });
});
