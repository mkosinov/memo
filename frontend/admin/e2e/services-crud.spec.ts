import { test, expect } from './fixtures/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import {
  waitForServicesReady,
  waitForLocationsReady,
  waitForToast,
  openRowActionDropdown,
  clickRowDelete,
  confirmDeleteDialog,
  commitDeleteWait,
} from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  createTestService,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

/**
 * E2E tests for Services page: table rendering, CRUD operations,
 * modal behavior, filters, and column picker.
 *
 * Requires: dev server on :3001, backend on :8000
 */

// ---------------------------------------------------------------------------
// Tests — Services Page
// ---------------------------------------------------------------------------

test.describe('Services — Table and Navigation', () => {
  test('navigates to services page and renders table', async ({ page }) => {
    await waitForServicesReady(page);
    await expect(page.getByText('Управление услугами')).toBeVisible();
    await expect(page.getByText('+ Добавить услугу')).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('search filter works', async ({ page }) => {
    await waitForServicesReady(page);
    const searchInput = page.getByPlaceholder('Название...');
    await expect(searchInput).toBeVisible();
    await searchInput.fill('тест');
  });

  test('status filter works', async ({ page }) => {
    await waitForServicesReady(page);
    const statusSelect = page.getByLabel('Фильтр по статусу');
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption('archived');
  });

  test('column picker toggles column visibility', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('[aria-label="Настроить колонки"]');
    await expect(page.getByText('Специализация')).toBeVisible();
    await page.click('text=Специализация');
    await page.keyboard.press('Escape');
  });
});

test.describe('Services — Create Modal', () => {
  test('opens create modal when clicking add button', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Новая услуга')).toBeVisible();
    await expect(dialog.getByText('Сохранить')).toBeVisible();
    await expect(dialog.getByText('Отмена')).toBeVisible();
  });

  test('validates required fields in create modal', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await dialog.getByText('Сохранить').click();
    await page.waitForTimeout(300);
    const errors = dialog.locator('[style*="danger"], .text-red-500');
    await expect(errors.first()).toBeVisible({ timeout: 5_000 });
  });

  test('closes modal with escape key', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('shows dirty check when closing with changes', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Мастер-класс').fill('Тест');
    page.on('dialog', (d) => d.dismiss());
    await dialog.getByText('Отмена').click();
    await expect(dialog).toBeVisible();
  });

  test('adds and removes tariffs in nested list', async ({ page }) => {
    await waitForServicesReady(page);
    await page.click('text=+ Добавить услугу');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByText('+ Добавить тариф').click();
    await expect(dialog.getByText('Тариф 1')).toBeVisible();
    await dialog.getByLabel('Удалить Тариф').click();
    await expect(dialog.getByText('Нет тарифов')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// GH #357 — Tariff diff by id: US-1..US-5 (spec
// docs/specs/2026-10-09-services-tariff-diff-357-design.md § User Scenarios).
//
// Seed fixtures: s5 «Ручная лепка» (t5a «Взрослый» 2200 adult, t5c «Детский»
// 1800 kid, t5i «Индивидуальный» 3500 all) with visits v3 (t5a, 2200) +
// v4 (t5c, 1800) on record r2; s7 «Морской пейзаж» (t7a «Взрослый» 3800,
// t7c «Детский» 2800, t7i «Индивидуальный» 5500). The scenarios assert
// the t*a/t*c rows the plan names; the third seed tariff rides along as
// an extra id-stability witness. The seedReset fixture restores every
// mutated seed row before each test, so the scenarios may edit/delete in
// place with no manual restore.
//
// The busy-without-activities shape for US-5 comes from the backend
// contract test (backend/tests/services/test_tariff_visit_unlink.py,
// scenario 2): a service whose ONLY deps are visited tariffs, with the
// record living on ANOTHER service's activity (visits.tariff_id is an
// informational link — the API does not constrain it to the activity's
// service). The seeded s7 cannot play this role: its ev_* activities
// BLOCK service hard-delete by design (domain-rules/services.md § FK
// dependencies), so the fixture is factory-built per run.
// ---------------------------------------------------------------------------

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8000';

/** Tariff shape on GET /api/v1/services/{id} (fields the scenarios assert). */
interface TariffPayload {
  id: string;
  title: string;
  price: number;
  audience: string;
}

interface ServiceWithTariffs {
  id: string;
  title: string;
  tariffs: TariffPayload[];
}

/** Visit shape on GET /api/v1/records/{id} (link + price snapshot). */
interface VisitPayload {
  id: string;
  tariff_id: string | null;
  price: number;
}

async function fetchService(api: APIRequestContext, id: string): Promise<ServiceWithTariffs> {
  const resp = await api.get(`${BACKEND}/api/v1/services/${id}`);
  expect(resp.ok()).toBeTruthy();
  return (await resp.json()) as ServiceWithTariffs;
}

async function fetchRecordVisits(api: APIRequestContext, recordId: string): Promise<VisitPayload[]> {
  const resp = await api.get(`${BACKEND}/api/v1/records/${recordId}`);
  expect(resp.ok()).toBeTruthy();
  return ((await resp.json()) as { visits: VisitPayload[] }).visits;
}

/** Link + snapshot projection — the invariant columns of a visit. */
const visitLink = (v: VisitPayload) => ({ id: v.id, tariff_id: v.tariff_id, price: v.price });

/**
 * The «Тариф N» row card inside the ServiceModal: the bordered div that
 * hosts the row header span («Тариф N» → header div → card). Structural
 * climb keeps it immune to styling-class churn.
 */
function tariffCard(dialog: Locator, n: number): Locator {
  return dialog.getByText(`Тариф ${n}`, { exact: true }).locator('xpath=../..');
}

/** Open the edit modal for a service by its (unique) row title. */
async function openServiceEditor(page: Page, title: string): Promise<Locator> {
  await waitForServicesReady(page);
  await page.getByTestId('page-size-select').selectOption('100');
  const row = page.locator('table tbody tr').filter({ hasText: title });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  return dialog;
}

/**
 * Save the open editor and wait for the full round-trip: PUT ok → modal
 * closed → success toast → the services list refetch (invalidation) has
 * landed, so a subsequent reopen prefills from FRESH row data.
 */
async function saveServiceAndRefresh(page: Page, serviceId: string): Promise<void> {
  const listRefetch = page
    .waitForResponse(
      (r) =>
        /\/api\/v1\/services(\?|$)/.test(r.url()) &&
        r.request().method() === 'GET' &&
        r.status() === 200,
      { timeout: 20_000 },
    )
    .catch(() => {});
  const put = page.waitForResponse(
    (r) => r.url().includes(`/api/v1/services/${serviceId}`) && r.request().method() === 'PUT',
    { timeout: 20_000 },
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Сохранить' }).click();
  const resp = await put;
  expect(resp.ok()).toBeTruthy();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
  await waitForToast(page, 'Услуга обновлена');
  await listRefetch;
}

test.describe('Services — Tariff diff by id (GH #357 US-1..US-4)', () => {
  test('US-1: editing a busy tariff keeps its id and the visits untouched', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const visitsBefore = (await fetchRecordVisits(request, 'r2')).map(visitLink);

    const dialog = await openServiceEditor(page, 'Ручная лепка');
    const adult = tariffCard(dialog, 1); // t5a «Взрослый» — first in list
    await expect(adult.getByLabel('Название')).toHaveValue('Взрослый');
    await adult.getByLabel('Название').fill('Взрослый+');
    await adult.getByLabel('Цена').fill('2500');
    await saveServiceAndRefresh(page, 's5');

    // API — the tariff was UPDATED in place: same id, new title/price;
    // the sibling rows (t5c, t5i) untouched.
    const after = await fetchService(request, 's5');
    expect(after.tariffs.map((t) => t.id)).toEqual(expect.arrayContaining(['t5a', 't5c', 't5i']));
    const t5a = after.tariffs.find((t) => t.id === 't5a');
    expect(t5a).toMatchObject({ title: 'Взрослый+', price: 2500 });
    expect(after.tariffs.find((t) => t.id === 't5c')).toMatchObject({
      title: 'Детский',
      price: 1800,
    });
    expect(after.tariffs.find((t) => t.id === 't5i')).toMatchObject({
      title: 'Индивидуальный',
      price: 3500,
    });

    // UI — reopening the form shows the new values (spec US-1).
    const dialog2 = await openServiceEditor(page, 'Ручная лепка');
    await expect(tariffCard(dialog2, 1).getByLabel('Название')).toHaveValue('Взрослый+');
    await expect(tariffCard(dialog2, 1).getByLabel('Цена')).toHaveValue('2500');

    // Visits — links and price snapshots unchanged (r2: v3 on t5a, v4 on t5c).
    const visitsAfter = (await fetchRecordVisits(request, 'r2')).map(visitLink);
    expect(visitsAfter).toEqual(visitsBefore);
  });

  test('US-2: removing a visited tariff unhooks its visits, price snapshot stays', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const dialog = await openServiceEditor(page, 'Ручная лепка');
    // Three seed rows; the t5c «Детский» row is second in the list. Row
    // numbers renumber after removal, so the post-state is asserted by
    // row COUNT and by VALUE, never by the «Тариф N» label.
    await expect(dialog.getByLabel('Удалить Тариф')).toHaveCount(3);
    const kid = tariffCard(dialog, 2);
    await expect(kid.getByLabel('Название')).toHaveValue('Детский');
    await kid.getByLabel('Удалить Тариф').click();
    await expect(dialog.getByLabel('Удалить Тариф')).toHaveCount(2);
    // The t5c row is gone (its audience select's title-keyed label with it);
    // the t5a/t5i rows are still there.
    await expect(dialog.getByLabel('Возрастная группа: Детский')).toHaveCount(0);
    await expect(dialog.getByLabel('Возрастная группа: Взрослый')).toHaveCount(1);
    await expect(dialog.getByLabel('Возрастная группа: Индивидуальный')).toHaveCount(1);
    await saveServiceAndRefresh(page, 's5');

    // API — t5c is gone; t5a and t5i survive with their ids.
    const after = await fetchService(request, 's5');
    expect(after.tariffs).toHaveLength(2);
    expect(after.tariffs.map((t) => t.id)).toEqual(expect.arrayContaining(['t5a', 't5i']));

    // Visits — the former t5c visit survives with tariff_id = null and its
    // creation-time price snapshot; the t5a visit is untouched.
    const visits = await fetchRecordVisits(request, 'r2');
    expect(visits).toHaveLength(2);
    const unlinked = visits.find((v) => v.tariff_id === null);
    expect(unlinked).toBeDefined();
    expect(unlinked!.price).toBe(1800);
    expect(visits.find((v) => v.tariff_id === 't5a')).toMatchObject({ price: 2200 });
  });

  test('US-3: adding a tariff to a busy service keeps existing ids stable', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const before = await fetchService(request, 's7');
    expect(before.tariffs.map((t) => t.id).sort()).toEqual(['t7a', 't7c', 't7i']);

    const dialog = await openServiceEditor(page, 'Морской пейзаж');
    await dialog.getByText('+ Добавить тариф').click();
    const fresh = tariffCard(dialog, 4); // 3 seed rows + the new one
    await fresh.getByLabel('Название').fill('Групповой');
    await fresh.getByLabel('Цена').fill('3200');
    await saveServiceAndRefresh(page, 's7');

    // API — four tariffs: t7a/t7c/t7i keep their ids and values, the new
    // row got a server id (no delete+recreate churn of the existing trio).
    const after = await fetchService(request, 's7');
    expect(after.tariffs).toHaveLength(4);
    expect(after.tariffs.find((t) => t.id === 't7a')).toMatchObject({
      title: 'Взрослый',
      price: 3800,
    });
    expect(after.tariffs.find((t) => t.id === 't7c')).toMatchObject({
      title: 'Детский',
      price: 2800,
    });
    expect(after.tariffs.find((t) => t.id === 't7i')).toMatchObject({
      title: 'Индивидуальный',
      price: 5500,
    });
    const added = after.tariffs.find((t) => !['t7a', 't7c', 't7i'].includes(t.id));
    expect(added).toMatchObject({ title: 'Групповой', price: 3200 });
    expect(added!.id).toBeTruthy();
  });

  test('US-4: renaming the service only — all tariff ids match (no silent churn)', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const before = await fetchService(request, 's5');
    const snapshot = before.tariffs.map(({ id, title, price, audience }) => ({
      id,
      title,
      price,
      audience,
    }));
    const visitsBefore = (await fetchRecordVisits(request, 'r2')).map(visitLink);

    const dialog = await openServiceEditor(page, 'Ручная лепка');
    // The SERVICE title field — the tariff rows carry their own «Название»
    // labels, so the top-level one is targeted by its unique placeholder.
    await dialog.getByPlaceholder('Мастер-класс по рисованию').fill('Ручная лепка (прогрев)');
    await saveServiceAndRefresh(page, 's5');

    // API — new title, byte-identical tariff rows.
    const after = await fetchService(request, 's5');
    expect(after.title).toBe('Ручная лепка (прогрев)');
    expect(
      after.tariffs.map(({ id, title, price, audience }) => ({ id, title, price, audience })),
    ).toEqual(snapshot);

    // Visits — links and snapshots intact through the save.
    const visitsAfter = (await fetchRecordVisits(request, 'r2')).map(visitLink);
    expect(visitsAfter).toEqual(visitsBefore);
  });
});

test.describe('Services — family delete with visited tariffs (GH #357 US-5)', () => {
  test('US-5: dry-run → confirm → service gone, visits survive with price and null tariff link', async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);

    // SETUP — the busy-without-activities shape (see the file-header note):
    // a factory service carrying only tariffs + a record on ANOTHER
    // service's activity whose visits point at the doomed tariffs.
    const dead = (await createTestService(request, {
      tariffs: [
        { title: 'Взрослый', price: 3000, audience: 'all' },
        { title: 'Детский', price: 2000, audience: 'kid' },
      ],
    })) as ServiceWithTariffs;
    const client = await createTestClient(request);
    const activity = await createTestActivity(request); // seed service ≠ dead
    const record = await createTestRecord(request, activity.id, client.id, {
      visits: [
        { name: 'Гость А', tariff_id: dead.tariffs[0].id, price: 3000 },
        { name: 'Гость Б', tariff_id: dead.tariffs[1].id, price: 2000 },
      ],
    });

    try {
      // Sanity — the record is live and busy: two linked visits, sum 5000.
      const before = await fetchRecordVisits(request, record.id);
      expect(before).toHaveLength(2);
      expect(before.every((v) => v.tariff_id !== null)).toBe(true);
      const sumBefore = before.reduce((s, v) => s + v.price, 0);
      expect(sumBefore).toBe(5000);

      // ACTION — the family scenario: row ⋯ → Удалить fires the pure
      // dry-run preview (no body) → 409 + the dependency tree.
      await waitForServicesReady(page);
      await page.getByTestId('page-size-select').selectOption('100');
      const row = page.locator('table tbody tr').filter({ hasText: dead.title });
      await expect(row).toBeVisible({ timeout: 10_000 });

      const dryRunPromise = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/services/${dead.id}`) &&
          r.url().includes('dry_run=true') &&
          r.status() === 409,
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;
      const tree = ((await dryRun.json()).dependencies ?? []) as Array<{
        entity: string;
        count: number;
        auto: boolean;
        allowed_actions: string[];
      }>;
      expect(tree.find((d) => d.entity === 'tariffs')).toMatchObject({
        count: 2,
        auto: true,
        allowed_actions: ['cascade'],
      });

      // VERIFY UI — the expectations review: the auto-cascade tariff line;
      // all-auto tree → no confirm checkbox, «Удалить» enabled immediately.
      await expect(page.locator('[data-testid="delete-dialog"]')).toBeVisible();
      await expect(page.locator('[data-testid="dep-tariffs"]')).toContainText('Тарифы');
      await expect(page.locator('[data-testid="dep-tariffs"]')).toContainText('2');
      await expect(page.locator('[data-testid="delete-dialog-confirm-checkbox"]')).toHaveCount(0);

      // ACTION — confirm; the deferred commit (DELETE with body) lands at
      // the 5s undo window end.
      const commitWait = commitDeleteWait(page, '/api/v1/services', dead.id);
      await confirmDeleteDialog(page);
      const commit = await commitWait;
      expect(commit.status()).toBe(204);

      // VERIFY API — the service and its tariffs are gone…
      const gone = await request.get(`${BACKEND}/api/v1/services/${dead.id}`);
      expect(gone.status()).toBe(404);

      // …the record kept its visits: links nulled (ondelete=SET NULL),
      // price snapshots and the record sum intact.
      const after = await fetchRecordVisits(request, record.id);
      expect(after).toHaveLength(2);
      expect(after.every((v) => v.tariff_id === null)).toBe(true);
      expect(after.map((v) => v.price).sort()).toEqual([2000, 3000]);
      expect(after.reduce((s, v) => s + v.price, 0)).toBe(sumBefore);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
      await cleanup(request, `/api/v1/clients/${client.id}`);
      await cleanup(request, `/api/v1/services/${dead.id}`);
    }
  });
});
