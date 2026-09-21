/**
 * E2E for feature #284 «Автоподстановка тарифа по возрастной группе».
 *
 * The eight user scenarios from the spec §4 (each → one test):
 *   1. Детская строка — age 6 in a new visitor row → kid tariff, kid price.
 *   2. Взрослая строка — age 14 → adult tariff, adult price.
 *   3. Год неизвестен — age 8 (any «Дети» age) → same kid tariff as for 6.
 *   4. Ручной выбор затирается — a manual adult pick on an age-6 row is
 *      clobbered by the 6→7 re-substitution; returning the age to
 *      «Взрослый» re-substitutes the adult tariff.
 *   5. Единый тариф — a single "all" tariff: age changes never touch it.
 *   6. Ничего не помечено — all-"all" tariffs (and kid-only at an adult
 *      age): first-in-list legacy behaviour, groups may cross.
 *   7. Настройка в редакторе — audience selects in ServiceModal persist
 *      through save + reopen.
 *   8. Две детские (холсты) — two kid tariffs: age 6 substitutes the FIRST,
 *      a manual switch to the second rewrites the price, 6→7 returns the
 *      first.
 *
 * Scenarios: docs/specs/2026-09-19-tariff-age-autofill-284-design.md §4.
 *
 * Pattern: full cycle per test (self-contained services created via the
 * API — services-materials.spec.ts precedent), UI action in the browser,
 * verify UI + verify API, cleanup in finally.
 */
import { test, expect } from './fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  createTestService,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { waitForScheduleReady, waitForServicesReady, waitForToast } from './fixtures/helpers';
import { openRecordTab } from './helpers/anonymous-visits';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

// ─── Local fixtures ──────────────────────────────────────────────────────────

/** Tariff payload shape for POST /api/v1/services (TariffCreate). */
interface TariffSeed {
  title: string;
  price: number;
  audience: 'kid' | 'adult' | 'all';
}

interface ServiceWithTariffs {
  id: string;
  title: string;
  tariffs: Array<{ id: string; title: string; price: number; audience: string }>;
}

let counter = 0;
function uid(): string {
  counter += 1;
  return `${Date.now()}_${counter}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Create a service with explicit audience-marked tariffs via the API. */
async function createServiceWithTariffs(
  api: APIRequestContext,
  tariffs: TariffSeed[],
): Promise<ServiceWithTariffs> {
  const resp = await api.post(`${BACKEND}/api/v1/services`, {
    data: {
      title: `Услуга ${uid()}`,
      description: 'e2e #284 tariff-age-autofill',
      image_url: '',
      specialty: 'живопись',
      min_age: 5,
      max_age: null,
      duration: 90,
      record_info: 'e2e seed',
      tariffs: tariffs.map((t) => ({
        title: t.title,
        price: t.price,
        audience: t.audience,
      })),
      tag_ids: [],
    },
  });
  expect(resp.ok()).toBeTruthy();
  return await resp.json();
}

/** The visits-table surface: client + activity (on the service) + record. */
interface RowSetup {
  service: ServiceWithTariffs;
  recordId: string;
  clientId: string;
  activityId: string;
  cleanupAll: () => Promise<void>;
}

/**
 * Create the record whose ClientTab hosts the visitor rows. `visits` seeds
 * the row the scenario manipulates (name-based mode creates the visitor
 * with the given age — #257 unified visitors model).
 */
async function setupRecord(
  api: APIRequestContext,
  service: ServiceWithTariffs,
  visits: Array<{ name: string; age?: number; tariff_id?: string; price: number }>,
): Promise<RowSetup> {
  const client = await createTestClient(api);
  const activity = await createTestActivity(api, { service_id: service.id });
  const record = await createTestRecord(api, activity.id, client.id, { visits });

  return {
    service,
    recordId: record.id,
    clientId: client.id,
    activityId: activity.id,
    cleanupAll: async () => {
      await cleanupRecord(api, record.id);
      await cleanup(api, `/api/v1/clients/${client.id}`);
      await cleanup(api, `/api/v1/activities/${activity.id}`);
      await cleanup(api, `/api/v1/services/${service.id}`);
    },
  };
}

/** GET the record with nested visits (server truth, no cache). */
async function fetchVisits(api: APIRequestContext, recordId: string) {
  const resp = await api.get(`${BACKEND}/api/v1/records/${recordId}`);
  expect(resp.ok()).toBeTruthy();
  const body = (await resp.json()) as {
    visits: Array<{ id: string; visitor_id: string | null; tariff_id: string | null; price: number }>;
  };
  return body.visits;
}

/**
 * Poll until the record has 2 visits and the SECOND one (the draft-saved
 * row) carries the expected tariff — resolves that visit. Index-anchored on
 * the creation order, but the tariff predicate makes a wrong order fail
 * loudly instead of hanging the poll.
 */
async function waitForSecondVisit(
  api: APIRequestContext,
  recordId: string,
  expectedTariffId: string,
) {
  let found: { id: string; visitor_id: string | null; tariff_id: string | null; price: number } | null = null;
  await expect
    .poll(async () => {
      const visits = await fetchVisits(api, recordId);
      found = visits.length === 2 && visits[1].tariff_id === expectedTariffId ? visits[1] : null;
      return found !== null;
    }, { timeout: 20_000 })
    .toBeTruthy();
  return found!;
}

/**
 * Open the record tab and add a NEW draft visitor row (the «создаёт строку
 * посетителя» surface). Resolves the draft row's controls.
 *
 * These specs are heavy (schedule + modal + dev-compile on first hit) —
 * 120s per test, cabinet.spec.ts precedent.
 */
async function openTabAndAddDraft(page: Page, recordId: string) {
  test.setTimeout(120_000);
  await page.goto('/schedule');
  await waitForScheduleReady(page);
  await openRecordTab(page, recordId);
  await page.locator('[data-testid="btn-add-visitor"]').click();
  const row = page.locator('[data-testid="visit-row-new"]');
  await expect(row).toBeVisible({ timeout: 10_000 });
  return {
    row,
    name: row.locator('[data-testid="add-visitor-name"]'),
    age: row.locator('[data-testid="add-visitor-age"]'),
    tariff: row.locator('[data-testid="add-visitor-tariff"]'),
    price: row.locator('input[type="number"]'),
  };
}

// ─── 1–3: draft-row substitution (kid / adult / unknown-exact-age) ───────────

test.describe('Tariff age autofill — visitor rows (#284 scenarios 1–3)', () => {
  // Scenario 1: kid+adult pair, kid FIRST in the API order — proves the
  // classifier (not list position) drives the substitution.
  test('S1: age 6 in a new row → kid tariff, kid price', async ({ page, request }) => {
    const service = await createServiceWithTariffs(request, [
      { title: 'Детский', price: 2000, audience: 'kid' },
      { title: 'Взрослый', price: 3500, audience: 'adult' },
    ]);
    const setup = await setupRecord(request, service, [{ name: 'Основа', price: 3500 }]);

    try {
      const draft = await openTabAndAddDraft(page, setup.recordId);
      await draft.name.fill('Ребёнок');

      // Empty age → adult side (3500) even though kid is first in the list.
      await expect(draft.tariff).toHaveValue(service.tariffs[1].id);
      await expect(draft.price).toHaveValue('3500');

      // ACTION: pick age 6 → kid tariff + kid price IN THE ROW.
      await draft.age.selectOption('6');
      await expect(draft.tariff).toHaveValue(service.tariffs[0].id);
      await expect(draft.price).toHaveValue('2000');

      // Save (Enter) → VERIFY API: the persisted visit carries the kid
      // tariff/price and the visitor the picked age.
      await draft.name.press('Enter');
      const newVisit = await waitForSecondVisit(request, setup.recordId, service.tariffs[0].id);
      expect(newVisit.price).toBe(2000);
      const visitorResp = await request.get(`${BACKEND}/api/v1/visitors/${newVisit.visitor_id}`);
      expect(((await visitorResp.json()) as { age: number | null }).age).toBe(6);
    } finally {
      await setup.cleanupAll();
    }
  });

  test('S2: age 14 in a new row → adult tariff, adult price', async ({ page, request }) => {
    const service = await createServiceWithTariffs(request, [
      { title: 'Детский', price: 2000, audience: 'kid' },
      { title: 'Взрослый', price: 3500, audience: 'adult' },
    ]);
    const setup = await setupRecord(request, service, [{ name: 'Основа', price: 3500 }]);

    try {
      const draft = await openTabAndAddDraft(page, setup.recordId);
      await draft.name.fill('Подросток');

      // ACTION: age 14 (Подростки group → adult side).
      await draft.age.selectOption('14');
      await expect(draft.tariff).toHaveValue(service.tariffs[1].id);
      await expect(draft.price).toHaveValue('3500');

      // VERIFY API after save.
      await draft.name.press('Enter');
      const newVisit = await waitForSecondVisit(request, setup.recordId, service.tariffs[1].id);
      expect(newVisit.price).toBe(3500);
    } finally {
      await setup.cleanupAll();
    }
  });

  test('S3: unknown exact age — 8 behaves exactly like 6 (kid tariff)', async ({ page, request }) => {
    const service = await createServiceWithTariffs(request, [
      { title: 'Детский', price: 2000, audience: 'kid' },
      { title: 'Взрослый', price: 3500, audience: 'adult' },
    ]);
    const setup = await setupRecord(request, service, [{ name: 'Основа', price: 3500 }]);

    try {
      const draft = await openTabAndAddDraft(page, setup.recordId);
      await draft.name.fill('Ребёнок без года');

      // ACTION: the admin does not know the exact age — any «Дети» number
      // works the same. 8 → the SAME kid tariff as scenario 1's 6.
      await draft.age.selectOption('8');
      await expect(draft.tariff).toHaveValue(service.tariffs[0].id);
      await expect(draft.price).toHaveValue('2000');

      await draft.name.press('Enter');
      const newVisit = await waitForSecondVisit(request, setup.recordId, service.tariffs[0].id);
      expect(newVisit.price).toBe(2000);
    } finally {
      await setup.cleanupAll();
    }
  });
});

// ─── 4: manual pick is clobbered by re-substitution ──────────────────────────

test.describe('Tariff age autofill — manual pick clobbered (#284 scenario 4)', () => {
  test('S4: manual adult tariff on an age-6 row is re-substituted on 6→7 and on «Взрослый»', async ({
    page,
    request,
  }) => {
    const service = await createServiceWithTariffs(request, [
      { title: 'Детский', price: 2000, audience: 'kid' },
      { title: 'Взрослый', price: 3500, audience: 'adult' },
    ]);
    const kid = service.tariffs[0];
    const adult = service.tariffs[1];
    // A saved row whose visitor is 6 years old on the kid tariff.
    const setup = await setupRecord(request, service, [
      { name: 'Ребёнок', age: 6, tariff_id: kid.id, price: kid.price },
    ]);
    const visitId = (await fetchVisits(request, setup.recordId))[0].id;

    try {
      test.setTimeout(120_000);
      await page.goto('/schedule');
      await waitForScheduleReady(page);
      await openRecordTab(page, setup.recordId);
      const row = page.locator(`[data-testid="visit-row-${visitId}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      const tariff = row.locator(`[data-testid="visit-${visitId}-tariff"]`);
      const age = row.locator(`[data-testid="visit-${visitId}-age"]`);
      await expect(tariff).toHaveValue(kid.id);

      // ACTION 1: manual adult pick on the age-6 row (persisted patch).
      await tariff.selectOption(adult.id);
      await expect
        .poll(async () => {
          const [visit] = await fetchVisits(request, setup.recordId);
          return visit.tariff_id === adult.id ? visit.price : null;
        }, { timeout: 15_000 })
        .toBe(adult.price);

      // ACTION 2: age 6→7 — the re-substitution CLOBBERS the manual pick
      // (kid side again) and rewrites the price.
      await age.selectOption('7');
      await expect(tariff).toHaveValue(kid.id, { timeout: 10_000 });
      await expect
        .poll(async () => {
          const [visit] = await fetchVisits(request, setup.recordId);
          return visit.tariff_id === kid.id ? visit.price : null;
        }, { timeout: 15_000 })
        .toBe(kid.price);

      // ACTION 3: the age back to «Взрослый» — the adult tariff is
      // re-substituted.
      await age.selectOption('adult');
      await expect(tariff).toHaveValue(adult.id, { timeout: 10_000 });
      await expect
        .poll(async () => {
          const [visit] = await fetchVisits(request, setup.recordId);
          return visit.tariff_id === adult.id ? visit.price : null;
        }, { timeout: 15_000 })
        .toBe(adult.price);
    } finally {
      await setup.cleanupAll();
    }
  });
});

// ─── 5–6: "all" tariffs never participate in substitution ────────────────────

test.describe('Tariff age autofill — unmarked services (#284 scenarios 5–6)', () => {
  test('S5: single «единый» tariff — age changes never touch tariff or price', async ({
    page,
    request,
  }) => {
    const service = await createServiceWithTariffs(request, [
      { title: 'Единый', price: 1800, audience: 'all' },
    ]);
    const unified = service.tariffs[0];
    const setup = await setupRecord(request, service, [{ name: 'Основа', price: 1800 }]);

    try {
      const draft = await openTabAndAddDraft(page, setup.recordId);
      await draft.name.fill('Гость');

      // Draft default: first in list (the only one).
      await expect(draft.tariff).toHaveValue(unified.id);
      await expect(draft.price).toHaveValue('1800');

      // Any age change: kid side…
      await draft.age.selectOption('6');
      await expect(draft.tariff).toHaveValue(unified.id);
      await expect(draft.price).toHaveValue('1800');

      // …adult side — "all" never participates in the substitution.
      await draft.age.selectOption('14');
      await expect(draft.tariff).toHaveValue(unified.id);
      await expect(draft.price).toHaveValue('1800');

      // VERIFY API after save.
      await draft.name.press('Enter');
      const newVisit = await waitForSecondVisit(request, setup.recordId, unified.id);
      expect(newVisit.price).toBe(1800);
    } finally {
      await setup.cleanupAll();
    }
  });

  test('S6: nothing marked — first-in-list legacy behaviour (all-only + kid-only at adult age)', async ({
    page,
    request,
  }) => {
    // (а) all-only service: every tariff «единый» — any age keeps the FIRST.
    const allOnly = await createServiceWithTariffs(request, [
      { title: 'Базовый', price: 1000, audience: 'all' },
      { title: 'Расширенный', price: 1500, audience: 'all' },
    ]);
    const setupA = await setupRecord(request, allOnly, [{ name: 'Основа', price: 1000 }]);

    // (б) kid-only service at an ADULT age: no adult tariff → the fallback
    // crosses groups to the first in list (legacy, owner-accepted).
    const kidOnly = await createServiceWithTariffs(request, [
      { title: 'Детский малый', price: 1200, audience: 'kid' },
      { title: 'Детский большой', price: 1700, audience: 'kid' },
    ]);
    const setupB = await setupRecord(request, kidOnly, [{ name: 'Основа', price: 1200 }]);

    try {
      // (а) draft rows on the all-only service.
      {
        const draft = await openTabAndAddDraft(page, setupA.recordId);
        await draft.name.fill('Гость А');
        await expect(draft.tariff).toHaveValue(allOnly.tariffs[0].id);
        await expect(draft.price).toHaveValue('1000');

        await draft.age.selectOption('6');
        await expect(draft.tariff).toHaveValue(allOnly.tariffs[0].id);
        await expect(draft.price).toHaveValue('1000');

        await draft.age.selectOption('14');
        await expect(draft.tariff).toHaveValue(allOnly.tariffs[0].id);
        await expect(draft.price).toHaveValue('1000');
      }

      // (б) kid-only service: adult age falls back to the first kid.
      {
        const draft = await openTabAndAddDraft(page, setupB.recordId);
        await draft.name.fill('Гость Б');
        // Empty age (adult side) — no adult tariff → first in list.
        await expect(draft.tariff).toHaveValue(kidOnly.tariffs[0].id);
        await expect(draft.price).toHaveValue('1200');

        // Explicit adult age — same fallback.
        await draft.age.selectOption('adult');
        await expect(draft.tariff).toHaveValue(kidOnly.tariffs[0].id);
        await expect(draft.price).toHaveValue('1200');
      }
    } finally {
      await setupA.cleanupAll();
      await setupB.cleanupAll();
    }
  });
});

// ─── 7: audience setup in the service editor ─────────────────────────────────

test.describe('Tariff age autofill — service editor (#284 scenario 7)', () => {
  test('S7: assign kid/adult/all groups in ServiceModal → saved → groups survive reopen', async ({
    page,
    request,
  }) => {
    // Created with nothing marked (audience absent → all).
    const service = await createServiceWithTariffs(request, [
      { title: 'Взрослый', price: 3500, audience: 'all' },
      { title: 'Детский', price: 2000, audience: 'all' },
      { title: 'Индивидуальный', price: 5000, audience: 'all' },
    ]);

    try {
      await waitForServicesReady(page);
      // One page for everything — the factory title sorts last (services-
      // materials precedent).
      await page.getByTestId('page-size-select').selectOption('100');
      const row = page.locator('table tbody tr').filter({ hasText: service.title });
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      // ACTION: assign the groups via the per-row audience selects
      // (programmatic label «Возрастная группа: {tariff title}»).
      await dialog.getByLabel('Возрастная группа: Взрослый').selectOption('adult');
      await dialog.getByLabel('Возрастная группа: Детский').selectOption('kid');
      await dialog.getByLabel('Возрастная группа: Индивидуальный').selectOption('all');

      await dialog.getByText('Сохранить').click();
      await waitForToast(page, /обновл|сохран/i);

      // VERIFY API — the audiences persisted (PUT replaced the tariffs).
      const savedService = await (async () => {
        const resp = await request.get(`${BACKEND}/api/v1/services/${service.id}`);
        expect(resp.ok()).toBeTruthy();
        return (await resp.json()) as ServiceWithTariffs;
      })();
      const byTitle = new Map(savedService.tariffs.map((t) => [t.title, t.audience]));
      expect(byTitle.get('Взрослый')).toBe('adult');
      expect(byTitle.get('Детский')).toBe('kid');
      expect(byTitle.get('Индивидуальный')).toBe('all');

      // VERIFY UI — reopen the editor: the groups are on their places.
      const rowAfter = page.locator('table tbody tr').filter({ hasText: service.title });
      await expect(rowAfter).toBeVisible({ timeout: 10_000 });
      await rowAfter.click();
      const dialog2 = page.getByRole('dialog');
      await expect(dialog2).toBeVisible({ timeout: 10_000 });
      await expect(dialog2.getByLabel('Возрастная группа: Взрослый')).toHaveValue('adult');
      await expect(dialog2.getByLabel('Возрастная группа: Детский')).toHaveValue('kid');
      await expect(dialog2.getByLabel('Возрастная группа: Индивидуальный')).toHaveValue('all');
      await page.keyboard.press('Escape');
    } finally {
      await cleanup(request, `/api/v1/services/${service.id}`);
    }
  });
});

// ─── 8: two kid tariffs (canvases) ───────────────────────────────────────────

test.describe('Tariff age autofill — two kid tariffs (#284 scenario 8)', () => {
  test('S8: age 6 substitutes the FIRST kid; manual big rewrites price; 6→7 returns small', async ({
    page,
    request,
  }) => {
    const service = await createServiceWithTariffs(request, [
      { title: 'Детский малый', price: 1500, audience: 'kid' },
      { title: 'Детский большой', price: 2500, audience: 'kid' },
      { title: 'Взрослый', price: 3000, audience: 'adult' },
    ]);
    const small = service.tariffs[0];
    const big = service.tariffs[1];
    const setup = await setupRecord(request, service, [{ name: 'Основа', price: 3000 }]);

    try {
      // Age 6 in a new row substitutes «детский малый» (the FIRST kid).
      const draft = await openTabAndAddDraft(page, setup.recordId);
      await draft.name.fill('Художник');
      await draft.age.selectOption('6');
      await expect(draft.tariff).toHaveValue(small.id);
      await expect(draft.price).toHaveValue('1500');

      // Save → the row becomes a saved visit on «малый».
      await draft.name.press('Enter');
      const savedVisit = await waitForSecondVisit(request, setup.recordId, small.id);
      const visitId = savedVisit.id;

      const row = page.locator(`[data-testid="visit-row-${visitId}"]`);
      const tariff = row.locator(`[data-testid="visit-${visitId}-tariff"]`);

      // ACTION: the admin manually switches to «большой» — the price is
      // rewritten (the second kid axis is manual by design).
      await tariff.selectOption(big.id);
      await expect
        .poll(async () => {
          const visit = (await fetchVisits(request, setup.recordId)).find((v) => v.id === visitId);
          return visit?.tariff_id === big.id ? visit.price : null;
        }, { timeout: 15_000 })
        .toBe(2500);

      // ACTION: age 6→7 — the re-substitution returns «малый» (first kid),
      // clobbering the manual pick.
      await row.locator(`[data-testid="visit-${visitId}-age"]`).selectOption('7');
      await expect(tariff).toHaveValue(small.id, { timeout: 10_000 });
      await expect
        .poll(async () => {
          const visit = (await fetchVisits(request, setup.recordId)).find((v) => v.id === visitId);
          return visit?.tariff_id === small.id ? visit.price : null;
        }, { timeout: 15_000 })
        .toBe(1500);
    } finally {
      await setup.cleanupAll();
    }
  });
});
