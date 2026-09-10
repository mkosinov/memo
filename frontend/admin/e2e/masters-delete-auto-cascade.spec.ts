/**
 * S2 — Delete Master with NO activities → auto-cascade user (hard-delete)
 * + auto-cascade tags (#207 §12, Change 2).
 *
 * Flow (§12 S2): no-body DELETE → 409 with `users` (cascade, auto) +
 * `master_tags` (cascade, auto). Dialog Mode A shows BOTH as auto-deps
 * ("→ Пользователь: 1 (удалён)" / "→ Теги: N (удалены)") with NO choice.
 * Type-confirm → DELETE with body `{resolutions:{}}` → 204; master, the
 * linked user row AND the join rows are physically gone (§4.1).
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
  waitForMastersReady,
  waitForToast,
} from './fixtures/helpers';
import { queryDB, queryDBRow, queryDBRows } from './fixtures/db-query';
import { displayMasterName } from '@/lib/utils';

let userCounter = 0;
function uniquePhone(): string {
  userCounter += 1;
  return `+7999${String(Date.now()).slice(-7)}${userCounter}`;
}

test.describe('S2 — Master delete with no activities (auto cascades)', () => {
  test('type-confirm delete cascades the linked user and tags in one transaction', async ({ page, request }) => {
    // 1. SETUP — master with a linked user + 2 tags, NO activities.
    const master = await createTestMaster(request);
    const phone = uniquePhone();
    const userId = seedUser({ phone, masterId: master.id });
    const tagRows = [
      await createTestMasterTag(request, master.id),
      await createTestMasterTag(request, master.id),
    ];

    try {
      await waitForMastersReady(page);
      const displayName = displayMasterName(master);
      const row = page.locator(`[data-testid="master-row-${master.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — open the delete dialog. Capture the dry-run 409 tree.
      const dryRunPromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/masters/${master.id}`) && resp.status() === 409
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // 3. VERIFY — 409 tree: users + master_tags, both cascade-only, no block.
      expect(dryRunJson.dependencies).toEqual(expect.arrayContaining([
        expect.objectContaining({ entity: 'users', count: 1, allowed_actions: ['cascade'] }),
        expect.objectContaining({ entity: 'master_tags', count: 2, allowed_actions: ['cascade'] }),
      ]));
      expect(dryRunJson.dependencies.some((d: any) => d.allowed_actions.length === 0)).toBe(false);

      // VERIFY UI — Mode A: both auto-deps rendered, no choice offered.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-users"]')).toContainText('Пользователь');
      await expect(page.locator('[data-testid="dep-users"]')).toContainText('1');
      await expect(page.locator('[data-testid="dep-users"]')).toContainText('удалён');
      await expect(page.locator('[data-testid="dep-master_tags"]')).toContainText('Теги');
      await expect(page.locator('[data-testid="dep-master_tags"]')).toContainText('2');
      await expect(page.locator('[data-testid="dep-master_tags"]')).toContainText('удалены');
      // Auto deps are plain <li>s — no choice buttons inside them.
      await expect(page.locator('[data-testid="dep-users"] button')).toHaveCount(0);
      await expect(page.locator('[data-testid="dep-master_tags"] button')).toHaveCount(0);
      // Confirm gated on the typed name.
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();

      // ACTION — capture the resolve call; type the name; confirm.
      const resolvePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/masters/${master.id}`) && resp.request().method() === 'DELETE'
      );
      await confirmDeleteDialog(page, displayName);
      const resolve = await resolvePromise;
      const postBody = () => {
        try { return JSON.parse(resolve.request().postData() ?? ''); }
        catch { return undefined; }
      };
      expect(resolve.status()).toBe(204);
      expect(postBody()).toEqual({ resolutions: {} });
      await waitForToast(page, 'Мастер удалён');
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // 4. VERIFY DB — master, linked user and BOTH tag join rows are gone.
      expect(queryDBRow(`SELECT id FROM masters WHERE id='${master.id}'`)).toBeNull();
      expect(queryDBRows(`SELECT * FROM users WHERE master_id='${master.id}'`)).toHaveLength(0);
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
      await cleanup(request, `/api/v1/masters/${master.id}`);
    }
  });
});
