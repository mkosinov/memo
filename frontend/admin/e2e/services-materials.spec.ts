/**
 * GH #223 T5/T7 — ServiceModal materials multi-select with notes + the
 * services-page material filter.
 *
 * S1: open ServiceModal for an existing service → check «Акварель»
 *     (+ note «бумага 300 г») and «Керамика» → save → the table row shows
 *     badges «Акварель», «Керамика».
 * S3: reopen → uncheck «Керамика», save → only «Акварель» badge remains;
 *     a second edit saved WITHOUT touching materials keeps «Акварель».
 * S2 (T7): the filter select «Материал» narrows the server-paginated list
 *     to the linked services (honest total); «все» restores; an archived
 *     material's already-selected filter keeps working (spec §5).
 *
 * Self-contained per test (fullyParallel-safe): each test creates its own
 * service; «Керамика» is created via API (the seed ships Масло/Акрил/
 * Акварель/Гуашь only) and cleaned up in finally. «Акварель» is seed mat3.
 * S2 creates BOTH of its materials via API (unique titles) — it archives
 * one mid-test, which must never touch the shared seed rows.
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
      // Single page for everything — with S2 running in parallel (3 extra
      // services) the default per_page 10 can push our row (title-sorted
      // last: «Услуга e2e_…») onto page 2.
      await page.getByTestId('page-size-select').selectOption('100');
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
      // Single page for everything — see the S1 comment (parallel-S2 collision).
      await page.getByTestId('page-size-select').selectOption('100');
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

test.describe('Services — material filter (#223 S2)', () => {
  /**
   * S2: two services linked to a unique «Акварель» material + one linked to a
   * unique «Керамика». Picking «Акварель» in the «Фильтр по материалу» select
   * narrows the server-paginated list to exactly the two linked rows with the
   * total counter showing 2; «все» brings all rows back. Then the «Акварель»
   * material is ARCHIVED via API (spec §5): the already-selected filter keeps
   * returning its linked services (links survive archive).
   *
   * Both materials are created via API with unique titles — the test archives
   * one mid-run, which must never touch the shared seed rows. per_page is
   * bumped to 100 first so fullyParallel-created services can't push our rows
   * onto page 2.
   */
  test('S2: filter by material → only linked rows + honest total; «все» restores; archived filter keeps working', async ({
    page,
    request,
  }) => {
    const akv = await createMaterial(request, `Акварель ${uid()}`);
    const ker = await createMaterial(request, `Керамика ${uid()}`);
    // max_age explicit — see the S1 comment (form number-prefill quirk is
    // irrelevant here but the factory default null is kept away for parity).
    const svcA1 = await createTestService(request, {
      max_age: 18,
      materials: [{ material_id: akv.id }],
    });
    const svcA2 = await createTestService(request, {
      max_age: 18,
      materials: [{ material_id: akv.id, note: 'бумага 300 г' }],
    });
    const svcK = await createTestService(request, {
      max_age: 18,
      materials: [{ material_id: ker.id }],
    });
    try {
      await waitForServicesReady(page);
      // Single page for everything: seed services + ours + parallel-test noise.
      await page.getByTestId('page-size-select').selectOption('100');

      const materialFilter = page.getByLabel('Фильтр по материалу');
      await expect(materialFilter).toBeVisible({ timeout: 10_000 });
      // The picker offers the fresh active materials (source: /all?status=active).
      await expect(
        materialFilter.locator('option', { hasText: akv.title }),
      ).toHaveCount(1, { timeout: 10_000 });

      // All three rows visible before filtering.
      await expect(serviceRow(page, svcA1.title)).toBeVisible({ timeout: 10_000 });
      await expect(serviceRow(page, svcA2.title)).toBeVisible();
      await expect(serviceRow(page, svcK.title)).toBeVisible();

      // ACTION — pick «Акварель <uid>».
      await materialFilter.selectOption(akv.id);

      // VERIFY — only the two linked rows, honest total counter = 2.
      await expect(page.getByText('2 всего', { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(serviceRow(page, svcA1.title)).toBeVisible();
      await expect(serviceRow(page, svcA2.title)).toBeVisible();
      await expect(serviceRow(page, svcK.title)).toHaveCount(0);

      // ACTION — back to «все».
      await materialFilter.selectOption('');

      // VERIFY — all three rows back (the unfiltered server list).
      await expect(serviceRow(page, svcK.title)).toBeVisible({ timeout: 10_000 });
      await expect(serviceRow(page, svcA1.title)).toBeVisible();
      await expect(serviceRow(page, svcA2.title)).toBeVisible();

      // ── Archived-material check (spec §5) ──
      // Re-select the material, archive it via API, then force a refetch with
      // the filter still selected (status «Все» → new query key): the backend
      // accepts an archived material_id and the links survive the archive.
      await materialFilter.selectOption(akv.id);
      await expect(page.getByText('2 всего', { exact: true })).toBeVisible({ timeout: 10_000 });

      const archResp = await request.post(`${BACKEND}/api/v1/materials/${akv.id}/archive`);
      expect(archResp.ok()).toBeTruthy();
      expect(((await archResp.json()) as { archived: boolean }).archived).toBe(true);

      // The already-selected filter keeps working: refetch (status change
      // composes with material_id) still returns the two linked services.
      // The raw API archive bypasses the app's react-query cache, so the
      // in-page selection + options are untouched at this point — exactly the
      // «already-selected filter» state §5 requires to survive.
      await page.getByLabel('Фильтр по статусу').selectOption('all');
      await expect(page.getByText('2 всего', { exact: true })).toBeVisible({ timeout: 10_000 });
      await expect(serviceRow(page, svcA1.title)).toBeVisible();
      await expect(serviceRow(page, svcA2.title)).toBeVisible();
      // The selection itself survived the archive.
      await expect(materialFilter).toHaveValue(akv.id);

      // The PICKER no longer offers the archived material for new links: a
      // reload drops the react-query cache, useMaterialsRaw refetches
      // /all?status=active, and «Акварель <uid>» must be gone from the options.
      await page.reload();
      await page.waitForSelector('table', { timeout: 60_000 });
      const reloadedFilter = page.getByLabel('Фильтр по материалу');
      await expect(reloadedFilter).toBeVisible({ timeout: 10_000 });
      // Anchor: the seed's «Акварель» (exact — ours has the uid suffix) proves
      // the materials list landed after the reload.
      await expect(
        reloadedFilter.getByRole('option', { name: 'Акварель', exact: true }),
      ).toHaveCount(1, { timeout: 10_000 });
      // The archived unique «Акварель <uid>» is no longer offered…
      await expect(
        reloadedFilter.getByRole('option', { name: akv.title }),
      ).toHaveCount(0);
      // …while the still-active «Керамика <uid>» is.
      await expect(
        reloadedFilter.getByRole('option', { name: ker.title }),
      ).toHaveCount(1);
    } finally {
      await cleanup(request, `/api/v1/services/${svcA1.id}`);
      await cleanup(request, `/api/v1/services/${svcA2.id}`);
      await cleanup(request, `/api/v1/services/${svcK.id}`);
      // Restore before delete: the material was archived mid-test.
      await request.post(`${BACKEND}/api/v1/materials/${akv.id}/restore`).catch(() => {});
      await cleanup(request, `/api/v1/materials/${akv.id}`);
      await cleanup(request, `/api/v1/materials/${ker.id}`);
    }
  });
});
