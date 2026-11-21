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
import { waitForServicesReady, waitForScheduleReady } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

/**
 * GH #606 Task 8 — admin side of «Видно клиентам» for SERVICES: the
 * sanctioned mirror of locations-web-hidden.spec.ts (#601).
 *
 *   US-1  owner hides a service: toggle «Видно клиентам» OFF in the edit
 *         modal (canonical full PUT carries `is_public`) → «Не в web»
 *         badge in the table; the admin is otherwise UNCHANGED — an
 *         activity of the hidden service STAYS in the schedule grid
 *         (staff sees everything); the anonymous public dictionary drops
 *         it while the visible CONTROL service stays (positive control,
 *         #600 canon).
 *   US-1  same toggle available at CREATE — a service born hidden.
 *   US-4  owner re-enables: badge gone, public dictionary returns it.
 *
 * Written green against the already-landed Task 7 UI (toggle testid
 * `toggle-is-public`, badge testid `service-web-hidden-badge`) — the
 * e2e-sanctioned mode for a mirror spec of an implemented feature.
 *
 * Fixture per test: a «hidden + visible» service PAIR, the hidden one
 * with an activity in the displayed window (factory default start = seed
 * week Monday 10:00 — the grid opens there). Rows are located by title
 * text (services-crud precedent: the table has no per-row testid), the
 * table narrowed to the factory pair via the «Название...» search.
 */

const BACKEND = resolveBackendUrl();

/** Fresh anonymous API context — NO cookies (cabinet.spec precedent). */
async function anonContext() {
  const ctx = await apiRequest.newContext({
    baseURL: BACKEND,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
  });
  return ctx;
}

/** Public dictionary ids — bare array (backend contract, §3.2). */
async function publicServiceIds(): Promise<string[]> {
  const anon = await anonContext();
  try {
    const resp = await anon.get('/api/v1/public/services');
    expect(resp.ok()).toBeTruthy();
    const rows = (await resp.json()) as Array<{ id: string }>;
    return rows.map((r) => r.id);
  } finally {
    await anon.dispose();
  }
}

/** Narrow the table to this test's factory pair via the search box. */
async function searchPair(page: import('@playwright/test').Page, tag: string) {
  const input = page.getByPlaceholder('Название...');
  await expect(input).toBeVisible();
  await input.fill(tag);
}

test.describe('GH #606 — services web visibility (admin)', () => {
  test('US-1: hide via edit modal — PUT carries is_public=false; badge; activity stays in grid; public dictionary drops it', async ({
    page,
    request,
  }) => {
    const tag = `606у ${Date.now()}`;
    const master = await createTestMaster(request);
    const location = await createTestLocation(request);
    const hidden = await createTestService(request, { title: `Скрытая ${tag}` });
    const control = await createTestService(request, { title: `Контроль ${tag}` });
    const hiddenActivity = await createTestActivity(request, {
      master_id: master.id,
      service_id: hidden.id,
      location_id: location.id,
    });
    const controlActivity = await createTestActivity(request, {
      master_id: master.id,
      service_id: control.id,
      location_id: location.id,
    });
    try {
      await waitForServicesReady(page);
      await searchPair(page, tag);
      const hiddenRow = page.locator('table tbody tr').filter({ hasText: hidden.title });
      const controlRow = page.locator('table tbody tr').filter({ hasText: control.title });
      await expect(hiddenRow).toBeVisible();
      await expect(controlRow).toBeVisible();
      // Both public so far — no badges.
      await expect(hiddenRow.getByTestId('service-web-hidden-badge')).toHaveCount(0);

      // ACT: open the edit modal, flip «Видно клиентам» OFF, save.
      await hiddenRow.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Редактировать услугу')).toBeVisible();
      const toggle = dialog.getByTestId('toggle-is-public');
      await expect(toggle).toHaveAttribute('aria-checked', 'true'); // direct binding, no inversion
      const putResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/services/${hidden.id}`) &&
          r.request().method() === 'PUT',
        { timeout: 15_000 },
      );
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await dialog.getByText('Сохранить').click();
      const put = await putResponse;
      expect(put.ok()).toBeTruthy();
      // DoD: the modal PUT payload carries the flag.
      expect((put.request().postDataJSON() as Record<string, unknown>).is_public).toBe(false);
      await expect(dialog).toHaveCount(0); // closed on success

      // Badge on the hidden row; the visible CONTROL row keeps none.
      await expect(hiddenRow.getByTestId('service-web-hidden-badge')).toHaveText('Не в web');
      await expect(controlRow.getByTestId('service-web-hidden-badge')).toHaveCount(0);

      // Admin unchanged: BOTH cards stay in the schedule grid (seed week —
      // the factory default start lands there). The hidden service's
      // activity REMAINS — hiding is a site-only concern (§3.6).
      await waitForScheduleReady(page, SEED_WEEK_MONDAY);
      await expect(
        page.locator(`[data-testid="activity-${hiddenActivity.id}"]`),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        page.locator(`[data-testid="activity-${controlActivity.id}"]`),
      ).toBeVisible({ timeout: 10_000 });

      // Public dictionary probe (anonymous, cookie-less): hidden GONE,
      // control present — «absence of everything» must not pass (#600 canon).
      const ids = await publicServiceIds();
      expect(ids).not.toContain(hidden.id);
      expect(ids).toContain(control.id);
    } finally {
      await cleanup(request, `/api/v1/activities/${hiddenActivity.id}`);
      await cleanup(request, `/api/v1/activities/${controlActivity.id}`);
      await cleanup(request, `/api/v1/services/${hidden.id}`);
      await cleanup(request, `/api/v1/services/${control.id}`);
      await cleanup(request, `/api/v1/locations/${location.id}`);
      await cleanup(request, `/api/v1/staff/${master.id}`);
    }
  });

  test('US-1: create with «Видно клиентам» OFF — hidden from birth', async ({ page, request }) => {
    const tag = `606с ${Date.now()}`;
    await waitForServicesReady(page);
    await page.getByText('+ Добавить услугу').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Новая услуга')).toBeVisible();

    const title = `Созданная скрытой ${tag}`;
    // Placeholder-scoped: the service title field (tariff rows carry
    // their own «Название» labels — services-crud precedent).
    await dialog.getByPlaceholder('Мастер-класс по рисованию').fill(title);
    // Duration is required (min 15) and inits to 0 — must fill to pass
    // validation before the first save.
    await dialog.getByLabel('Длительность').fill('90');

    // Default ON (direct binding), flip OFF before the first save.
    const toggle = dialog.getByTestId('toggle-is-public');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    const postResponse = page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/services') && r.request().method() === 'POST',
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
      const row = page.locator('table tbody tr').filter({ hasText: title });
      await expect(row).toBeVisible();
      await expect(row.getByTestId('service-web-hidden-badge')).toHaveText('Не в web');

      // …and the DB agrees (SQLite boolean 0 — boolean, not the string "false").
      expect(queryDBRow(`SELECT is_public FROM services WHERE id='${created.id}'`)!.is_public).toBe(0);
    } finally {
      await cleanup(request, `/api/v1/services/${created.id}`);
    }
  });

  test('US-4: enable back — badge gone, public dictionary returns it', async ({ page, request }) => {
    const tag = `606в ${Date.now()}`;
    const hidden = await createTestService(request, {
      title: `Возврат ${tag}`,
      is_public: false,
    });
    const control = await createTestService(request, { title: `Контроль ${tag}` });
    try {
      await waitForServicesReady(page);
      await searchPair(page, tag);
      const hiddenRow = page.locator('table tbody tr').filter({ hasText: hidden.title });
      await expect(hiddenRow).toBeVisible();
      // Starts hidden: badge present…
      await expect(hiddenRow.getByTestId('service-web-hidden-badge')).toHaveText('Не в web');
      // …and the public dictionary agrees (control anchors the probe).
      let ids = await publicServiceIds();
      expect(ids).not.toContain(hidden.id);
      expect(ids).toContain(control.id);

      // ACT: open the edit modal — the switch reflects the hidden state —
      // flip «Видно клиентам» back ON and save.
      await hiddenRow.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('Редактировать услугу')).toBeVisible();
      const toggle = dialog.getByTestId('toggle-is-public');
      await expect(toggle).toHaveAttribute('aria-checked', 'false'); // hidden state, no inversion
      const putResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/services/${hidden.id}`) &&
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
      await expect(hiddenRow.getByTestId('service-web-hidden-badge')).toHaveCount(0);

      // …and the public dictionary returns the service.
      ids = await publicServiceIds();
      expect(ids).toContain(hidden.id);
      expect(ids).toContain(control.id);
    } finally {
      // Flag already restored through the UI above — the fixture pair is
      // deleted per the mirror's cleanup pattern.
      await cleanup(request, `/api/v1/services/${hidden.id}`);
      await cleanup(request, `/api/v1/services/${control.id}`);
    }
  });
});
