/**
 * S1 — Delete Material (no deps) → instant hard delete (#207 §12).
 *
 * Material has ZERO FK dependencies (§4 matrix), so the no-body DELETE
 * returns 204 immediately — no dialog appears. Row vanishes, GET → 404,
 * and the DB row is physically gone.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { cleanup } from './fixtures/factories';
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
    // Material can never return 409 per the §4 matrix — this test runs the
    // same DeleteDialog wiring the table keeps defensively, so a future
    // dependency addition stays covered end to end.
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

      // VERIFY UI — Mode A dialog with the cascaded dep + confirm field.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-photos"]')).toContainText('→ Фото: 1 (удалён)');
      await expect(page.locator('[data-testid="delete-dialog-confirm-btn"]')).toBeDisabled();

      // ACTION — type the title, confirm (real DELETE, body `{resolutions:{}}`).
      await confirmDeleteDialog(page, material.title);
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
