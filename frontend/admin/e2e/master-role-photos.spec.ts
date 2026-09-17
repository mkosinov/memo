/**
 * master-role-photos.spec.ts — GH #263 T10, scenario S5.
 *
 * S5 — «Фото»: в списке только фото СВОЕЙ активности; создание
 * filename-строкой к своей активности ок.
 *
 * RED note (TDD): photo scoping landed in T5 (backend TDD —
 * backend/tests/test_master_scope_photos.py: list filter «photo attached
 * to one of the master's activities», foreign/owner-less → 404, foreign
 * activity_id on create → 404); the create-modal mechanics are pinned by
 * photos-crud.spec.ts. This spec is the acceptance layer.
 *
 * The seeded studio photos (client/service/location/owner-less) are NOT
 * master-activity photos, so the scoped list starts EMPTY except for photos
 * attached to m1 activities; a foreign master's activity photo must never
 * appear. The list assertion therefore: own-activity photo present, foreign
 * photo absent. Creation rides the modal: filename string + «Активность»
 * search (canonical label) → 201 → row visible.
 */
import { test, expect } from './fixtures/test';
import { useMasterSession } from './fixtures/master-session';
import { adminApiContext } from './fixtures/admin-context';
import { waitForPhotosReady } from './fixtures/helpers';
import { searchAndSelect } from './helpers/combobox';
import {
  createTestPhoto, createTestActivity, createTestMaster,
  createTestService, cleanup,
} from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

test.describe('GH #263 S5 — master photos scoped to own activities', () => {
  useMasterSession();

  test('S5a: list shows own-activity photos only; foreign master photo absent', async ({
    page,
  }) => {
    const admin = await adminApiContext();
    // Foreign pen: another master + his activity + a photo attached to it.
    const foreignMaster = await createTestMaster(admin, {
      first_name: 'Чужой',
      last_name: `Фото ${Date.now()}`,
    });
    const foreignService = await createTestService(admin);
    const foreignActivity = await createTestActivity(admin, {
      master_id: foreignMaster.id, service_id: foreignService.id,
    });
    const foreignPhoto = await createTestPhoto(admin, {
      filename: `/images/e2e-foreign-${Date.now()}.jpg`,
      activity_id: foreignActivity.id,
    });

    // Own pen: a photo on one of the SESSION master's (m1) activities.
    const ownActivity = await createTestActivity(admin, { master_id: 'm1' });
    const ownPhoto = await createTestPhoto(admin, {
      filename: `/images/e2e-own-${Date.now()}.jpg`,
      activity_id: ownActivity.id,
    });

    try {
      await waitForPhotosReady(page);

      // Scoped list: own-activity photo present, foreign absent.
      await expect(page.getByText(ownPhoto.filename)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(foreignPhoto.filename)).toHaveCount(0);
    } finally {
      await cleanup(admin, `/api/v1/photos/${ownPhoto.id}`);
      await cleanup(admin, `/api/v1/photos/${foreignPhoto.id}`);
      await cleanup(admin, `/api/v1/activities/${ownActivity.id}`);
      await cleanup(admin, `/api/v1/activities/${foreignActivity.id}`);
      await cleanup(admin, `/api/v1/services/${foreignService.id}`);
      await cleanup(admin, `/api/v1/staff/${foreignMaster.id}`);
      await admin.dispose();
    }
  });

  test('S5b: create with a filename string bound to own activity succeeds', async ({
    page,
  }) => {
    const admin = await adminApiContext();
    // Own activity with a UNIQUE service so the «Активность» typeahead
    // matches deterministically (same idiom as photos-crud activity spec).
    const service = await createTestService(admin);
    const ownActivity = await createTestActivity(admin, {
      master_id: 'm1', service_id: service.id,
    });
    const locationsJson = await (await admin.get(`${BACKEND}/api/v1/locations`)).json();
    const locationName = ((locationsJson.items ?? locationsJson) as Array<{ name: string }>)[0].name;

    const d = new Date(ownActivity.start);
    const p = (n: number) => String(n).padStart(2, '0');
    const expectedLabel = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())} — ${locationName} — ${service.title}`;

    const filename = `/images/e2e-master-create-${Date.now()}.jpg`;
    let createdId: string | null = null;

    try {
      await waitForPhotosReady(page);
      await page.click('text=+ Добавить фото');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // filename — a plain string (no upload in this flow).
      await dialog.getByPlaceholder('photo-001.jpg').fill(filename);

      // «Активность» typeahead → own activity via its canonical label.
      const activityInput = dialog.getByRole('textbox', { name: 'Активность' });
      await activityInput.fill(service.title);
      await dialog.getByRole('option', { name: expectedLabel }).click();
      await expect(activityInput).toHaveValue(expectedLabel);

      const createdWait = page.waitForResponse(
        (resp) => resp.url().endsWith('/api/v1/photos') &&
          resp.request().method() === 'POST' && resp.status() === 201,
        { timeout: 15_000 },
      );
      await dialog.getByText('Сохранить').click();
      const created = await createdWait;
      const body = (await created.json()) as { id: string; activity_id: string | null };
      createdId = body.id;
      expect(body.activity_id).toBe(ownActivity.id);

      // Row lands in the scoped list (freshly created → top by date).
      await expect(page.getByText(filename)).toBeVisible({ timeout: 10_000 });
    } finally {
      if (createdId) await cleanup(admin, `/api/v1/photos/${createdId}`);
      await cleanup(admin, `/api/v1/activities/${ownActivity.id}`);
      await cleanup(admin, `/api/v1/services/${service.id}`);
      await admin.dispose();
    }
  });
});
