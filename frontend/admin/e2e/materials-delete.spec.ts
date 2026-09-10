/**
 * S1 — Delete Material (no deps) → instant hard delete (#207 §12).
 *
 * Material has ZERO FK dependencies (§4 matrix), so the no-body DELETE
 * returns 204 immediately — no dialog appears. Row vanishes, GET → 404,
 * and the DB row is physically gone.
 *
 * GH #223 S5 — Delete a LINKED material → 409 + dependency tree
 * (entity `service_materials`, relation «Услуга», allowed_actions
 * ["cascade"]) → DeleteDialog Mode A shows the auto-cascade dep
 * («Услуги: 1 (удалён)») → type-confirm → material gone, service row
 * alive, its badges updated.
 */
import { test, expect } from './fixtures/test';
import type { APIRequestContext } from '@playwright/test';
import { cleanup, createTestService } from './fixtures/factories';
import {
  clickRowDelete,
  confirmDeleteDialog,
  openRowActionDropdown,
  waitForMaterialsReady,
  waitForToast,
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
    data: { title: `Материал ${uid()}`, description: 'e2e S1 seed' },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

test.describe('S1 — Delete material without dependencies', () => {
  test('hard-deletes instantly: no dialog, row gone, API 404', async ({ page, request }) => {
    const material = await createSeedMaterial(request);

    try {
      await waitForMaterialsReady(page);
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: material.title });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // ACTION — click "Удалить" in the row dropdown.
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);

      // VERIFY UI — the no-body DELETE returns 204 (zero deps), so NO
      // DeleteDialog appears (defensive: if one ever opens, fail loud).
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
      await waitForToast(page, 'Материал удалён');
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // VERIFY DB — API returns 404 and the row is physically deleted.
      const getResp = await request.get(`${BACKEND}/api/v1/materials/${material.id}`);
      expect(getResp.status()).toBe(404);
      const dbRow = queryDBRow(`SELECT id FROM materials WHERE id='${material.id}'`);
      expect(dbRow).toBeNull();
    } finally {
      await cleanup(request, `/api/v1/materials/${material.id}`);
    }
  });

  test('defensive 409 branch: dialog appears and type-confirm completes the delete', async ({ page, request }) => {
    // With zero real deps the no-body DELETE returns 204 — this test runs the
    // same DeleteDialog wiring via a network-layer intercepted 409, keeping
    // the Mode A branch covered end to end regardless of the live matrix.
    // GH #223 makes the branch LIVE for real links — see the S5 test below.
    const material = await createSeedMaterial(request);

    try {
      await waitForMaterialsReady(page);
      const row = page
        .locator('table tbody tr')
        .filter({ hasText: material.title });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Force the 409 dry-run path at the network layer: the table's first
      // DELETE hits this intercepted no-body delete and receives a 409
      // dependency tree (defensive branch), then opens the DeleteDialog.
      let dryRunHit = false;
      await page.route(
        (url) => url.pathname === `/api/v1/materials/${material.id}` && url.search === '',
        (route) => {
          if (dryRunHit || route.request().method() !== 'DELETE') {
            return route.continue();
          }
          dryRunHit = true;
          return route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              detail: 'has_dependencies',
              dependencies: [{
                entity: 'photos',
                relation: 'Фото',
                count: 1,
                allowed_actions: ['cascade'],
                message: null,
                cascade_preview: null,
              }],
            }),
          });
        },
      );

      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);

      // VERIFY UI — Mode A dialog with the auto-cascaded dep.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-photos"]')).toContainText('→ Фото: 1 (удалён)');

      // ACTION — confirm (all deps auto → enabled immediately, real DELETE,
      // body `{resolutions:{}}`).
      await confirmDeleteDialog(page);
      await waitForToast(page, 'Материал удалён');
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // VERIFY DB — physically gone.
      const getResp = await request.get(`${BACKEND}/api/v1/materials/${material.id}`);
      expect(getResp.status()).toBe(404);
      const dbRow = queryDBRow(`SELECT id FROM materials WHERE id='${material.id}'`);
      expect(dbRow).toBeNull();
    } finally {
      await cleanup(request, `/api/v1/materials/${material.id}`);
    }
  });
});

test.describe('S5 — Delete linked material (#223): 409 dependency flow', () => {
  /**
   * Material linked to a service → no-body DELETE returns 409 + dependency
   * tree (entity `service_materials`, relation «Услуга», count 1,
   * allowed_actions ["cascade"]). DeleteDialog Mode A must render the dep as
   * an AUTO-cascade line (plural label «Услуги», like the `service_tags` join
   * renders «Теги») — no user choice needed, type-confirm alone unlocks
   * «Удалить». Confirming sends `{resolutions:{}}` → server cascades the
   * links + hard-deletes → material gone from the table, service row alive
   * with its badge gone, join rows gone from the DB.
   */
  test('linked material → 409 dialog shows «Услуги: 1», confirm → material gone, service alive', async ({
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

      // ACTION — delete the linked material.
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);

      // VERIFY UI — Mode A dialog: auto-cascade dep with the plural join
      // label («Услуги»), count 1, cascade marker «→ … (удалён)».
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-service_materials"]')).toContainText(
        '→ Услуги: 1 (удалён)',
      );
      // All-auto tree — no confirm checkbox, «Удалить» enabled immediately.
      await confirmDeleteDialog(page);
      await waitForToast(page, 'Материал удалён');
      await expect(page.locator('[data-testid="delete-dialog"]')).toHaveCount(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // VERIFY API/DB — material + its join rows are physically gone.
      const getResp = await request.get(`${BACKEND}/api/v1/materials/${material.id}`);
      expect(getResp.status()).toBe(404);
      const dbRow = queryDBRow(`SELECT id FROM materials WHERE id='${material.id}'`);
      expect(dbRow).toBeNull();
      const linkRow = queryDBRow(
        `SELECT service_id FROM service_materials WHERE material_id='${material.id}'`,
      );
      expect(linkRow).toBeNull();

      // VERIFY service side — the service row survives; on the remounted
      // services tab its badge for the deleted material is gone (usage
      // counters consistent: the service has no materials left).
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
