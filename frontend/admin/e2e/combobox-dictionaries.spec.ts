import { test, expect } from './fixtures/test';
import type { Page, APIRequestContext } from '@playwright/test';
import {
  waitForRecordsReady,
  waitForClientsReady,
  waitForPhotosReady,
  waitForScheduleReady,
  openModal,
} from './fixtures/helpers';
import { openCombobox, searchAndSelect } from './helpers/combobox';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/**
 * E2E user scenarios US-1…US-6 (spec §10, GH #214 Task 12) — dictionary
 * Comboboxes on every migrated surface: record tab, settings tab, records
 * filter bar, photo modal, stamps panel, plus the no-match/Esc/query-reset
 * contract. Full Cycle: setup via factories → UI action → UI assert →
 * API/DB verify where it earns its keep → cleanup in finally.
 *
 * Requires: backend on :8000 (frontend via playwright webServer).
 */

// ── Seeded constants (backend/src/seed/seed.py — same ids the neighboring
// specs rely on; never hardcode what seed.py doesn't define) ────────────────

/** m2: Юлия Большакова — unique surname fragment «Больша». Label «Фамилия Имя». */
const MASTER_ID = 'm2';
const MASTER_LABEL = 'Большакова Юлия';
const MASTER_SURNAME_FRAGMENT = 'Больша';

/** s4: Акварель — the only seed service with max_age → range display «6–12». */
const SERVICE_ID = 's4';
const SERVICE_TITLE = 'Акварель';
const SERVICE_TITLE_FRAGMENT = 'Акв';
const SERVICE_AGE_DISPLAY = '6–12';

/** Location «Альпика» — fragment «Альп» is unique among seed locations. */
const LOCATION_ID = 'alpika';
const LOCATION_NAME = 'Альпика';
const LOCATION_NAME_FRAGMENT = 'Альп';

/** Unique name to avoid collisions between parallel runs (clients.spec.ts). */
function uid(): string {
  return `e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

/** Close the client card modal by clicking the backdrop at a corner.
 * Tolerant for `finally` use: skips silently when the modal is already gone
 * so a failing test's original error is never masked. */
async function closeByBackdrop(page: Page): Promise<void> {
  const modal = page.locator('[data-testid="client-card-modal"]');
  if (!(await modal.isVisible().catch(() => false))) return;
  const backdrop = page.locator('[data-testid="client-card-backdrop"]');
  await backdrop.click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
  await modal.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
}



/**
 * US-1/US-6 navigation (clients.spec.ts `setupRecordTab` conventions):
 * creates client + activity + record via the API, opens the client card and
 * clicks the record tab. Returns IDs for cleanup + the tab locator.
 */
async function setupRecordTab(page: Page, request: APIRequestContext) {
  const client = await createTestClient(request, { name: `Combobox US ${uid()}` });
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id);

  await waitForClientsReady(page, { waitForName: client.name });
  // Reload to pick up the newly created client (React Query may serve stale cache)
  // NOTE: default 'load' wait — 'networkidle' never resolves while the
  // SSE /api/v1/events stream stays open (#239).
  await page.reload();
  await waitForClientsReady(page, { waitForName: client.name });

  const row = page.locator('table tbody tr').filter({ hasText: client.name });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.click();

  const modal = page.locator('[data-testid="client-card-modal"]');
  await expect(modal).toBeVisible({ timeout: 5000 });

  // Record tab = second button of the left panel (first is the «Клиент» tab)
  const recordTabButton = modal.locator('[data-testid="client-card-left-panel"] button').nth(1);
  await expect(recordTabButton).toBeVisible({ timeout: 5000 });
  await recordTabButton.click();

  const tab = page.locator('[data-testid="client-record-tab"]');
  await tab.waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#record-date').waitFor({ state: 'visible', timeout: 10_000 });

  return { client, activity, record, tab };
}

test.describe('Combobox dictionary scenarios (US-1…US-6)', () => {
  // ── US-1: record tab — master found by surname fragment ─────────────────

  test('US-1: record tab master searchable by surname fragment', async ({ page, request }) => {
    const { client, record, tab } = await setupRecordTab(page, request);

    try {
      const masterTrigger = tab.locator(
        '[data-testid="select-master"] [data-testid="combobox-trigger"]',
      );
      await expect(masterTrigger).toBeVisible();

      // Type a surname fragment → only matching masters → select
      await searchAndSelect(page, masterTrigger, MASTER_SURNAME_FRAGMENT, MASTER_ID);

      // Trigger shows the selected master «Фамилия Имя»
      await expect(masterTrigger).toContainText(MASTER_LABEL);

      // Master change is not persisted by «Сохранить» (it patches the record
      // and the activity's date/service only) — the save flow must stay
      // unaffected: activate the button, click it, no error surfaces and the
      // record row is untouched in the DB.
      const saveBtn = tab.locator('[data-testid="btn-save-record"]');
      await expect(saveBtn).toBeEnabled();

      const saveResponse = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/records/${record.id}`) &&
          r.request().method() === 'PATCH',
        { timeout: 10_000 },
      );
      await saveBtn.click();
      expect((await saveResponse).ok()).toBeTruthy();

      const row = queryDBRow(`SELECT id FROM records WHERE id='${record.id}'`);
      expect(row).not.toBeNull();
    } finally {
      await closeByBackdrop(page);
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── US-2: activity settings — service by title fragment, age recalcs ────

  test('US-2: settings tab service searchable by title fragment; age display updates', async ({
    page,
    request,
  }) => {
    // Same convention as activity-details-modal.spec.ts: the schedule page
    // with activity cards must be loaded before the modal can open. Target
    // the seed record 'r1' explicitly — the untargeted scan picks the
    // smallest record id, and parallel specs' leaked factory records sort
    // before the seed ids and would steal the modal.
    await waitForScheduleReady(page);
    const activity = await openModal(page, { recordId: 'r1' });
    expect(activity).toBeTruthy();
    const activityId = (activity as { id: string }).id;

    // Read the original service so we can restore it after (avoid leaking a
    // seed mutation — same pattern as activity-details-modal.spec.ts test 4).
    const beforeRow = queryDBRow(`SELECT service_id FROM activities WHERE id='${activityId}'`);
    expect(beforeRow).not.toBeNull();
    const originalServiceId = beforeRow!.service_id as string;

    const serviceTrigger = page.locator(
      '[data-testid="select-service"] [data-testid="combobox-trigger"]',
    );
    await expect(serviceTrigger).toBeVisible();

    try {
      // Type a title fragment → select the Акварель service
      await searchAndSelect(page, serviceTrigger, SERVICE_TITLE_FRAGMENT, SERVICE_ID);

      // Trigger shows the selected service title
      await expect(serviceTrigger).toContainText(SERVICE_TITLE);

      // Age display recalcs to the selected service's range (s4: min 6, max 12)
      await expect(page.locator('[data-testid="age-display"]')).toHaveText(SERVICE_AGE_DISPLAY);

      // VERIFY DB — service_id committed via onUpdate → PATCH (poll until landed)
      await expect.poll(async () => {
        const afterRow = queryDBRow(`SELECT service_id FROM activities WHERE id='${activityId}'`);
        return afterRow?.service_id;
      }, { timeout: 30_000, intervals: [200, 500, 1000] }).toBe(SERVICE_ID);
    } finally {
      // Restore the original service so the seed activity is left untouched.
      const modalOpen = await page
        .locator('[data-testid="activity-details-modal"]')
        .isVisible()
        .catch(() => false);
      if (modalOpen && originalServiceId && originalServiceId !== SERVICE_ID) {
        const servicesResp = await request.get(`${BACKEND}/api/v1/services`);
        const servicesJson = await servicesResp.json();
        const services: Array<{ id: string; title: string }> =
          servicesJson.items || servicesJson;
        const origSvc = services.find((s) => s.id === originalServiceId);
        await searchAndSelect(page, serviceTrigger, origSvc?.title ?? '', originalServiceId);
      }
    }
  });

  // ── US-3: records filter bar — location + master (swatch), reset ────────

  test('US-3: records filters searchable; master option swatch; reset restores «Все …»', async ({
    page,
    request,
  }) => {
    // One waiting record keeps the filtered table non-empty
    const client = await createTestClient(request);
    const activity = await createTestActivity(request);
    const record = await createTestRecord(request, activity.id, client.id);

    try {
      await waitForRecordsReady(page);

      // Location filter via its aria-label (trigger)
      const locationFilterResponse = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes(`location_id=${LOCATION_ID}`),
        { timeout: 10_000 },
      );
      await searchAndSelect(page, page.getByLabel('Фильтр по локации'), LOCATION_NAME_FRAGMENT, LOCATION_ID);
      await locationFilterResponse;
      await expect(page.getByLabel('Фильтр по локации')).toContainText(LOCATION_NAME);

      // Master filter — open; option rows render the color swatch
      // (spec §5.3: `data-color` survives on every matching option row).
      const masterTrigger = page.getByLabel('Фильтр по мастеру');
      await openCombobox(page, masterTrigger);
      const swatch = page.locator(
        `[data-testid="combobox-option-${MASTER_ID}"] span[data-color]`,
      );
      await expect(swatch).toBeVisible();
      await expect(swatch).toHaveAttribute('data-color', '#6B7E9C'); // seed m2 color

      // Select the master by surname → server filters by master_id
      const masterFilterResponse = page.waitForResponse(
        (r) => r.url().includes('/api/v1/records') && r.url().includes(`master_id=${MASTER_ID}`),
        { timeout: 10_000 },
      );
      await page.locator('[data-testid="combobox-search"]').fill(MASTER_SURNAME_FRAGMENT);
      await page.locator(`[data-testid="combobox-option-${MASTER_ID}"]`).click();
      await masterFilterResponse;
      await expect(masterTrigger).toContainText(MASTER_LABEL);

      // Reset restores every dictionary filter to its «Все …» clear label
      await page.locator('button:has-text("Сбросить")').click();
      await expect(page.getByLabel('Фильтр по локации')).toHaveText(/Все локации/);
      await expect(page.getByLabel('Фильтр по мастеру')).toHaveText(/Все мастера/);
    } finally {
      await cleanupRecord(request, record.id);
      await cleanup(request, `/api/v1/clients/${client.id}`);
    }
  });

  // ── US-4: photo modal — location searchable, persisted ──────────────────

  test('US-4: photo modal location searchable; saved photo carries the location', async ({
    page,
    request,
  }) => {
    const filename = `/images/e2e-us4-${Date.now()}.jpg`;
    let photoId: string | null = null;

    try {
      await waitForPhotosReady(page);
      await page.click('text=+ Добавить фото');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();

      // Single owner = location (4-owner model allows exactly one)
      await dialog.getByPlaceholder('photo-001.jpg').fill(filename);
      await searchAndSelect(page, dialog.getByLabel('Локация'), LOCATION_NAME_FRAGMENT, LOCATION_ID);

      // Trigger shows the selected location inside the dialog
      await expect(dialog.getByLabel('Локация')).toContainText(LOCATION_NAME);

      const created = page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/photos') && resp.request().method() === 'POST',
        { timeout: 15_000 },
      );
      await dialog.getByText('Сохранить').click();
      const createdResp = await created;
      expect(createdResp.status()).toBe(201);
      const createdBody = (await createdResp.json()) as { id: string; location_id: string | null };
      photoId = createdBody.id;

      // VERIFY DB — the location persisted
      expect(createdBody.location_id).toBe(LOCATION_ID);
      const dbRow = queryDBRow(`SELECT location_id FROM photos WHERE id='${photoId}'`);
      expect(dbRow?.location_id).toBe(LOCATION_ID);

      // Table cell resolves the location name (locationsMap via /all)
      const photoRow = page.locator(`[data-testid="photo-row-${photoId}"]`);
      await expect(photoRow).toBeVisible({ timeout: 10_000 });
      await expect(photoRow).toContainText(LOCATION_NAME);
    } finally {
      if (photoId) await cleanup(request, `/api/v1/photos/${photoId}`);
    }
  });

  // ── US-5: stamps panel — master by surname ──────────────────────────────

  test('US-5: stamps panel master searchable by surname («Фамилия Имя»)', async ({ page }) => {
    await page.goto('/schedule');
    await page.waitForSelector('[data-testid^="activity-"]', { timeout: 15_000 });

    // Right panel starts collapsed → open it via the StampFab
    const panel = page.locator('[data-testid="right-panel"]');
    if (!(await panel.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'Открыть панель инструментов' }).click();
    }

    const masterTrigger = page.locator(
      '[data-testid="stamp-master-picker"] [data-testid="combobox-trigger"]',
    );
    await expect(masterTrigger).toBeVisible();

    await searchAndSelect(page, masterTrigger, MASTER_SURNAME_FRAGMENT, MASTER_ID);
    await expect(masterTrigger).toContainText(MASTER_LABEL);
  });

  // ── US-6: empty state + Esc preserves value + reopen clears query ───────

  test('US-6: no-match «Ничего не найдено», Esc keeps value, reopen clears query', async ({
    page,
  }) => {
    // Spec §10 allows any surface for this contract. The records filter bar
    // master Combobox exercises the identical open/search/Esc/reopen path
    // without a host modal — ClientCardModal listens for Esc at document
    // level and closes the whole card regardless of the Combobox's
    // stopPropagation (delegated listeners attach at the same node, so only
    // stopImmediatePropagation could block them). No data is created here —
    // the contract assertions never touch table rows.
    await waitForRecordsReady(page);

    const masterTrigger = page.getByLabel('Фильтр по мастеру');

    // 1. Select a master by surname (US-1-style search+select)
    await searchAndSelect(page, masterTrigger, MASTER_SURNAME_FRAGMENT, MASTER_ID);
    await expect(masterTrigger).toContainText(MASTER_LABEL);

    // 2. Reopen → type a query with no matches → empty state row
    await openCombobox(page, masterTrigger);
    await page.locator('[data-testid="combobox-search"]').fill('zzzz');
    const emptyRow = page.locator('[data-testid="combobox-empty"]');
    await expect(emptyRow).toBeVisible();
    await expect(emptyRow).toContainText('Ничего не найдено');
    // Clear option stays pinned even with zero matches
    await expect(page.locator('[data-testid="combobox-option-clear"]')).toBeVisible();

    // 3. Esc inside the search input — dropdown closes, value intact,
    //    focus returns to the trigger (spec §5.2)
    await page.locator('[data-testid="combobox-search"]').press('Escape');
    await expect(page.locator('[data-testid="combobox-dropdown"]')).toBeHidden();
    await expect(masterTrigger).toContainText(MASTER_LABEL);
    await expect(masterTrigger).toBeFocused();

    // 4. Reopen → query cleared, full list back
    await openCombobox(page, masterTrigger);
    await expect(page.locator('[data-testid="combobox-search"]')).toHaveValue('');
    await expect(page.locator(`[data-testid="combobox-option-${MASTER_ID}"]`)).toBeVisible();

    // Close again — the selection survives the close
    await page.locator('[data-testid="combobox-search"]').press('Escape');
    await expect(page.locator('[data-testid="combobox-dropdown"]')).toBeHidden();
    await expect(masterTrigger).toContainText(MASTER_LABEL);
  });
});
