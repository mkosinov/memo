/**
 * GH #223 T5 — ServiceModal materials multi-select with notes.
 *
 * S1: open ServiceModal for an existing service → check «Акварель»
 *     (+ note «бумага 300 г») and «Керамика» → save → the table row shows
 *     badges «Акварель», «Керамика».
 * S3: reopen → uncheck «Керамика», save → only «Акварель» badge remains;
 *     a second edit saved WITHOUT touching materials keeps «Акварель».
 *
 * Self-contained per test (fullyParallel-safe): each test creates its own
 * service; «Керамика» is created via API (the seed ships Масло/Акрил/
 * Акварель/Гуашь only) and cleaned up in finally. «Акварель» is seed mat3.
 */
import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { cleanup, createTestService } from './fixtures/factories';
import { waitForServicesReady, waitForToast } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

let counter = 0;
function uid(): string {
  counter += 1;
  return `${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Create a «Керамика»-style material via the API (not in the seed set). */
async function createMaterial(api: APIRequestContext, title: string) {
  const resp = await api.post(`${BACKEND}/api/v1/materials`, {
    data: { title, description: 'e2e #223 material' },
  });
  expect(resp.ok()).toBeTruthy();
  return (await resp.json()) as { id: string; title: string };
}

/** Find an ACTIVE material id by title via the picker's own source endpoint. */
async function findActiveMaterialId(api: APIRequestContext, title: string): Promise<string> {
  const resp = await api.get(`${BACKEND}/api/v1/materials/all?status=active`);
  expect(resp.ok()).toBeTruthy();
  const items = (await resp.json()) as { id: string; title: string }[];
  const found = items.find((m) => m.title === title);
  expect(found, `active material «${title}» must exist (seed contract)`).toBeTruthy();
  return found!.id;
}

/** Row of the service in the table, located by its unique title. */
function serviceRow(page: Page, title: string) {
  return page.locator('table tbody tr').filter({ hasText: title });
}

/** Open the edit modal by clicking the service row; waits for the dialog. */
async function openServiceModal(page: Page, title: string) {
  await serviceRow(page, title).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  // The materials picker loads asynchronously (dictionary fetch).
  await expect(dialog.getByRole('checkbox', { name: 'Акварель', exact: true })).toBeVisible({
    timeout: 10_000,
  });
  return dialog;
}

test.describe('Services — materials multi-select with notes (#223 S1/S3)', () => {
  test('S1: check two materials + note → save → row shows badges, note persisted', async ({
    page,
    request,
  }) => {
    const keramika = await createMaterial(request, `Керамика ${uid()}`);
    // max_age explicit: the factory default (null) prefills the form's number
    // input as 0 → min_age>max_age validation blocks the save (pre-existing
    // form behavior, out of #223 scope — the materials scenario must not
    // depend on it).
    const service = await createTestService(request, { max_age: 18 });
    try {
      await waitForServicesReady(page);
      const row = serviceRow(page, service.title);
      await expect(row).toBeVisible({ timeout: 10_000 });

      const dialog = await openServiceModal(page, service.title);

      // ACTION — check «Акварель» + note, check «Керамика».
      await dialog.getByRole('checkbox', { name: 'Акварель', exact: true }).click();
      await dialog.getByLabel('Заметка: Акварель').fill('бумага 300 г');
      await dialog.getByRole('checkbox', { name: keramika.title }).click();
      await dialog.getByText('Сохранить').click();

      // VERIFY UI — toast + badges on the row.
      await waitForToast(page, 'Услуга обновлена');
      const badges = row.locator('[data-testid="material-badge"]');
      await expect(badges.filter({ hasText: 'Акварель' })).toHaveCount(1, { timeout: 10_000 });
      await expect(badges.filter({ hasText: keramika.title })).toHaveCount(1);

      // VERIFY DB — both links stored; the note rides on the Акварель link.
      const akvId = await findActiveMaterialId(request, 'Акварель');
      const noteRow = queryDBRow(
        `SELECT note FROM service_materials WHERE service_id='${service.id}' AND material_id='${akvId}'`,
      );
      expect(noteRow).toBeTruthy();
      expect(noteRow!.note).toBe('бумага 300 г');
      const kerRow = queryDBRow(
        `SELECT note FROM service_materials WHERE service_id='${service.id}' AND material_id='${keramika.id}'`,
      );
      expect(kerRow).toBeTruthy();
      expect(kerRow!.note).toBeNull();
    } finally {
      await cleanup(request, `/api/v1/services/${service.id}`);
      await cleanup(request, `/api/v1/materials/${keramika.id}`);
    }
  });

  test('S3: uncheck one material → only the other badge remains; untouched save keeps links', async ({
    page,
    request,
  }) => {
    const keramika = await createMaterial(request, `Керамика ${uid()}`);
    const akvId = await findActiveMaterialId(request, 'Акварель');
    // Service pre-linked with BOTH materials via the API (Task 4 write path).
    // max_age explicit — see the S1 comment (form number-prefill quirk).
    const service = await createTestService(request, {
      max_age: 18,
      materials: [
        { material_id: akvId, note: 'бумага 300 г' },
        { material_id: keramika.id },
      ],
    });
    try {
      await waitForServicesReady(page);
      const row = serviceRow(page, service.title);
      await expect(row).toBeVisible({ timeout: 10_000 });
      const badges = row.locator('[data-testid="material-badge"]');
      await expect(badges).toHaveCount(2, { timeout: 10_000 });

      // ACTION 1 — reopen, uncheck «Керамика», save.
      let dialog = await openServiceModal(page, service.title);
      // Edit prefills: both checked, Акварель's note restored.
      await expect(dialog.getByRole('checkbox', { name: 'Акварель', exact: true })).toBeChecked();
      await expect(dialog.getByRole('checkbox', { name: keramika.title })).toBeChecked();
      await expect(dialog.getByLabel('Заметка: Акварель')).toHaveValue('бумага 300 г');

      await dialog.getByRole('checkbox', { name: keramika.title }).click();
      await dialog.getByText('Сохранить').click();
      await waitForToast(page, 'Услуга обновлена');

      // VERIFY — only «Акварель» badge remains (UI + DB).
      await expect(badges).toHaveCount(1, { timeout: 10_000 });
      await expect(badges.first()).toHaveText('Акварель');
      expect(
        queryDBRow(
          `SELECT COUNT(*) AS n FROM service_materials WHERE service_id='${service.id}'`,
        )!.n,
      ).toBe(1);

      // ACTION 2 — second edit saved WITHOUT touching materials.
      dialog = await openServiceModal(page, service.title);
      await dialog.getByText('Сохранить').click();
      await waitForToast(page, 'Услуга обновлена');

      // VERIFY — links intact: «Акварель» badge still on the row, note kept.
      await expect(badges).toHaveCount(1, { timeout: 10_000 });
      await expect(badges.first()).toHaveText('Акварель');
      const noteRow = queryDBRow(
        `SELECT note FROM service_materials WHERE service_id='${service.id}' AND material_id='${akvId}'`,
      );
      expect(noteRow).toBeTruthy();
      expect(noteRow!.note).toBe('бумага 300 г');
    } finally {
      await cleanup(request, `/api/v1/services/${service.id}`);
      await cleanup(request, `/api/v1/materials/${keramika.id}`);
    }
  });
});
