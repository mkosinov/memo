import { test, expect } from './fixtures/test';
import type { Page, Response } from '@playwright/test';
import {
  cleanup,
  createTestActivity,
  createTestClient,
  createTestPhoto,
  createTestService,
} from './fixtures/factories';
import {
  selectClientFilterOption,
  waitForPhotosReady,
} from './fixtures/helpers';
import { searchAndSelect } from './helpers/combobox';

/**
 * E2E tests for the Photos page (GH #211 Task 10 — honest server-driven list):
 * table rendering, pagination totals, search, the 5 filters, create/edit modal
 * (4-owner model), column picker. Full Cycle pattern: data is created via the
 * backend API and asserted in the UI; every test cleans up in `finally`.
 *
 * Data hygiene: totals are asserted ONLY against deterministic result sets —
 * each test either scopes via its own unique owner (client/service filter) or
 * relies on the immutable seed pins (alpika location gallery, tag pair).
 *
 * Requires: dev server on :3002 (webServer), backend on :8000
 */

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Successful photos LIST response (excludes /photos/web and CRUD paths). */
function isPhotosList(resp: Response): boolean {
  const url = resp.url();
  return (
    url.includes('/api/v1/photos') &&
    !url.includes('/api/v1/photos/') &&
    resp.request().method() === 'GET' &&
    resp.status() === 200
  );
}

/** Register BEFORE the triggering action; resolves when the refetch lands. */
function nextPhotosList(page: Page): Promise<Response | null> {
  return page.waitForResponse(isPhotosList, { timeout: 15_000 }).catch(() => null);
}

/** One render pass after a refetch resolves (keepPreviousData swap). */
async function settle(page: Page): Promise<void> {
  await page.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Table shell — navigation, honest 8-column set, sort, row testids
// ---------------------------------------------------------------------------

test.describe('Photos — Table and Navigation', () => {
  test('navigates to photos page and renders table', async ({ page }) => {
    await waitForPhotosReady(page);
    await expect(page.getByText('Управление фото')).toBeVisible();
    await expect(page.getByText('+ Добавить фото')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('table has the honest 8-column set (Активность hidden by default)', async ({ page }) => {
    await waitForPhotosReady(page);

    // Default visible columns (photoColumns defaultVisible): Превью, Файл,
    // Клиент, Услуга, Локация, Публичное, Дата. «Посетитель» is GONE (#211).
    const visibleHeaders = ['Превью', 'Файл', 'Клиент', 'Услуга', 'Локация', 'Публичное', 'Дата'];
    for (const headerText of visibleHeaders) {
      await expect(
        page.locator('table thead th').filter({ hasText: headerText }),
      ).toBeVisible();
    }

    // «Активность» is a column (column picker knows it) but hidden by default
    // — raw id until #213 links it (plan Task 9).
    await expect(page.locator('table thead th').filter({ hasText: 'Активность' })).toHaveCount(0);
  });

  test('sorting — Файл header toggles server-driven sort direction', async ({ page }) => {
    await waitForPhotosReady(page);

    const fileHeader = page.locator('table thead th').filter({ hasText: 'Файл' });
    await expect(fileHeader).toBeVisible();

    // Click to sort ascending → server refetch → ↑
    let refetch = nextPhotosList(page);
    await fileHeader.click();
    await refetch;
    await expect(fileHeader).toContainText('↑');

    // Click again to sort descending → server refetch → ↓
    refetch = nextPhotosList(page);
    await fileHeader.click();
    await refetch;
    await expect(fileHeader).toContainText('↓');
  });

  test('rows are loaded from the API with photo-row-{id} testids', async ({ page }) => {
    await waitForPhotosReady(page);

    const rows = page.locator('table tbody tr');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    const testId = await rows.first().getAttribute('data-testid');
    expect(testId).toMatch(/^photo-row-/);
  });
});

// ---------------------------------------------------------------------------
// Scenario 1 — honest pagination: server totals, page 2 remainder
// ---------------------------------------------------------------------------

test.describe('Photos — Pagination (honest server totals)', () => {
  test('11 own photos → 10 rows + «11 всего», page 2 shows 1 row', async ({ page, request }) => {
    // Own client isolates the total — seed photos never pollute the count.
    const client = await createTestClient(request, { name: `Pag Client ${Date.now()}` });
    const photoIds: string[] = [];
    try {
      for (let i = 0; i < 11; i++) {
        const photo = await createTestPhoto(request, { client_id: client.id });
        photoIds.push(photo.id);
      }

      await waitForPhotosReady(page);
      const settled = nextPhotosList(page);
      await selectClientFilterOption(page, client.name, client.name);
      await settled;
      await settle(page);

      // Page 1: exactly 10 rows + honest server total.
      await expect(page.locator('table tbody tr')).toHaveCount(10);
      await expect(page.getByText('11 всего')).toBeVisible();

      // Page 2: the single remaining row.
      const pageTwo = nextPhotosList(page);
      await page.getByRole('button', { name: '2', exact: true }).click();
      await pageTwo;
      await settle(page);
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expect(page.getByText('11 всего')).toBeVisible();
    } finally {
      for (const id of photoIds) {
        await cleanup(request, `/api/v1/photos/${id}`);
      }
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — search: ≥2 chars hit, 1 char fires NO request, ✕ clears
// ---------------------------------------------------------------------------

test.describe('Photos — Search', () => {
  test('≥2-char search narrows server-side; 1 char fires no request; ✕ clears', async ({ page, request }) => {
    const token = `findme${Date.now()}`;
    const match = await createTestPhoto(request, { filename: `/images/e2e-${token}.jpg` });
    const decoy = await createTestPhoto(request, { filename: `/images/e2e-other-${Date.now()}.jpg` });
    try {
      await waitForPhotosReady(page);
      const searchInput = page.getByPlaceholder('Поиск фото...');
      await expect(searchInput).toBeVisible();

      // 1 char — under the server min-2 clamp: NO request may fire.
      const oneChar = page.waitForResponse(isPhotosList, { timeout: 1200 }).catch(() => null);
      await searchInput.fill(token.slice(0, 1));
      expect(await oneChar).toBeNull();

      // ≥2 chars — server q filter returns only the matching filename.
      const searchResp = nextPhotosList(page);
      await searchInput.fill(token);
      await searchResp;
      await settle(page);
      await expect(page.locator('table tbody tr')).toHaveCount(1);
      await expect(page.getByText(match.filename)).toBeVisible();
      await expect(page.getByText(decoy.filename)).toHaveCount(0);
      await expect(page.getByText('1 всего')).toBeVisible();

      // ✕ clears the search → both created photos are back.
      const cleared = nextPhotosList(page);
      await page.getByLabel('Очистить поиск').click();
      await cleared;
      await settle(page);
      await expect(page.getByText(match.filename)).toBeVisible();
      await expect(page.getByText(decoy.filename)).toBeVisible();
    } finally {
      await cleanup(request, `/api/v1/photos/${match.id}`);
      await cleanup(request, `/api/v1/photos/${decoy.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — client filter: only that client's photos, names not UUIDs
// ---------------------------------------------------------------------------

test.describe('Photos — Client filter', () => {
  test('typeahead select narrows to the client; «Клиент» column shows names', async ({ page, request }) => {
    const client = await createTestClient(request, { name: `Cli Filter ${Date.now()}` });
    const photoIds: string[] = [];
    try {
      for (let i = 0; i < 2; i++) {
        const photo = await createTestPhoto(request, { client_id: client.id });
        photoIds.push(photo.id);
      }

      await waitForPhotosReady(page);
      const settled = nextPhotosList(page);
      await selectClientFilterOption(page, client.name, client.name);
      await settled;
      await settle(page);

      // Exactly the client's 2 photos — seed photos (c1's) are excluded.
      const rows = page.locator('table tbody tr');
      await expect(rows).toHaveCount(2);
      await expect(page.getByText('/images/client-work-1.jpg')).toHaveCount(0);
      await expect(page.getByText('2 всего')).toBeVisible();

      // «Клиент» column (3rd visible cell) renders the NAME, never the UUID.
      for (const row of await rows.all()) {
        await expect(row.locator('td').nth(2)).toHaveText(client.name);
        await expect(row).not.toContainText(client.id);
      }
    } finally {
      for (const id of photoIds) {
        await cleanup(request, `/api/v1/photos/${id}`);
      }
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — service filter, variant A: direct + activity-derived
// ---------------------------------------------------------------------------

test.describe('Photos — Service filter (variant A)', () => {
  test('picking a service surfaces direct AND activity-derived photos', async ({ page, request }) => {
    const service = await createTestService(request);
    const activity = await createTestActivity(request, { service_id: service.id });
    const direct = await createTestPhoto(request, { service_id: service.id });
    const derived = await createTestPhoto(request, { activity_id: activity.id });
    try {
      await waitForPhotosReady(page);
      const settled = nextPhotosList(page);
      await searchAndSelect(
        page,
        page.getByLabel('Фильтр по услуге'),
        service.title,
        service.id,
      );
      await settled;
      await settle(page);

      // Both photos, and ONLY them — the service id is run-unique.
      await expect(page.getByText(direct.filename)).toBeVisible();
      await expect(page.getByText(derived.filename)).toBeVisible();
      await expect(page.locator('table tbody tr')).toHaveCount(2);
      await expect(page.getByText('2 всего')).toBeVisible();
    } finally {
      await cleanup(request, `/api/v1/photos/${direct.id}`);
      await cleanup(request, `/api/v1/photos/${derived.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/services/${service.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — location filter: direct-only ownership (seed pin, Task 4)
// ---------------------------------------------------------------------------

test.describe('Photos — Location filter', () => {
  test('location-OWNED photo visible; activity-owned photos at L1 are NOT', async ({ page, request }) => {
    // Seed pins (backend/src/seed/seed.py _seed_photos): ph4 is location-owned
    // at alpika; ph6/ph7 are activity-owned whose activities (ev_1/ev_4) also
    // sit at alpika — the direct-only filter must NOT surface them.
    const locsResp = await request.get(`${BACKEND}/api/v1/locations/all`);
    const alpika = ((await locsResp.json()) as Array<{ id: string; name: string }>).find(
      (l) => l.name === 'Альпика',
    );
    expect(alpika).toBeTruthy();

    await waitForPhotosReady(page);
    const settled = nextPhotosList(page);
    await searchAndSelect(page, page.getByLabel('Фильтр по локации'), 'Альпика', alpika!.id);
    await settled;
    await settle(page);

    await expect(page.getByText('/images/studio-alpika-interior.jpg')).toBeVisible();
    await expect(page.getByText('/images/guest-1.jpg')).toHaveCount(0);
    await expect(page.getByText('/images/guest-2.jpg')).toHaveCount(0);
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.getByText('1 всего')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — tags AND: the pair chip selects ONLY the pair photo
// ---------------------------------------------------------------------------

test.describe('Photos — Tags AND filter', () => {
  test('selecting «новинка» + «хит» chips leaves only the pair photo', async ({ page }) => {
    // Seed pins: ph5 carries tag1+tag2 (the pair); ph6 carries tag1+tag7 —
    // the AND semantics must drop it once tag2 joins the chip set.
    await waitForPhotosReady(page);
    const addTag = page.getByPlaceholder('Добавить тег...');

    const first = nextPhotosList(page);
    await addTag.fill('новинка');
    await page.getByRole('option', { name: 'новинка' }).click();
    await first;
    await settle(page);
    // Chip renders with a removal affordance.
    await expect(page.getByLabel('Удалить тег новинка')).toBeVisible();
    await expect(page.getByText('/images/tag-pair.jpg')).toBeVisible();
    await expect(page.getByText('/images/guest-1.jpg')).toBeVisible();

    // The add-typeahead holds the first pick as a readOnly selected label
    // (placeholder gone) — click its × (the page's only clear button here:
    // no modal open, other typeaheads unselected), then the placeholder
    // returns and the input accepts the second tag.
    await page.getByRole('button', { name: 'clear' }).click();
    const second = nextPhotosList(page);
    await addTag.fill('хит');
    await page.getByRole('option', { name: 'хит' }).click();
    await second;
    await settle(page);

    // AND: only the photo carrying BOTH tags survives.
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.getByText('/images/tag-pair.jpg')).toBeVisible();
    await expect(page.getByText('/images/guest-1.jpg')).toHaveCount(0);
    await expect(page.getByText('1 всего')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Scenario 7 — create modal: pickers, 4-owner 422s, replace pair, canonical label
// ---------------------------------------------------------------------------

test.describe('Photos — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForPhotosReady(page);
    await page.click('text=+ Добавить фото');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Новое фото')).toBeVisible();
    await expect(dialog.getByText('Сохранить')).toBeVisible();
    await expect(dialog.getByText('Отмена')).toBeVisible();
  });

  test('closes modal with escape key', async ({ page }) => {
    await waitForPhotosReady(page);
    await page.click('text=+ Добавить фото');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('client + location pickers present («Посетитель» gone); single-owner create succeeds', async ({ page, request }) => {
    const client = await createTestClient(request, { name: `Modal Client ${Date.now()}` });
    const filename = `/images/e2e-modal-${Date.now()}.jpg`;
    let photoId: string | null = null;
    try {
      await waitForPhotosReady(page);
      await page.click('text=+ Добавить фото');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // §7.5 pickers: «Клиент» typeahead + «Локация» select; no «Посетитель».
      await expect(dialog.getByRole('textbox', { name: 'Клиент' })).toBeVisible();
      await expect(dialog.locator('label', { hasText: 'Локация' })).toBeVisible();
      await expect(dialog.getByText('Посетитель')).toHaveCount(0);

      // Fill filename + pick the client (single owner) → create succeeds.
      await dialog.getByPlaceholder('photo-001.jpg').fill(filename);
      await dialog.getByRole('textbox', { name: 'Клиент' }).fill(client.name);
      await dialog.getByRole('option', { name: client.name }).click();

      const created = page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/photos') && resp.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await dialog.getByText('Сохранить').click();
      const createdResp = await created;
      expect(createdResp.status()).toBe(201);
      photoId = ((await createdResp.json()) as { id: string }).id;

      // Toast + row in the table (default created_at desc → freshly created).
      await expect(page.locator('[role="status"]').first()).toContainText('Фото создано');
      await expect(page.getByText(filename)).toBeVisible({ timeout: 10_000 });
    } finally {
      if (photoId) await cleanup(request, `/api/v1/photos/${photoId}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test('client + location → server 422 surfaced, nothing created', async ({ page, request }) => {
    const client = await createTestClient(request, { name: `Modal 422A ${Date.now()}` });
    const filename = `/images/e2e-422a-${Date.now()}.jpg`;
    try {
      await waitForPhotosReady(page);
      await page.click('text=+ Добавить фото');
      const dialog = page.getByRole('dialog');

      await dialog.getByPlaceholder('photo-001.jpg').fill(filename);
      await dialog.getByRole('textbox', { name: 'Клиент' }).fill(client.name);
      await dialog.getByRole('option', { name: client.name }).click();

      // Location field is a Combobox (GH #214 row 9) — open trigger, pick
      // «Альпика» by its option value (clear label is «Без локации»).
      const locsResp = await request.get(`${BACKEND}/api/v1/locations/all`);
      const alpika = ((await locsResp.json()) as Array<{ id: string; name: string }>).find(
        (l) => l.name === 'Альпика',
      );
      expect(alpika).toBeTruthy();
      await searchAndSelect(page, dialog.getByLabel('Локация'), 'Альпика', alpika!.id);

      await dialog.getByText('Сохранить').click();

      // 422 (≥2 owners) surfaces via the error toast — the existing
      // PhotosTable catch (plan Task 7: "surfaces via the existing error
      // catch — no new mechanics"); nothing reaches the DB.
      await expect(page.locator('[role="status"]').first()).toContainText(
        'Проверьте правильность заполнения полей',
      );

      const check = await request.get(`${BACKEND}/api/v1/photos?q=${encodeURIComponent(filename)}`);
      expect(((await check.json()) as { total: number }).total).toBe(0);
    } finally {
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test('client + service → server 422 surfaced, nothing created', async ({ page, request }) => {
    const client = await createTestClient(request, { name: `Modal 422B ${Date.now()}` });
    const filename = `/images/e2e-422b-${Date.now()}.jpg`;
    try {
      await waitForPhotosReady(page);
      await page.click('text=+ Добавить фото');
      const dialog = page.getByRole('dialog');

      await dialog.getByPlaceholder('photo-001.jpg').fill(filename);
      await dialog.getByRole('textbox', { name: 'Клиент' }).fill(client.name);
      await dialog.getByRole('option', { name: client.name }).click();
      await dialog.getByRole('textbox', { name: 'Услуга' }).fill('Картина маслом');
      await dialog.getByRole('option', { name: 'Картина маслом' }).click();

      await dialog.getByText('Сохранить').click();

      // 422 surfaces via the error toast (existing PhotosTable catch); nothing
      // reaches the DB.
      await expect(page.locator('[role="status"]').first()).toContainText(
        'Проверьте правильность заполнения полей',
      );

      const check = await request.get(`${BACKEND}/api/v1/photos?q=${encodeURIComponent(filename)}`);
      expect(((await check.json()) as { total: number }).total).toBe(0);
    } finally {
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  test('activity pick clears the service field; selected activity shows the canonical label', async ({ page, request }) => {
    // A UNIQUE test service keeps the activity typeahead deterministic —
    // leaked same-service activities from other specs (their records dep
    // blocks auto-cascade cleanup) crowd a shared service's top-10 results.
    // createTestActivity defaults to locations[0] → the canonical label is
    // computable from the same /locations list the modal uses.
    const service = await createTestService(request);
    const activity = await createTestActivity(request, { service_id: service.id });
    const locationsJson = await (await request.get(`${BACKEND}/api/v1/locations`)).json();
    const serviceTitle = service.title;
    const locationName = ((locationsJson.items ?? locationsJson) as Array<{ name: string }>)[0].name;

    const d = new Date(activity.start);
    const p = (n: number) => String(n).padStart(2, '0');
    const dateTime = `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    const expectedLabel = `${dateTime} — ${locationName} — ${serviceTitle}`;

    try {
      await waitForPhotosReady(page);
      await page.click('text=+ Добавить фото');
      const dialog = page.getByRole('dialog');

      // Pick a service first.
      const serviceInput = dialog.getByRole('textbox', { name: 'Услуга' });
      await serviceInput.fill(serviceTitle);
      await dialog.getByRole('option', { name: serviceTitle }).click();
      await expect(serviceInput).toHaveValue(serviceTitle);

      // Pick an activity (search matches its service title).
      const activityInput = dialog.getByRole('textbox', { name: 'Активность' });
      await activityInput.fill(serviceTitle);
      await dialog.getByRole('option', { name: expectedLabel }).click();

      // Replace semantics (§7.5): the service selection is cleared.
      await expect(serviceInput).toHaveValue('');
      // Canonical label (§7.7) — date-first «dd.mm.yyyy HH:mm — Loc — Svc».
      await expect(activityInput).toHaveValue(expectedLabel);
      await expect(activityInput).toHaveValue(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2} — /);
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/services/${service.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Edit via row click (pre-existing behaviour, kept honest)
// ---------------------------------------------------------------------------

test.describe('Photos — Edit via Row Click', () => {
  test('click row opens edit modal', async ({ page }) => {
    await waitForPhotosReady(page);

    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.getByText('Редактирование фото')).toBeVisible();

    // Close modal (not dirty → no confirm)
    await page.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------------------
// Column picker — «Активность» scoped to the popover (filters-bar collision)
// ---------------------------------------------------------------------------

test.describe('Photos — Column Picker', () => {
  test('column picker toggles the hidden «Активность» column', async ({ page }) => {
    await waitForPhotosReady(page);

    await page.click('[aria-label="Настроить колонки"]');
    // Scope to the picker's checkbox labels — the filters bar also has an
    // «Активность» label (strict-mode collision the rewrite resolves).
    const activityToggle = page.locator('label:has(input[type="checkbox"])').filter({ hasText: 'Активность' });
    await expect(activityToggle).toBeVisible();

    // Toggle on → the column header appears; toggle off → it disappears.
    await activityToggle.click();
    await expect(page.locator('table thead th').filter({ hasText: 'Активность' })).toBeVisible();
    await activityToggle.click();
    await expect(page.locator('table thead th').filter({ hasText: 'Активность' })).toHaveCount(0);

    await page.keyboard.press('Escape');
  });
});

// ---------------------------------------------------------------------------
// Actions dropdown (pre-existing behaviour, kept honest)
// ---------------------------------------------------------------------------

test.describe('Photos — Actions Dropdown', () => {
  test('actions dropdown opens on button click', async ({ page }) => {
    await waitForPhotosReady(page);

    const count = await page.locator('table tbody tr').count();
    expect(count).toBeGreaterThan(0);
    const actionsBtn = page.locator('table tbody button[aria-label^="Действия"]').first();
    await expect(actionsBtn).toBeVisible();
    await actionsBtn.click();

    const dropdown = page.locator('table tbody [data-testid^="dropdown-"]').first();
    await expect(dropdown).toBeVisible();
    await expect(dropdown.locator('button:has-text("Редактировать")')).toBeVisible();
    await expect(dropdown.locator('button:has-text("Удалить")')).toBeVisible();
  });
});
