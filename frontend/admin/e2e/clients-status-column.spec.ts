import { test, expect } from './fixtures/test';
import type { Page, APIRequestContext } from '@playwright/test';
import {
  waitForClientsReady,
  waitForToast,
  openRowActionDropdown,
  clickRowArchiveAction,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';
import { createTestClient, cleanup } from './fixtures/factories';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * GH #220 Task 3 — E2E for the clients «Статус» column.
 *
 * The column (clientColumns.tsx, key `archived`) is HIDDEN by default and
 * non-sortable; enabled via the shared ColumnPicker (⚙️ «Настроить колонки»)
 * it renders the badge «Активен»/«Архив» (exact texts, `data-testid="client-archived-badge"`).
 *
 * Scenarios (plan Task 3):
 *   1. Default table is unchanged (no «Статус» header); enabling via the
 *      picker shows badges for both an active and an archived client.
 *   2. Deep-link /clients?clientId=N on an ARCHIVED client → the narrowed
 *      row is visible (GH #216 forces status=all); after enabling the
 *      column its badge reads «Архив».
 *   3. Column enabled + status filter «Все»: archiving through the row
 *      actions menu flips the badge to «Архив» WITHOUT a page reload;
 *      restoring flips it back to «Активен». Precondition guard: under the
 *      default «Активные» filter the archived row leaves the view, so the
 *      flip is unobservable there.
 *
 * Seeding: `createTestClient` (no archive parameter) + archive via
 * POST /api/v1/clients/{id}/archive — the client-phone-typeahead.spec.ts
 * pattern.
 */

/** Close the client card modal by clicking the backdrop at a corner
 * (avoiding the centered modal content) — clients.spec.ts idiom. */
async function closeByBackdrop(page: Page) {
  const modal = page.locator('[data-testid="client-card-modal"]');
  const backdrop = page.locator('[data-testid="client-card-backdrop"]');
  await backdrop.click({ position: { x: 5, y: 5 }, force: true });
  await expect(modal).not.toBeVisible({ timeout: 5000 });
}

/** Enable the «Статус» column via the shared ColumnPicker gear. */
async function enableStatusColumn(page: Page) {
  await page.click('[aria-label="Настроить колонки"]');
  await page.getByLabel('Статус').check();
  await page.keyboard.press('Escape');
  await expect(
    page.locator('table thead th').filter({ hasText: 'Статус' }),
  ).toBeVisible({ timeout: 10_000 });
}

/** Archive/restore a client through the backend API (returns the JSON body). */
async function setArchivedViaApi(
  request: APIRequestContext,
  clientId: string,
  action: 'archive' | 'restore',
): Promise<{ archived: boolean }> {
  const resp = await request.post(`${BACKEND}/api/v1/clients/${clientId}/${action}`);
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

test.describe('Clients — «Статус» column (GH #220 Task 3)', () => {
  test('1. Table is unchanged by default; enabling via the picker shows «Активен»/«Архив» badges', async ({
    page,
    request,
  }) => {
    const active = await createTestClient(request, {
      name: `Статус-активный ${Date.now()}`,
    });
    const archived = await createTestClient(request, {
      name: `Статус-архивный ${Date.now()}`,
    });
    const archBody = await setArchivedViaApi(request, archived.id, 'archive');
    expect(archBody.archived).toBe(true);

    try {
      await waitForClientsReady(page, { waitForName: active.name });

      // Default view: no «Статус» header and no badges anywhere.
      await expect(
        page.locator('table thead th').filter({ hasText: 'Статус' }),
      ).toHaveCount(0);
      await expect(page.locator('[data-testid="client-archived-badge"]')).toHaveCount(0);

      // Enable via the picker — the header appears…
      await enableStatusColumn(page);

      // …and each row carries its badge with the EXACT text.
      const activeRow = page.locator('table tbody tr').filter({ hasText: active.name });
      await expect(activeRow).toBeVisible({ timeout: 10_000 });
      await expect(activeRow.locator('[data-testid="client-archived-badge"]')).toHaveText(
        'Активен',
      );

      // The archived client is NOT in the default active view — switch the
      // status filter to «Все» to see its «Архив» badge.
      const statusSelect = page.locator('div:has(> label:text-is("Статус")) > select');
      const filtered = page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/clients') && resp.status() === 200,
        { timeout: 10_000 },
      );
      await statusSelect.selectOption('all');
      await filtered;
      await page.waitForTimeout(300);

      const archivedRow = page.locator('table tbody tr').filter({ hasText: archived.name });
      await expect(archivedRow).toBeVisible({ timeout: 10_000 });
      await expect(archivedRow.locator('[data-testid="client-archived-badge"]')).toHaveText(
        'Архив',
      );
      await expect(activeRow.locator('[data-testid="client-archived-badge"]')).toHaveText(
        'Активен',
      );
    } finally {
      await cleanup(request, `/api/v1/clients/${active.id}`);
      await cleanup(request, `/api/v1/clients/${archived.id}`);
    }
  });

  test('2. Deep-link ?clientId= on an archived client shows the row; enabled column reads «Архив»', async ({
    page,
    request,
  }) => {
    const client = await createTestClient(request, {
      name: `Статус-deeplink ${Date.now()}`,
    });
    const archBody = await setArchivedViaApi(request, client.id, 'archive');
    expect(archBody.archived).toBe(true);

    try {
      // Deep-link — #232 narrows via the machine id filter and forces
      // status=all, so the archived client IS reachable and the card modal
      // auto-opens.
      await page.goto(`/clients?clientId=${client.id}`);
      await expect(page).toHaveURL(new RegExp(`clientId=${client.id}`));
      const modal = page.locator('[data-testid="client-card-modal"]');
      await expect(modal).toBeVisible({ timeout: 15_000 });

      // The narrowed table holds exactly the archived client's row.
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row).toBeVisible({ timeout: 10_000 });

      // #232 new scheme: the narrowing is machine-only (empty search, chip
      // present).
      await expect(page.locator('input[placeholder*="Поиск"]')).toHaveValue('');
      await expect(page.locator('[data-testid="client-deeplink-chip"] span[aria-live]')).toHaveText(
        'Открыт по ссылке',
      );

      // Close the card to inspect the table itself — #232: closing does NOT
      // wipe the address (old scheme did router.replace('/clients')).
      await closeByBackdrop(page);
      await expect(page).toHaveURL(new RegExp(`clientId=${client.id}`));
      await expect(page.locator('table tbody tr')).toHaveCount(1);

      // No «Статус» column yet; enabling shows the «Архив» badge.
      await expect(
        page.locator('table thead th').filter({ hasText: 'Статус' }),
      ).toHaveCount(0);
      await enableStatusColumn(page);
      await expect(row.locator('[data-testid="client-archived-badge"]')).toHaveText(
        'Архив',
      );
    } finally {
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test('3. Filter «Все»: archiving via the actions menu flips the badge without reload; restore flips back', async ({
    page,
    request,
  }) => {
    const client = await createTestClient(request, {
      name: `Статус-флип ${Date.now()}`,
    });

    try {
      await waitForClientsReady(page, { waitForName: client.name });
      await enableStatusColumn(page);

      const row = page.locator('table tbody tr').filter({ hasText: client.name });
      await expect(row.locator('[data-testid="client-archived-badge"]')).toHaveText(
        'Активен',
      );

      // Precondition guard: under the DEFAULT «Активные» filter the archived
      // row LEAVES the view — the flip is unobservable there.
      const archivedApi = await setArchivedViaApi(request, client.id, 'archive');
      expect(archivedApi.archived).toBe(true);
      await expect(row).toHaveCount(0, { timeout: 10_000 });
      // Reset via API for the UI part below.
      await setArchivedViaApi(request, client.id, 'restore');
      await page.reload();
      await waitForClientsReady(page, { waitForName: client.name });
      // localStorage kept the column enabled (storageKey clients-columns);
      // re-enable defensively in case this run started fresh.
      if (
        (await page.locator('table thead th').filter({ hasText: 'Статус' }).count()) === 0
      ) {
        await enableStatusColumn(page);
      }
      await expect(row.locator('[data-testid="client-archived-badge"]')).toHaveText(
        'Активен',
      );

      // Switch the status filter to «Все» — the archived row stays in view.
      const statusSelect = page.locator('div:has(> label:text-is("Статус")) > select');
      const filtered = page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/clients') && resp.status() === 200,
        { timeout: 10_000 },
      );
      await statusSelect.selectOption('all');
      await filtered;
      await page.waitForTimeout(300);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // Reload detector: a genuine page reload would wipe this window flag.
      await page.evaluate(() => {
        (window as unknown as { __e220NoReload: boolean }).__e220NoReload = true;
      });
      const urlBefore = page.url();

      // Archive through the row actions menu.
      const opened = await openRowActionDropdown(row);
      const archivePromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/clients/${client.id}/archive`) &&
          resp.request().method() === 'POST',
      );
      await clickRowArchiveAction(opened, 'В архив');
      const archive = await archivePromise;
      expect(archive.status()).toBe(200);
      await waitForToast(page, 'Клиент в архиве');

      // Badge flipped IN PLACE — no reload, same URL, window flag intact.
      await expect(row.locator('[data-testid="client-archived-badge"]')).toHaveText(
        'Архив',
        { timeout: 10_000 },
      );
      await expect(row).toBeVisible();
      expect(page.url()).toBe(urlBefore);
      expect(
        await page.evaluate(
          () => (window as unknown as { __e220NoReload?: boolean }).__e220NoReload,
        ),
      ).toBe(true);
      expect(queryDBRow(`SELECT is_active FROM clients WHERE id='${client.id}'`)!.is_active).toBe(0);

      // Restore through the same menu — badge back to «Активен».
      const archivedOpened = await openRowActionDropdown(row);
      const restorePromise = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/clients/${client.id}/restore`) &&
          resp.request().method() === 'POST',
      );
      await clickRowArchiveAction(archivedOpened, 'Восстановить');
      const restore = await restorePromise;
      expect(restore.status()).toBe(200);
      await waitForToast(page, 'Клиент восстановлен');

      await expect(row.locator('[data-testid="client-archived-badge"]')).toHaveText(
        'Активен',
        { timeout: 10_000 },
      );
      expect(page.url()).toBe(urlBefore);
      expect(
        await page.evaluate(
          () => (window as unknown as { __e220NoReload?: boolean }).__e220NoReload,
        ),
      ).toBe(true);
      expect(queryDBRow(`SELECT is_active FROM clients WHERE id='${client.id}'`)!.is_active).toBe(1);
    } finally {
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});
