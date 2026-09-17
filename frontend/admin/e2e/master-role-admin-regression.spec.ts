/**
 * master-role-admin-regression.spec.ts — GH #263 T10, scenario S7 (регресс).
 *
 * S7 — админ-сессия НЕ скоупится и НЕ маскирует (regression contract
 * «byte-identical pre-#263 admin», backend T3-fix note): after master
 * scoping landed, the ADMIN must still see:
 *  - полные телефоны в /clients (no «•» mask anywhere in the list wire
 *    data), email preserved;
 *  - записи/оплаты/фото created under the OTHER master's scope (foreign
 *    to m1) — list surfaces include them;
 *  - все разделы: admin menu keeps Клиенты/Сотрудники/Мастера…
 *    (S4 pinned the master's absence; here the presence side).
 *
 * RED note (TDD): admin no-scope + no-mask landed in T3/T4/T5 (backend
 * TDD — test_master_scope_clients.py admin paths); this is the acceptance
 * layer. The default project storageState is the ADMIN session (#247 T14),
 * so this spec simply does NOT call useMasterSession().
 */
import { test, expect } from './fixtures/test';
import { adminApiContext } from './fixtures/admin-context';
import { waitForRecordsReady } from './fixtures/helpers';
import {
  createTestClient, createTestActivity, createTestRecord,
  createTestMaster, createTestPhoto, createTestService,
  createTestPayment, cleanup, cleanupRecord,
} from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

test.describe('GH #263 S7 — admin regression: no scope, no mask', () => {
  test('S7a: /clients shows unmasked phones (seed + foreign master client)', async ({
    request,
  }) => {
    const admin = await adminApiContext();
    const naked = '+79247778899';
    const foreignMaster = await createTestMaster(admin, {
      first_name: 'Чужой',
      last_name: `Регресс ${Date.now()}`,
    });
    const foreignActivity = await createTestActivity(admin, {
      master_id: foreignMaster.id,
    });
    // Client visible to admin whose ONLY record hangs on the foreign
    // master's activity (invisible to m1, but admin sees everything).
    const client = await createTestClient(admin, {
      name: `Полный номер ${Date.now()}`,
      phone: naked,
    });
    const foreignRecord = await createTestRecord(
      admin, foreignActivity.id, client.id,
    );

    try {
      // Wire contract: the SAME row the master sees masked arrives naked.
      const list = await request.get(`${BACKEND}/api/v1/clients?per_page=100`);
      expect(list.ok()).toBeTruthy();
      const items = ((await list.json()).items ?? []) as Array<{
        id: string; phone: string | null;
      }>;
      const row = items.find((c) => c.id === client.id);
      expect(row).toBeTruthy();
      expect(row!.phone).toBe(naked);

      // Point GET is unmasked for admin as well.
      const point = await request.get(`${BACKEND}/api/v1/clients/${client.id}`);
      expect(((await point.json()) as { phone: string }).phone).toBe(naked);
    } finally {
      await cleanupRecord(admin, foreignRecord.id);
      await cleanup(admin, `/api/v1/activities/${foreignActivity.id}`);
      await cleanup(admin, `/api/v1/clients/${client.id}`);
      await cleanup(admin, `/api/v1/staff/${foreignMaster.id}`);
      await admin.dispose();
    }
  });

  test('S7b: /records lists records of ALL masters (foreign master row visible)', async ({
    page,
  }) => {
    const admin = await adminApiContext();
    const foreignMaster = await createTestMaster(admin, {
      first_name: 'Чужой',
      last_name: `ЗаписиРегресс ${Date.now()}`,
    });
    const foreignActivity = await createTestActivity(admin, {
      master_id: foreignMaster.id,
    });
    const client = await createTestClient(admin);
    const foreignRecord = await createTestRecord(
      admin, foreignActivity.id, client.id,
    );
    const foreignPayment = await createTestPayment(admin, foreignRecord.id);

    try {
      // The records page rides the ADMIN session (project default).
      await waitForRecordsReady(page);
      const row = page.locator('tbody tr').filter({ hasText: client.name }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanup(admin, `/api/v1/payments/${foreignPayment.id}`);
      await cleanupRecord(admin, foreignRecord.id);
      await cleanup(admin, `/api/v1/activities/${foreignActivity.id}`);
      await cleanup(admin, `/api/v1/clients/${client.id}`);
      await cleanup(admin, `/api/v1/staff/${foreignMaster.id}`);
      await admin.dispose();
    }
  });

  test('S7c: /photos lists photos of all owners incl. foreign activity photo', async ({
    page,
  }) => {
    const admin = await adminApiContext();
    const foreignMaster = await createTestMaster(admin, {
      first_name: 'Чужой',
      last_name: `ФотоРегресс ${Date.now()}`,
    });
    const foreignService = await createTestService(admin);
    const foreignActivity = await createTestActivity(admin, {
      master_id: foreignMaster.id, service_id: foreignService.id,
    });
    const foreignPhoto = await createTestPhoto(admin, {
      filename: `/images/e2e-admin-regress-${Date.now()}.jpg`,
      activity_id: foreignActivity.id,
    });

    try {
      await page.goto('/photos');
      await page.waitForSelector('h1:has-text("Управление фото")', { timeout: 60_000 });
      await expect(page.getByText(foreignPhoto.filename)).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanup(admin, `/api/v1/photos/${foreignPhoto.id}`);
      await cleanup(admin, `/api/v1/activities/${foreignActivity.id}`);
      await cleanup(admin, `/api/v1/services/${foreignService.id}`);
      await cleanup(admin, `/api/v1/staff/${foreignMaster.id}`);
      await admin.dispose();
    }
  });

  test('S7d: admin menu keeps all sections (Клиенты/Сотрудники/Мастера…)', async ({
    page,
  }) => {
    await page.goto('/schedule');
    const menubar = page.locator('[data-testid="menubar"]');
    await expect(menubar).toBeVisible({ timeout: 30_000 });

    // Admin-only items the master session lost (S4b) — admin still has them.
    await expect(menubar.getByRole('link', { name: 'Клиенты' })).toHaveCount(1);
    await expect(menubar.getByRole('button', { name: 'Мастера', exact: true })).toHaveCount(1);

    // Справочники submenu: the full dictionary set is back.
    const directoriesBtn = menubar.getByRole('button', { name: 'Справочники' });
    await directoriesBtn.click();
    for (const label of ['Сотрудники', 'Локации', 'Теги', 'Должности', 'Услуги']) {
      await expect(menubar.locator('a', { hasText: label }).first()).toBeVisible();
    }
  });
});
