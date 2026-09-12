/**
 * S2 — Delete Staff card with NO activities → auto-cascade user (hard-delete)
 * + auto-cascade tags/positions (#207 §12 Change 2, GH #266: the flow moved
 * from /masters to /staff; the FK matrix adds `masters` + `staff_positions`
 * auto-cascades).
 *
 * Flow: no-body DELETE → 409 with `users` (cascade, auto) + `master_tags`
 * (cascade, auto) + `masters`/`staff_positions` (cascade, auto). Dialog Mode A
 * shows them as auto-deps with NO choice. Type-confirm → DELETE with body
 * `{resolutions:{}}` → 204; the card, the linked user row, the masters
 * extension row AND the join rows are physically gone.
 */
import { test, expect } from './fixtures/test';
import {
  cleanup,
  createTestMaster,
  createTestMasterTag,
  seedUser,
} from './fixtures/factories';
import {
  clickRowDelete,
  confirmDeleteDialog,
  openRowActionDropdown,
  waitForStaffReady,
  waitForToast,
} from './fixtures/helpers';
import { queryDB, queryDBRow, queryDBRows } from './fixtures/db-query';

let userCounter = 0;
function uniquePhone(): string {
  userCounter += 1;
  return `+7999${String(Date.now()).slice(-7)}${userCounter}`;
}

test.describe('S2 — Staff delete with no activities (auto cascades)', () => {
  test('type-confirm delete cascades the linked user, masters row, tags and positions', async ({ page, request }) => {
    // 1. SETUP — staff card (with master section) + linked user + 2 tags, NO activities.
    const master = await createTestMaster(request);
    const phone = uniquePhone();
    const userId = seedUser({ phone, masterId: master.id });
    const tagRows = [
      await createTestMasterTag(request, master.id),
      await createTestMasterTag(request, master.id),
    ];

    try {
      await waitForStaffReady(page);
      const row = page.locator(`[data-testid="master-row-${master.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — open the delete dialog. Capture the dry-run 409 tree.
      const dryRunPromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/staff/${master.id}`) && resp.status() === 409
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // 3. VERIFY — 409 tree: users + master_tags + masters + staff_positions,
      // all cascade-only, no block.
      expect(dryRunJson.dependencies).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity: 'users', count: 1, allowed_actions: ['cascade'] }),
        expect.objectContaining({ entity: 'master_tags', count: 2, allowed_actions: ['cascade'] }),
        expect.objectContaining({ entity: 'masters', count: 1, allowed_actions: ['cascade'] }),
        expect.objectContaining({ entity: 'staff_positions', allowed_actions: ['cascade'] }),
      ]));
      expect(dryRunJson.dependencies.some((d: any) => d.allowed_actions.length === 0)).toBe(false);

      // VERIFY UI — Mode A: the auto-deps render, no choice offered.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-users"]')).toContainText('Пользователь');
      await expect(page.locator('[data-testid="dep-users"]')).toContainText('1');
      await expect(page.locator('[data-testid="dep-users"]')).toContainText('удалён');
      await expect(page.locator('[data-testid="dep-master_tags"]')).toContainText('Теги');
      await expect(page.locator('[data-testid="dep-master_tags"]')).toContainText('2');
      await expect(page.locator('[data-testid="dep-master_tags"]')).toContainText('удалены');
      await expect(page.locator('[data-testid="dep-masters"]')).toContainText('Мастер');
      await expect(page.locator('[data-testid="dep-staff_positions"]')).toContainText('Должности');
      // Auto deps are plain <li>s — no choice checkboxes inside them.
      await expect(page.locator('[data-testid="dep-users"] label')).toHaveCount(0);
      // All deps auto — confirm is enabled immediately (no choice, no checkbox).

      // ACTION — capture the resolve call; confirm.
      const resolvePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/staff/${master.id}`) && resp.request().method() === 'DELETE'
      );
      await confirmDeleteDialog(page);
      const resolve = await resolvePromise;
      const postBody = () => {
        try { return JSON.parse(resolve.request().postData() ?? ''); }
        catch { return undefined; }
      };
      expect(resolve.status()).toBe(204);
      expect(postBody()).toEqual({ resolutions: {} });
      await waitForToast(page, 'Сотрудник удалён');
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // 4. VERIFY DB — card, masters extension, linked user and BOTH tag join
      // rows + the position links are gone.
      expect(queryDBRow(`SELECT id FROM staff WHERE id='${master.id}'`)).toBeNull();
      expect(queryDBRow(`SELECT staff_id FROM masters WHERE staff_id='${master.id}'`)).toBeNull();
      expect(queryDBRows(`SELECT * FROM users WHERE staff_id='${master.id}'`)).toHaveLength(0);
      expect(queryDBRows(`SELECT * FROM staff_positions WHERE staff_id='${master.id}'`)).toHaveLength(0);
      for (const tag of tagRows) {
        expect(queryDBRows(
          `SELECT * FROM master_tags WHERE master_id='${master.id}' AND tag_id='${tag.id}'`,
        )).toHaveLength(0);
      }

      // Tags themselves are shared rows — still present, only the links died.
      for (const tag of tagRows) {
        expect(queryDBRow(`SELECT id FROM tags WHERE id='${tag.id}'`)).not.toBeNull();
      }
    } finally {
      // Cleanup the user row directly (no API writer/endpoint for users);
      // on a passing test the row is already hard-deleted — a no-op DELETE.
      try {
        queryDB(`DELETE FROM users WHERE id='${userId}'`);
      } catch {
        // Ignore cleanup errors — row may already be gone.
      }
      for (const tag of tagRows) {
        await cleanup(request, `/api/v1/tags/${tag.id}`);
      }
      await cleanup(request, `/api/v1/staff/${master.id}`);
    }
  });
});
