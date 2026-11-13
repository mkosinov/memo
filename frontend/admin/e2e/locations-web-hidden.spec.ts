import { test, expect } from './fixtures/test';
import { request as apiRequest } from '@playwright/test';
import { resolveBackendUrl } from './lib/backend-url';
import { SEED_WEEK_MONDAY } from './fixtures/seed-week';
import {
  cleanup,
  createTestActivity,
  createTestLocation,
  createTestMaster,
  createTestService,
} from './fixtures/factories';
import { waitForLocationsReady, waitForScheduleReady, gotoScheduleDay } from './fixtures/helpers';
import { clickWithFallback } from './helpers/clicks';
import { locationCheckByTitle, waitForLocationDirectory } from './helpers/location-group';
import { queryDBRow } from './fixtures/db-query';

/**
 * GH #601 Task 4 — admin side of «Видно клиентов» (web visibility).
 *
 *   US-1  owner hides a location: toggle «Видно клиентам» OFF in the
 *         edit modal (canonical PUT carries `is_public` — the is_private
 *         canon) → «Не в web» badge in the table; the admin is otherwise
 *         UNCHANGED (activity card stays in the grid, location stays in
 *         the create-activity directory — the live multi-select after
 *         #595); the anonymous public dictionary drops it while the
 *         visible CONTROL location stays (positive control, #600 canon).
 *   US-1  same toggle available at CREATE — a location born hidden.
 *   US-4  owner re-enables: badge gone, public dictionary returns it.
 *
 * Fixture per test: a «hidden + visible» location PAIR, each with an
 * activity in the displayed window (factory default start = seed week
 * Monday 10:00 — the grid opens there). The create-activity directory
 * probe runs on the 2099 empty day (multi-location-create precedent).
 */

const BACKEND = resolveBackendUrl();

/** Far-future day: the only activities there are none — empty slots galore. */
const EMPTY_DAY = '2099-01-05';

/** Fresh anonymous API context — NO cookies (cabinet.spec precedent). */
async function anonContext() {
  const ctx = await apiRequest.newContext({
    baseURL: BACKEND,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
  });
  return ctx;
}

/** Public dictionary ids — bare array, 4-field rows (backend contract). */
async function publicLocationIds(): Promise<string[]> {
  const anon = await anonContext();
  try {
    const resp = await anon.get('/api/v1/public/locations');
    expect(resp.ok()).toBeTruthy();
    const rows = (await resp.json()) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  } finally {
    await anon.dispose();
  }
}

/** Narrow the table to this test's factory pair via the server `q` search. */
async function searchPair(page: import('@playwright/test').Page, tag: string) {
  const input = page.getByPlaceholder('Название или адрес...');
  await expect(input).toBeVisible();
  await input.fill(tag);
}

test.describe('GH #601 — locations web visibility (admin)', () => {
  test('US-1: hide via edit modal — PUT carries is_public=false; badge; admin unchanged; public dictionary drops it', async ({
    page,
    request,
  }) => {
    const tag = `601э ${Date.now()}`;
    const master = await createTestMaster(request);
    const service = await createTestService(request);
    const hidden = await createTestLocation(request, { title: `Скрытая ${tag}` });
    const control = await createTestLocation(request, { title: `Контроль ${tag}` });
    const hiddenActivity = await createTestActivity(request, {
      master_id: master.id,
      service_id: service.id,
      location_id: hidden.id,
    });
    const controlActivity = await createTestActivity(request, {
      master_id: master.id,
      service_id: service.id,
      location_id: control.id,
    });
    try {
      await waitForLocationsReady(page);
      await searchPair(page, tag);
      const hiddenRow = page.locator(`[data-testid="location-row-${hidden.id}"]`);
      const controlRow = page.locator(`[data-testid="location-row-${control.id}"]`);
      await expect(hiddenRow).toBeVisible();
      await expect(controlRow).toBeVisible();
      // Both public so far — no badges.
      await expect(hiddenRow.getByTestId('location-web-hidden-badge')).toHaveCount(0);

      // ACT: open the edit modal, flip «Видно клиентам» OFF, save.
      await hiddenRow.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Редактирование локации')).toBeVisible();
      const toggle = dialog.getByTestId('toggle-is-public');
      await expect(toggle).toHaveAttribute('aria-checked', 'true'); // direct binding, no inversion
      const putResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/locations/${hidden.id}`) &&
          r.request().method() === 'PUT',
        { timeout: 15_000 },
      );
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await dialog.getByText('Сохранить').click();
      const put = await putResponse;
      expect(put.ok()).toBeTruthy();
      // DoD: the modal PUT payload carries the flag (is_private canon).
      expect((put.request().postDataJSON() as Record<string, unknown>).is_public).toBe(false);
      await expect(dialog).toHaveCount(0); // closed on success

      // Badge on the hidden row; the visible CONTROL row keeps none.
      await expect(hiddenRow.getByTestId('location-web-hidden-badge')).toHaveText('Не в web');
      await expect(controlRow.getByTestId('location-web-hidden-badge')).toHaveCount(0);

      // Admin unchanged: BOTH cards stay in the schedule grid (seed week —
      // the factory default start lands there).
      await waitForScheduleReady(page, SEED_WEEK_MONDAY);
      await expect(
        page.locator(`[data-testid="activity-${hiddenActivity.id}"]`),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator(`[data-testid="activity-${controlActivity.id}"]`),
      ).toBeVisible({ timeout: 10_000 });

      // Admin unchanged: the hidden hall is still in the create-activity
      // location directory (live multi-select UI after #595).
      await gotoScheduleDay(page, EMPTY_DAY);
      const slot = page.locator('[data-testid="empty-slot"]').first();
      await expect(slot).toBeVisible();
      await clickWithFallback(slot);
      const createDialog = page.getByRole('dialog', { name: 'Новое занятие' });
      await expect(createDialog).toBeVisible();
      const directorySize = Number(
        queryDBRow('SELECT COUNT(*) AS c FROM locations')!.c,
      );
      await waitForLocationDirectory(createDialog, directorySize);
      await expect(locationCheckByTitle(createDialog, hidden.title)).toBeVisible();
      await expect(locationCheckByTitle(createDialog, control.title)).toBeVisible();

      // Public dictionary probe (anonymous, cookie-less): hidden GONE,
      // control present — «absence of everything» must not pass (#600 canon).
      const ids = await publicLocationIds();
      expect(ids).not.toContain(hidden.id);
      expect(ids).toContain(control.id);
    } finally {
      await cleanup(request, `/api/v1/activities/${hiddenActivity.id}`);
      await cleanup(request, `/api/v1/activities/${controlActivity.id}`);
      await cleanup(request, `/api/v1/locations/${hidden.id}`);
      await cleanup(request, `/api/v1/locations/${control.id}`);
      await cleanup(request, `/api/v1/services/${service.id}`);
      await cleanup(request, `/api/v1/staff/${master.id}`);
    }
  });

  test('US-1: create with «Видно клиентам» OFF — hidden from birth', async ({ page, request }) => {
    const tag = `601с ${Date.now()}`;
    await waitForLocationsReady(page);
    await page.getByText('+ Добавить локацию').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Новая локация')).toBeVisible();

    const title = `Созданная скрытой ${tag}`;
    // Placeholder-scoped: getByLabel('Название') is ambiguous — the required
    // marker makes the label read «Название*» and substring-matching also
    // catches «Короткое название» (strict-mode violation, RED-run finding).
    await dialog.getByPlaceholder('Студия на Тверской').fill(title);
    await dialog.getByLabel('Вместимость').fill('6');

    // Default ON (direct binding), flip OFF before the first save.
    const toggle = dialog.getByTestId('toggle-is-public');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const postResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/locations') && r.request().method() === 'POST',
      { timeout: 15_000 },
    );
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await dialog.getByText('Сохранить').click();
    const post = await postResponse;
    expect(post.ok()).toBeTruthy();
    expect((post.request().postDataJSON() as Record<string, unknown>).is_public).toBe(false);
    const created = (await post.json()) as { id: string };
    await expect(dialog).toHaveCount(0);

    try {
      // The table immediately flags the newborn row…
      const row = page.locator(`[data-testid="location-row-${created.id}"]`);
      await expect(row).toBeVisible();
      await expect(row.getByTestId('location-web-hidden-badge')).toHaveText('Не в web');

      // …and the DB agrees (SQLite boolean 0) — boolean, not the string "false".
      expect(queryDBRow(`SELECT is_public FROM locations WHERE id='${created.id}'`)!.is_public).toBe(0);
    } finally {
      await cleanup(request, `/api/v1/locations/${created.id}`);
    }
  });

  test('US-4: enable back — badge gone, public dictionary returns it', async ({ page, request }) => {
    const tag = `601в ${Date.now()}`;
    const hidden = await createTestLocation(request, {
      title: `Возврат ${tag}`,
      is_public: false,
    });
    const control = await createTestLocation(request, { title: `Контроль ${tag}` });
    try {
      await waitForLocationsReady(page);
      await searchPair(page, tag);
      const hiddenRow = page.locator(`[data-testid="location-row-${hidden.id}"]`);
      await expect(hiddenRow).toBeVisible();
      // Starts hidden: badge present…
      await expect(hiddenRow.getByTestId('location-web-hidden-badge')).toHaveText('Не в web');
      // …and the public dictionary agrees (control anchors the probe).
      let ids = await publicLocationIds();
      expect(ids).not.toContain(hidden.id);
      expect(ids).toContain(control.id);

      // ACT: open the edit modal — the switch reflects the hidden state —
      // flip «Видно клиентам» back ON and save.
      await hiddenRow.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Редактирование локации')).toBeVisible();
      const toggle = dialog.getByTestId('toggle-is-public');
      await expect(toggle).toHaveAttribute('aria-checked', 'false'); // hidden state, no inversion
      const putResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/locations/${hidden.id}`) &&
          r.request().method() === 'PUT',
        { timeout: 15_000 },
      );
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await dialog.getByText('Сохранить').click();
      const put = await putResponse;
      expect(put.ok()).toBeTruthy();
      expect((put.request().postDataJSON() as Record<string, unknown>).is_public).toBe(true);
      await expect(dialog).toHaveCount(0);

      // The badge disappears from the row…
      await expect(hiddenRow.getByTestId('location-web-hidden-badge')).toHaveCount(0);

      // …and the public dictionary returns the location.
      ids = await publicLocationIds();
      expect(ids).toContain(hidden.id);
      expect(ids).toContain(control.id);
    } finally {
      await cleanup(request, `/api/v1/locations/${hidden.id}`);
      await cleanup(request, `/api/v1/locations/${control.id}`);
    }
  });
});
