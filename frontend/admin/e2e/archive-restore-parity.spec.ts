/**
 * S5 — Archive and restore parity for all 5 entities (#207 §12, incl.
 * Client #198 parity + Master→users cascade #4.2).
 *
 * Per entity: "В архив" → POST /{id}/archive → 200 with body `archived: true`;
 * row leaves the active list and appears in the archived view; "Восстановить"
 * → POST /{id}/restore → 200 `archived: false`; row returns to the active
 * list. Master additionally cascades the linked user's is_active both ways
 * (DB check) — the other 4 entities never touch users.
 */
import { test, expect } from './fixtures/test';
import type { Locator, Page } from '@playwright/test';
import {
  cleanup,
  createTestClient,
  createTestLocation,
  createTestMaster,
  createTestService,
  seedUser,
} from './fixtures/factories';
import {
  clickRowArchiveAction,
  openRowActionDropdown,
  waitForLocationsReady,
  waitForMastersReady,
  waitForServicesReady,
  waitForMaterialsReady,
  waitForClientsReady,
  waitForToast,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Filter by archive status on the entity page (masters/locations/services/materials). */
async function setStatusFilter(page: Page, status: 'active' | 'archived'): Promise<void> {
  // Register the response listener BEFORE the select — avoid a race where the
  // filtered-list response arrives before the wait is registered.
  const filtered = page.waitForResponse(
    (resp) => resp.status() === 200 && resp.url().includes(`status=${status}`),
    { timeout: 10_000 },
  );
  await page.getByLabel('Фильтр по статусу').selectOption(status);
  await filtered;
  await page.waitForTimeout(300); // React render buffer (same pattern as waitFor*Ready)
}

/** Client page filters: the status select exposes "Неактивные" as the archive option. */
async function setClientsStatusFilter(page: Page, status: 'active' | 'archived'): Promise<void> {
  const filtered = page.waitForResponse(
    (resp) => resp.url().includes('/api/v1/clients') && resp.status() === 200,
    { timeout: 10_000 },
  );
  await page.locator('select:has(option:text("Неактивные"))').selectOption(status);
  await filtered;
  await page.waitForTimeout(300);
}

test.describe('S5 — Archive/restore parity (all 5 entities)', () => {
  test('Master archiving cascades the linked user is_active both ways', async ({ page, request }) => {
    const master = await createTestMaster(request);
    const phone = `+7999${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 900) + 100}`;
    const userId = seedUser({ phone, masterId: master.id });
    try {
      // Baseline — seeded user active.
      expect(queryDBRow(`SELECT is_active FROM users WHERE id='${userId}'`)!.is_active).toBe(1);

      await waitForMastersReady(page);
      const row = page.locator(`[data-testid="master-row-${master.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      const opened = await openRowActionDropdown(row);
      const archivePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/masters/${master.id}/archive`) && resp.request().method() === 'POST'
      );
      await clickRowArchiveAction(opened, 'В архив');
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect((await archive.json()).archived).toBe(true);
      await waitForToast(page, 'Мастер архивирован');
      expect(queryDBRow(`SELECT is_active FROM masters WHERE id='${master.id}'`)!.is_active).toBe(0);
      // CASCADE — the linked user is deactivated with the master.
      expect(queryDBRow(`SELECT is_active FROM users WHERE id='${userId}'`)!.is_active).toBe(0);

      // Restore via the archived view.
      await setStatusFilter(page, 'archived');
      await expect(row).toBeVisible({ timeout: 10_000 });
      const archivedOpened = await openRowActionDropdown(row);
      await clickRowArchiveAction(archivedOpened, 'Восстановить');
      await waitForToast(page, 'Мастер восстановлен');
      expect(queryDBRow(`SELECT is_active FROM masters WHERE id='${master.id}'`)!.is_active).toBe(1);
      // CASCADE back — the user reactivates with the master.
      expect(queryDBRow(`SELECT is_active FROM users WHERE id='${userId}'`)!.is_active).toBe(1);

      await setStatusFilter(page, 'active');
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      try { queryDBRow(`DELETE FROM users WHERE id='${userId}'`); } catch { /* best-effort */ }
      await cleanup(request, `/api/v1/masters/${master.id}`);
    }
  });

  test('Location archive/restore — no cascade, row round-trips the views', async ({ page, request }) => {
    const loc = await createTestLocation(request);
    try {
      await waitForLocationsReady(page);
      const row = page.locator(`[data-testid="location-row-${loc.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      const opened = await openRowActionDropdown(row);
      const archivePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/locations/${loc.id}/archive`) && resp.request().method() === 'POST'
      );
      await clickRowArchiveAction(opened, 'В архив');
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect((await archive.json()).archived).toBe(true);
      await waitForToast(page, 'Локация архивирована');
      expect(queryDBRow(`SELECT is_active FROM locations WHERE id='${loc.id}'`)!.is_active).toBe(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      await setStatusFilter(page, 'archived');
      await expect(row).toBeVisible({ timeout: 10_000 });
      const archivedOpened = await openRowActionDropdown(row);
      await clickRowArchiveAction(archivedOpened, 'Восстановить');
      await waitForToast(page, 'Локация восстановлена');
      expect(queryDBRow(`SELECT is_active FROM locations WHERE id='${loc.id}'`)!.is_active).toBe(1);

      await setStatusFilter(page, 'active');
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/locations/${loc.id}`);
    }
  });

  test('Service archive/restore — no cascade, row round-trips the views', async ({ page, request }) => {
    const svc = await createTestService(request);
    try {
      await waitForServicesReady(page);
      const row = page.locator('table tbody tr').filter({ hasText: svc.title });
      await expect(row).toBeVisible({ timeout: 10_000 });

      const opened = await openRowActionDropdown(row);
      const archivePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/services/${svc.id}/archive`) && resp.request().method() === 'POST'
      );
      await clickRowArchiveAction(opened, 'В архив');
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect((await archive.json()).archived).toBe(true);
      await waitForToast(page, 'Услуга в архиве');
      expect(queryDBRow(`SELECT is_active FROM services WHERE id='${svc.id}'`)!.is_active).toBe(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      await setStatusFilter(page, 'archived');
      await expect(row).toBeVisible({ timeout: 10_000 });
      const archivedOpened = await openRowActionDropdown(row);
      await clickRowArchiveAction(archivedOpened, 'Восстановить');
      await waitForToast(page, 'Услуга восстановлена');
      expect(queryDBRow(`SELECT is_active FROM services WHERE id='${svc.id}'`)!.is_active).toBe(1);

      await setStatusFilter(page, 'active');
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/services/${svc.id}`);
    }
  });

  test('Material archive/restore — no cascade, row round-trips the views', async ({ page, request }) => {
    const title = `Материал S5 ${Date.now()}`;
    const createResp = await request.post(`${BACKEND}/api/v1/materials`, {
      data: { title, description: 'e2e S5 seed' },
    });
    expect(createResp.ok()).toBeTruthy();
    const material = await createResp.json();
    try {
      await waitForMaterialsReady(page);
      const row = page.locator('table tbody tr').filter({ hasText: material.title });
      await expect(row).toBeVisible({ timeout: 10_000 });

      const opened = await openRowActionDropdown(row);
      const archivePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/materials/${material.id}/archive`) && resp.request().method() === 'POST'
      );
      await clickRowArchiveAction(opened, 'В архив');
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect((await archive.json()).archived).toBe(true);
      await waitForToast(page, 'Материал в архиве');
      expect(queryDBRow(`SELECT is_active FROM materials WHERE id='${material.id}'`)!.is_active).toBe(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      await setStatusFilter(page, 'archived');
      await expect(row).toBeVisible({ timeout: 10_000 });
      const archivedOpened = await openRowActionDropdown(row);
      await clickRowArchiveAction(archivedOpened, 'Восстановить');
      await waitForToast(page, 'Материал восстановлен');
      expect(queryDBRow(`SELECT is_active FROM materials WHERE id='${material.id}'`)!.is_active).toBe(1);

      await setStatusFilter(page, 'active');
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/materials/${material.id}`);
    }
  });

  test('Client archive/restore — #198 parity (restore endpoint exists)', async ({ page, request }) => {
    const client = await createTestClient(request, { name: `S5 Client ${Date.now()}` });
    try {
      await waitForClientsReady(page, { waitForName: client.name });
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      const opened = await openRowActionDropdown(row);
      const archivePromise = page.waitForResponse((resp) =>
        resp.url().includes(`/api/v1/clients/${client.id}/archive`) && resp.request().method() === 'POST'
      );
      await clickRowArchiveAction(opened, 'В архив');
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      expect((await archive.json()).archived).toBe(true);
      await waitForToast(page, 'Клиент в архиве');
      expect(queryDBRow(`SELECT is_active FROM clients WHERE id='${client.id}'`)!.is_active).toBe(0);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      await setClientsStatusFilter(page, 'archived');
      await expect(row).toBeVisible({ timeout: 10_000 });
      const archivedOpened = await openRowActionDropdown(row);
      await clickRowArchiveAction(archivedOpened, 'Восстановить');
      await waitForToast(page, 'Клиент восстановлен');
      expect(queryDBRow(`SELECT is_active FROM clients WHERE id='${client.id}'`)!.is_active).toBe(1);

      await setClientsStatusFilter(page, 'active');
      await expect(row).toBeVisible({ timeout: 10_000 });
    } finally {
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});
