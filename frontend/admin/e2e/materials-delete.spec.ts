/**
 * S2 — Material deferred delete on the unified #345 conveyor (spec §6 S2).
 *
 * Material matrix (§4.4): NO non-auto deps and no blocked state —
 *   (a) CLEAN material: the click fires the pure dry-run preview
 *       (DELETE ?dry_run=true, no body) → 204 → optimistic row removal +
 *       «Удалено. Отменить» toast with the 5s countdown ring → commit
 *       DELETE `{expected:{}}` at window end → row physically gone.
 *   (b) LINKED material (GH #223): dry-run → 409 with the single AUTO
 *       `service_materials` node → DeleteDialog with informational lines +
 *       confirm → optimistic removal + ring toast → commit
 *       `{resolutions:{}, expected:{}}` (auto node carries no items) →
 *       material + join rows gone, SERVICE rows survive.
 *
 * Request-level rule (#318/#285): the click's dry-run has
 * postData() === null — every "was the delete committed" assertion keys
 * on the COMMIT DELETE (non-null body), never on the preview.
 */
import { test, expect } from './fixtures/test';
import type { APIRequestContext } from '@playwright/test';
import { cleanup, createTestService } from './fixtures/factories';
import {
  clickRowDelete,
  commitDeleteWait,
  confirmDeleteDialog,
  openRowActionDropdown,
  undoToast,
  waitForMaterialsReady,
  withUndoWindow,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

let materialCounter = 0;
function uid(): string {
  materialCounter += 1;
  return `${Date.now()}_${materialCounter}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Seed a dependency-free material via the backend API. */
async function createSeedMaterial(api: APIRequestContext) {
  const resp = await api.post(`${BACKEND}/api/v1/materials`, {
    data: { title: `Материал ${uid()}`, description: 'e2e S2 seed' },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

test.describe('S2(a) — Clean material: no dialog, deferred commit at window end', () => {
  test('dry-run 204 → ring toast, commit `{expected:{}}`, row physically gone', async ({
    page,
    request,
  }) => {
    const material = await createSeedMaterial(request);

    try {
      await waitForMaterialsReady(page);
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: material.title });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Register BEFORE the click so the listener cannot miss the commit.
      const commitWait = commitDeleteWait(page, '/api/v1/materials', material.id);

      // ACTION — the click dry-runs clean (204, no body) → NO dialog, the
      // row disappears optimistically with the undo toast + ring. The
      // window runs under the paused page clock (#417): the wrapper's
      // instant rewind expires it instead of a real 5.5s sleep;
      // commitDeleteWait above was registered before the window-creating
      // click (helper contract).
      const dropdown = await openRowActionDropdown(row);
      await withUndoWindow(page, async () => {
        await clickRowDelete(dropdown);

        await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
        // The toast is plain React state (UIContext) — it renders on the
        // real macrotask loop and proves the async dry-run resolved and
        // the enqueue (optimistic remove + notifications) completed.
        const toast = undoToast(page);
        await expect(toast).toBeVisible();
        // #417: TanStack Query v5's notifyManager flushes cache→React
        // notifications via setTimeout(0) — frozen under the paused page
        // clock, so the page-level list provider never re-renders. A 1ms
        // fast-forward releases the batch; React then renders the row's
        // optimistic removal through its (unfaked) MessageChannel.
        await page.clock.fastForward(1);
        await expect(row).not.toBeVisible();
        await expect(toast.getByTestId('toast-countdown')).toBeVisible();
      });

      // Window expires → commit fires with the clean-path body → 204.
      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      expect(JSON.parse(commit.request().postData() ?? '{}')).toEqual({ expected: {} });

      // VERIFY DB — hard delete after the window (expired by the wrapper's
      // rewind; the 204 commit response above proves the server finished).
      const getResp = await request.get(`${BACKEND}/api/v1/materials/${material.id}`);
      expect(getResp.status()).toBe(404);
      expect(queryDBRow(`SELECT id FROM materials WHERE id='${material.id}'`)).toBeNull();
    } finally {
      await cleanup(request, `/api/v1/materials/${material.id}`);
    }
  });
});

test.describe('S2(b) — Linked material (#223): auto-cascade dialog → deferred commit', () => {
  /**
   * Material linked to a service → dry-run returns 409 + the dependency
   * tree (entity `service_materials`, relation «Услуга», count 1,
   * allowed_actions ["cascade"], AUTO). DeleteDialog Mode A renders the dep
   * as an AUTO-cascade line (plural label «Услуги» — relation-derived, the
   * service_tags precedent) — information-only, no user choice: no
   * checkbox, «Удалить» enabled immediately. Confirming enqueues the
   * deferred delete (optimistic removal + ring toast) whose commit sends
   * `{resolutions:{}, expected:{}}` (the auto node carries no items →
   * expected is empty) → server cascades the links + hard-deletes →
   * material gone, SERVICE row alive with its badge gone, join rows gone.
   */
  test('dry-run 409 → informational auto line, confirm → ring toast, commit, service alive', async ({
    page,
    request,
  }) => {
    const material = await createSeedMaterial(request);
    const service = await createTestService(request, {
      max_age: 18,
      materials: [{ material_id: material.id }],
    });

    try {
      // Sanity: the link landed (usage counter = 1) before exercising delete.
      const matResp = await request.get(`${BACKEND}/api/v1/materials/${material.id}`);
      expect(matResp.ok()).toBeTruthy();
      expect(((await matResp.json()) as { used_in_services_count: number }).used_in_services_count).toBe(1);

      await waitForMaterialsReady(page);
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: material.title });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // ACTION — the click fires the pure dry-run preview (no body) → 409.
      const dryRunPromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/materials/${material.id}`) &&
          resp.url().includes('dry_run=true') &&
          resp.status() === 409,
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const dryRunJson = await dryRun.json();

      // VERIFY — the 409 tree: the single AUTO node, cascade-only.
      expect(dryRunJson.detail).toBe('has_dependencies');
      expect(dryRunJson.dependencies).toEqual([
        expect.objectContaining({
          entity: 'service_materials',
          count: 1,
          allowed_actions: ['cascade'],
          auto: true,
        }),
      ]);

      // VERIFY UI — Mode A dialog: the auto-cascade dep with the plural
      // join label («Услуги»), count 1, cascade marker «→ … (удалён)».
      // All-auto tree — no confirm checkbox, «Удалить» enabled immediately.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-service_materials"]')).toContainText(
        '→ Услуги: 1 (удалён)',
      );
      await expect(page.locator('[data-testid="delete-dialog-confirm-checkbox"]')).toHaveCount(0);

      // ACTION — confirm; enqueue is sync → dialog closes, row disappears
      // optimistically + ring toast; the commit fires at the 5s window end.
      const commitWait = commitDeleteWait(page, '/api/v1/materials', material.id);
      await confirmDeleteDialog(page);
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
      await expect(row).not.toBeVisible();
      const toast = undoToast(page);
      await expect(toast).toBeVisible();
      await expect(toast.getByTestId('toast-countdown')).toBeVisible();

      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      // The commit body: auto-only tree → empty resolutions + empty expected.
      expect(JSON.parse(commit.request().postData() ?? '{}')).toEqual({
        resolutions: {},
        expected: {},
      });

      // VERIFY API/DB — material + its join rows are physically gone.
      const getResp = await request.get(`${BACKEND}/api/v1/materials/${material.id}`);
      expect(getResp.status()).toBe(404);
      expect(queryDBRow(`SELECT id FROM materials WHERE id='${material.id}'`)).toBeNull();
      expect(queryDBRow(
        `SELECT service_id FROM service_materials WHERE material_id='${material.id}'`,
      )).toBeNull();

      // VERIFY service side — the service row survives; on the remounted
      // services tab its badge for the deleted material is gone.
      await page.getByRole('button', { name: 'Услуги', exact: true }).click();
      await page.waitForSelector('h1:has-text("Управление услугами")', { timeout: 60_000 });
      await page.getByTestId('page-size-select').selectOption('100');
      const svcRow = page.locator('table tbody tr').filter({ hasText: service.title });
      await expect(svcRow).toBeVisible({ timeout: 10_000 });
      await expect(
        svcRow.locator('[data-testid="material-badge"]').filter({ hasText: material.title }),
      ).toHaveCount(0);
      const svcResp = await request.get(`${BACKEND}/api/v1/services/${service.id}`);
      expect(svcResp.ok()).toBeTruthy();
      expect(((await svcResp.json()) as { materials: unknown[] }).materials).toEqual([]);
    } finally {
      await cleanup(request, `/api/v1/services/${service.id}`);
      await cleanup(request, `/api/v1/materials/${material.id}`);
    }
  });
});
