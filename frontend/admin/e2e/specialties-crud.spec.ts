import { test, expect } from './fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';
import {
  clickRowDelete,
  commitDeleteWait,
  confirmDeleteDialog,
  openRowActionDropdown,
  trackBodyDeletes,
  undoToast,
  waitForStaffReady,
  waitForSpecialtiesReady,
  waitForToast,
  withUndoWindow,
} from './fixtures/helpers';
import {
  cleanupArchivableSubject,
  cleanupFamilySubject,
} from './fixtures/factories';
import { queryDBRow, queryDBRows } from './fixtures/db-query';
import { resolveBackendUrl } from './lib/backend-url';

/**
 * GH #599 spec §7 — specialties dictionary E2E, scenarios 3/4/5a/5b/5c
 * (scenarios 1–2 are Task 9's service/staff spec extensions; the tags-crud
 * + positions-deferred-delete templates own this file's shape).
 *
 *  · §7.3 — /services carries the third view tab «Направления»
 *    (data-testid="specialties-tab" — the VC check) → create via the
 *    dictionary modal; the SAME title in another case → 409
 *    SPECIALTY_TITLE_TAKEN surfaces as the error toast (the create
 *    handler's toast-only error surface closes the modal); the fresh
 *    title reaches the service form's dictionary select (/specialties/all).
 *  · §7.4 — rename: the new title shows in the specialties row AND in
 *    both consumer tables (services «Направление» cell, staff row).
 *  · §7.5a — service-held row: dry-run 409 with the blocking `services`
 *    node → DeleteDialog Mode B «Нельзя удалить: есть 1 услуга.»,
 *    acknowledgment-only (no delete/archive buttons — BLOCKED_NO_ARCHIVE),
 *    row survives, nothing is ever enqueued.
 *  · §7.5b — staff-held row: lone auto-cascade `staff_specialties` node →
 *    Mode A counter line «Сотрудники: 1 (потеряют направление)» (no
 *    checkbox — auto-only tree) → confirm → optimistic removal + 5s undo
 *    ring → commit DELETE `{resolutions: {}, expected: {}}` (items stay
 *    null on specialty trees, auto deps never verify) → join rows die,
 *    the staff card survives.
 *  · §7.5c — free row: dry-run 204 → no dialog, optimistic removal +
 *    undo ring → commit DELETE `{expected: {}}` → hard-deleted.
 *
 * Full Cycle per test: SETUP via inline API factories → UI action → UI
 * asserts → DB asserts (SQLite) → cleanup in finally. The shared
 * createTestService/createTestStaff(master) factories still carry the
 * pre-#599 wire shapes (Task 9 owns their migration), so service/staff
 * dependencies are created inline with the specialty_id/specialty_ids
 * contracts (spec §4.3/§4.4) — the positions-deferred-delete precedent
 * of posting the subject straight through `request`.
 */

const BACKEND = resolveBackendUrl();

// ── Inline API factories (spec §4 contracts; see the file header) ──────────

interface SpecialtyApiView {
  id: string;
  title: string;
}

interface ServiceApiView {
  id: string;
  title: string;
  specialty: string;
}

interface StaffApiView {
  id: string;
  first_name: string;
  last_name: string;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

async function createSpecialtyViaApi(
  request: APIRequestContext,
  title: string,
): Promise<SpecialtyApiView> {
  const resp = await request.post(`${BACKEND}/api/v1/specialties`, {
    data: { title },
  });
  expect(resp.status(), 'createSpecialtyViaApi: POST /specialties').toBe(201);
  return (await resp.json()) as SpecialtyApiView;
}

async function createServiceWithSpecialty(
  request: APIRequestContext,
  specialtyId: string,
): Promise<ServiceApiView> {
  const resp = await request.post(`${BACKEND}/api/v1/services`, {
    data: {
      title: `Услуга ${uid()}`,
      description: 'e2e #599 specialties-crud',
      image_url: '',
      specialty_id: specialtyId,
      min_age: 5,
      max_age: null,
      duration: 90,
      record_info: 'e2e #599',
      tariffs: [],
      tag_ids: [],
    },
  });
  expect(resp.status(), 'createServiceWithSpecialty: POST /services').toBe(201);
  return (await resp.json()) as ServiceApiView;
}

async function createStaffWithSpecialties(
  request: APIRequestContext,
  specialtyIds: string[],
): Promise<StaffApiView> {
  const resp = await request.post(`${BACKEND}/api/v1/staff`, {
    data: {
      first_name: 'Тест',
      last_name: `Специалистов ${uid()}`,
      avatar_url: '',
      sort_order: 999,
      // D5: a live master section carries a non-empty specialty set (§4.4).
      master: { specialty_ids: specialtyIds, color: '#5B8C7A' },
      position_ids: [],
      create_user: false,
    },
  });
  expect(resp.status(), 'createStaffWithSpecialties: POST /staff').toBe(201);
  return (await resp.json()) as StaffApiView;
}

// ── Shared wait/parse helpers ───────────────────────────────────────────────

/** The dry-run preview listener: DELETE ?dry_run=true with the expected
 *  status (204 free row / 409 busy row with the dependency tree). */
function dryRunDeleteWait(page: Page, specialtyId: string, status: number) {
  return page.waitForResponse(
    (resp) =>
      resp.url().includes(`/api/v1/specialties/${specialtyId}`) &&
      resp.url().includes('dry_run=true') &&
      resp.status() === status,
    { timeout: 20_000 },
  );
}

/** A 409 dependency node as serialized by the delete-family fork. */
interface DepNode {
  entity: string;
  relation: string;
  count: number;
  allowed_actions: string[];
  auto?: boolean;
  items?: Array<{ id: string; label: string }> | null;
}

async function dryRunDeps(resp: { json: () => Promise<unknown> }): Promise<DepNode[]> {
  const body = (await resp.json()) as { dependencies?: DepNode[] };
  return body.dependencies ?? [];
}

test.describe('Specialties dictionary (GH #599 §7 scenarios 3–5)', () => {
  // ── §7.3: create + case-insensitive duplicate + dropdown reach ───────────

  test('§7.3: «Направления» tab (VC) → create via modal; same title in another case → 409 toast; new title reaches the service-form dropdown', async ({
    page,
    request,
  }) => {
    // Three UI phases (dictionary create, duplicate, service-form dropdown)
    // on a cold dev-server compile — the services-crud 120s precedent.
    test.setTimeout(120_000);
    let specialty: SpecialtyApiView | undefined;

    try {
      // 1. SETUP — /services loaded; the VC check rides here: the view
      // switcher carries THREE buttons and «Направления» is the
      // data-testid="specialties-tab" one (spec «Visual Compliance Checks»).
      const servicesLoaded = page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/services') && resp.status() === 200,
        { timeout: 60_000 },
      );
      await page.goto('/services');
      await page.waitForSelector('h1:has-text("Управление услугами")', {
        timeout: 60_000,
      });
      await servicesLoaded.catch(() => {});

      const tabButton = page.locator('[data-testid="specialties-tab"]');
      await expect(tabButton).toBeVisible();
      await expect(tabButton).toHaveText('Направления');
      const switcher = tabButton.locator('..');
      await expect(
        switcher.getByRole('button', { name: 'Услуги', exact: true }),
      ).toBeVisible();
      await expect(
        switcher.getByRole('button', { name: 'Материалы', exact: true }),
      ).toBeVisible();

      // 2. ACTION — switch to the dictionary view, create via the modal.
      const specialtiesLoaded = page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/v1/specialties') &&
          resp.request().method() === 'GET' &&
          resp.status() === 200,
        { timeout: 60_000 },
      );
      await tabButton.click();
      await page.waitForSelector('h1:has-text("Управление направлениями")', {
        timeout: 15_000,
      });
      await page.waitForSelector('table', { timeout: 60_000 });
      await specialtiesLoaded.catch(() => {});

      const title = `E2e Направление ${uid()}`;
      const createdWait = page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/v1/specialties') &&
          resp.request().method() === 'POST' &&
          resp.status() === 201,
      );
      await page
        .getByRole('button', { name: '+ Добавить направление' })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Новое направление')).toBeVisible();
      await dialog.getByLabel('Название').fill(title);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      specialty = (await (await createdWait).json()) as SpecialtyApiView;
      expect(specialty.title).toBe(title);

      // 3. VERIFY UI — toast + the fresh row.
      await waitForToast(page, 'Направление создано');
      const row = page.locator(
        `[data-testid="specialty-row-${specialty.id}"]`,
      );
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toContainText(title);

      // 4. ACTION — the SAME title in ANOTHER CASE: the case-insensitive
      // uniqueness (functional index lower(title), §2.2) fires 409
      // SPECIALTY_TITLE_TAKEN — the authoritative server-side verdict.
      await page
        .getByRole('button', { name: '+ Добавить направление' })
        .click();
      await expect(dialog).toBeVisible();
      const dupWait = page.waitForResponse(
        (resp) =>
          resp.url().includes('/api/v1/specialties') &&
          resp.request().method() === 'POST' &&
          resp.status() === 409,
      );
      await dialog.getByLabel('Название').fill(title.toLowerCase());
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const dupResp = await dupWait;
      const dupBody = (await dupResp.json()) as {
        detail?: { code?: string };
      };
      expect(dupBody.detail?.code).toBe('SPECIALTY_TITLE_TAKEN');

      // VERIFY UI — the mapped error toast. The create handler swallows
      // the mutation error (toast-only surface), so the modal's onClose
      // runs and the dialog closes — pin that: the error is what §7.3
      // requires, not a stay-open modal.
      await expect(page.getByTestId('toast-error')).toContainText(
        'Направление с таким названием уже существует',
      );
      await expect(dialog).toHaveCount(0);

      // Still exactly ONE row for the case-family.
      await expect(
        page.locator('table tbody tr').filter({ hasText: title }),
      ).toHaveCount(1);

      // 5. ACTION — the new direction appears in the SERVICE form's
      // dictionary select (the /specialties/all consumer, §5).
      const servicesReload = page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/services') && resp.status() === 200,
        { timeout: 60_000 },
      );
      await switcher
        .getByRole('button', { name: 'Услуги', exact: true })
        .click();
      await page.waitForSelector('h1:has-text("Управление услугами")', {
        timeout: 15_000,
      });
      await servicesReload.catch(() => {});

      await page.getByRole('button', { name: '+ Добавить услугу' }).click();
      const serviceDialog = page.getByRole('dialog');
      await expect(serviceDialog).toBeVisible({ timeout: 10_000 });
      await expect(serviceDialog.getByText('Новая услуга')).toBeVisible();
      const select = serviceDialog.locator(
        '[data-testid="service-specialty-select"]',
      );
      await expect(select).toBeVisible();
      await expect(
        select.locator(`[data-testid="specialty-option-${specialty.id}"]`),
      ).toHaveText(title);
      page.once('dialog', (d) => void d.accept());
      await serviceDialog.getByRole('button', { name: 'Отмена' }).click();
      await expect(serviceDialog).toHaveCount(0);

      // 6. VERIFY DB — exactly one row for the case-family. NOTE: a
      // `WHERE lower(title) = lower(?)` CLI read is UNRELIABLE here — the
      // backend venv writes with a newer SQLite (3.47) than the sqlite3
      // CLI binary (3.40), whose view of the functional index
      // ux_specialties_lower_title silently misses backend-written rows
      // (the backend's own 409 precheck above sees the true index). A
      // full-scan titles fetch + a JS case-fold compare is index-free.
      const titles = queryDBRows('SELECT title FROM specialties').map((r) =>
        String(r.title).toLowerCase(),
      );
      expect(titles.filter((t) => t === title.toLowerCase())).toHaveLength(1);
    } finally {
      // 7. CLEANUP — free row by now (the service form was never saved).
      if (specialty) {
        await cleanupFamilySubject(
          request,
          `/api/v1/specialties/${specialty.id}`,
        );
      }
    }
  });

  // ── §7.4: rename propagates to both consumer tables ─────────────────────

  test('§7.4: rename — new title in the specialties row, the services table and the staff table', async ({
    page,
    request,
  }) => {
    const before = `E2e До ${uid()}`;
    const after = `E2e После ${uid()}`;
    const specialty = await createSpecialtyViaApi(request, before);
    const service = await createServiceWithSpecialty(request, specialty.id);
    const staff = await createStaffWithSpecialties(request, [specialty.id]);
    expect(
      queryDBRows(
        `SELECT * FROM staff_specialties WHERE specialty_id='${specialty.id}'`,
      ),
    ).toHaveLength(1);

    try {
      await waitForSpecialtiesReady(page);
      const row = page.locator(
        `[data-testid="specialty-row-${specialty.id}"]`,
      );
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — row click opens the rename modal (tags/positions
      // precedent); PATCH carries the title only.
      await row.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 5_000 });
      await expect(
        dialog.getByText('Редактирование направления'),
      ).toBeVisible();
      await expect(dialog.getByLabel('Название')).toHaveValue(before);

      const patchWait = page.waitForResponse(
        (resp) =>
          resp.url().includes(`/api/v1/specialties/${specialty.id}`) &&
          resp.request().method() === 'PATCH' &&
          resp.status() === 200,
      );
      await dialog.getByLabel('Название').fill(after);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const patched = await patchWait;
      expect(((await patched.json()) as SpecialtyApiView).title).toBe(after);

      // 3. VERIFY UI — toast + the row shows the new title.
      await waitForToast(page, 'Направление обновлено');
      await expect(row).toContainText(after);
      await expect(row).not.toContainText(before);

      // 4. VERIFY — the services table's «Специализация» cell follows.
      // The column ships hidden (defaultVisible: false — plan §5 keeps the
      // table columns unchanged), so flip it on through the column picker
      // first (the services-crud spec precedent).
      const servicesReload = page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/services') && resp.status() === 200,
        { timeout: 60_000 },
      );
      await page.goto('/services');
      await page.waitForSelector('h1:has-text("Управление услугами")', {
        timeout: 60_000,
      });
      await servicesReload.catch(() => {});
      await page.click('[aria-label="Настроить колонки"]');
      await expect(page.getByText('Специализация').first()).toBeVisible();
      await page.getByText('Специализация').first().click();
      await page.keyboard.press('Escape');
      const serviceRow = page
        .locator('table tbody tr')
        .filter({ hasText: service.title });
      await expect(serviceRow).toHaveCount(1);
      await expect(serviceRow).toContainText(after);

      // VERIFY API — ServiceView.specialty is the renamed display string.
      const serviceResp = await request.get(
        `${BACKEND}/api/v1/services/${service.id}`,
      );
      expect(serviceResp.status()).toBe(200);
      expect(((await serviceResp.json()) as ServiceApiView).specialty).toBe(
        after,
      );

      // 5. VERIFY — the staff table row follows (joined display string).
      await waitForStaffReady(page);
      const staffRow = page.locator(
        `[data-testid="master-row-${staff.id}"]`,
      );
      await expect(staffRow).toBeVisible({ timeout: 10_000 });
      await expect(staffRow).toContainText(after);

      // 6. VERIFY DB — the link itself is untouched by the rename.
      expect(
        queryDBRows(
          `SELECT * FROM staff_specialties WHERE specialty_id='${specialty.id}' AND staff_id='${staff.id}'`,
        ),
      ).toHaveLength(1);
    } finally {
      // 7. CLEANUP — staff first (keeps its master section), then the
      // service, then the now-free specialty.
      await cleanupArchivableSubject(request, `/api/v1/staff/${staff.id}`);
      await cleanupArchivableSubject(
        request,
        `/api/v1/services/${service.id}`,
      );
      await cleanupFamilySubject(
        request,
        `/api/v1/specialties/${specialty.id}`,
      );
    }
  });

  // ── §7.5a: blocked by a linked service ──────────────────────────────────

  test('§7.5a: service-held direction — dry-run 409 «Услуги: 1» tree, acknowledgment-only dialog, row stays', async ({
    page,
    request,
  }) => {
    const specialty = await createSpecialtyViaApi(
      request,
      `E2e Блок ${uid()}`,
    );
    const service = await createServiceWithSpecialty(request, specialty.id);

    try {
      await waitForSpecialtiesReady(page);
      const row = page.locator(
        `[data-testid="specialty-row-${specialty.id}"]`,
      );
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — the row delete fires the pure dry-run preview → 409.
      const dryRunPromise = dryRunDeleteWait(page, specialty.id, 409);
      const commits = trackBodyDeletes(
        page,
        '/api/v1/specialties',
        specialty.id,
      );
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;

      // 3. VERIFY — the tree: the lone BLOCKING services node (allowed_
      // actions [] — services may not live without a direction, FK
      // RESTRICT; archived rows would count too, §4.2).
      const deps = await dryRunDeps(dryRun);
      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        entity: 'services',
        relation: 'Услуга',
        count: 1,
        allowed_actions: [],
      });

      // VERIFY UI — the BLOCKED no-archive dialog: «Услуги: N» count line
      // + the backend way-out hint; NO delete and NO archive buttons.
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId('delete-dialog-block-message')).toHaveText(
        'Нельзя удалить: есть 1 услуга.',
      );
      await expect(page.getByTestId('delete-dialog-block-hint')).toContainText(
        'Переназначьте услуги',
      );
      await expect(
        page.locator('[data-testid="delete-dialog-confirm-btn"]'),
      ).toHaveCount(0);
      await expect(
        page.locator('[data-testid="delete-dialog-archive-btn"]'),
      ).toHaveCount(0);

      // «Понятно» closes; the row survives; nothing was ever enqueued.
      await page.getByTestId('delete-dialog-ack-btn').click();
      await expect(dialog).toHaveCount(0);
      await expect(row).toBeVisible();
      expect(commits.bodyDeletes).toEqual([]);

      // 4. VERIFY DB — both rows untouched.
      expect(
        queryDBRow(
          `SELECT title FROM specialties WHERE id='${specialty.id}'`,
      ),
      ).not.toBeNull();
      expect(
        queryDBRow(
          `SELECT specialty_id FROM services WHERE id='${service.id}'`,
        ),
      ).toMatchObject({ specialty_id: specialty.id });
    } finally {
      // 5. CLEANUP — free the specialty by removing the service first.
      await cleanupArchivableSubject(
        request,
        `/api/v1/services/${service.id}`,
      );
      await cleanupFamilySubject(
        request,
        `/api/v1/specialties/${specialty.id}`,
      );
    }
  });

  // ── §7.5b: staff-held → auto-cascade, staff cards survive ───────────────

  test('§7.5b: staff-held direction — «потеряют направление» counter, cascade commit strips the link, staff card survives', async ({
    page,
    request,
  }) => {
    const title = `E2e Каскад ${uid()}`;
    const specialty = await createSpecialtyViaApi(request, title);
    const staff = await createStaffWithSpecialties(request, [specialty.id]);
    expect(
      queryDBRows(
        `SELECT * FROM staff_specialties WHERE specialty_id='${specialty.id}'`,
      ),
    ).toHaveLength(1);

    try {
      await waitForSpecialtiesReady(page);
      const row = page.locator(
        `[data-testid="specialty-row-${specialty.id}"]`,
      );
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — dry-run → 409 with the staff tree.
      const dryRunPromise = dryRunDeleteWait(page, specialty.id, 409);
      const dropdown = await openRowActionDropdown(row);
      await clickRowDelete(dropdown);
      const dryRun = await dryRunPromise;

      // 3. VERIFY — the lone AUTO-cascade node; specialty trees carry NO
      // items (the §5 boundary) — the counter line is the information.
      const deps = await dryRunDeps(dryRun);
      expect(deps).toHaveLength(1);
      expect(deps[0]).toMatchObject({
        entity: 'staff_specialties',
        relation: 'Сотрудник',
        count: 1,
        allowed_actions: ['cascade'],
        auto: true,
      });
      expect(deps[0].items ?? null).toBeNull();

      // VERIFY UI — Mode A: the surviving-parent wording; NO checkbox
      // (auto-only trees confirm immediately).
      const dialog = page.locator('[data-testid="delete-dialog"]');
      await expect(dialog).toBeVisible();
      await expect(
        page.locator('[data-testid="dep-staff_specialties"]'),
      ).toContainText('Сотрудники: 1 (потеряют направление)');
      await expect(
        page.locator('[data-testid="delete-dialog-confirm-checkbox"]'),
      ).toHaveCount(0);

      // 4. ACTION — confirm enqueues the deferred commit; the 5s window
      // runs under the paused page clock (#417) — commitDeleteWait is
      // registered BEFORE the window-creating click (helper contract).
      const commitWait = commitDeleteWait(
        page,
        '/api/v1/specialties',
        specialty.id,
      );
      await withUndoWindow(page, async () => {
        await confirmDeleteDialog(page);
        await expect(dialog).toHaveCount(0);
        // #417: release the frozen notifyManager batch so the optimistic
        // row removal renders.
        await page.clock.fastForward(1);
        await expect(row).not.toBeVisible();
        const toast = undoToast(page);
        await expect(toast).toBeVisible();
        await expect(toast.getByTestId('toast-countdown')).toBeVisible();
      });
      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      // All-auto tree → empty resolutions + empty expected (items are
      // null on specialty trees; auto deps never join the verification).
      expect(JSON.parse(commit.request().postData() ?? '{}')).toEqual({
        resolutions: {},
        expected: {},
      });

      // 5. VERIFY DB — specialty gone, join rows stripped, card intact.
      expect(
        queryDBRow(
          `SELECT id FROM specialties WHERE id='${specialty.id}'`,
        ),
      ).toBeNull();
      expect(
        queryDBRows(
          `SELECT * FROM staff_specialties WHERE specialty_id='${specialty.id}'`,
        ),
      ).toHaveLength(0);
      expect(
        queryDBRow(`SELECT id FROM staff WHERE id='${staff.id}'`),
      ).not.toBeNull();

      // 6. VERIFY UI — the staff card survived WITHOUT the direction.
      await waitForStaffReady(page);
      const staffRow = page.locator(
        `[data-testid="master-row-${staff.id}"]`,
      );
      await expect(staffRow).toBeVisible({ timeout: 10_000 });
      await expect(staffRow).not.toContainText(title);
    } finally {
      // 7. CLEANUP — the specialty is already gone; sweep the staff card.
      await cleanupArchivableSubject(request, `/api/v1/staff/${staff.id}`);
      await cleanupFamilySubject(
        request,
        `/api/v1/specialties/${specialty.id}`,
      );
    }
  });

  // ── §7.5c: free row → clean deferred delete ─────────────────────────────

  test('§7.5c: free direction — dry-run 204, no dialog, undo ring, leaf commit {expected: {}}', async ({
    page,
    request,
  }) => {
    const specialty = await createSpecialtyViaApi(
      request,
      `E2e Лист ${uid()}`,
    );

    try {
      await waitForSpecialtiesReady(page);
      const row = page.locator(
        `[data-testid="specialty-row-${specialty.id}"]`,
      );
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — the row delete dry-runs clean (204): NO dialog, the
      // optimistic removal + the 5s undo ring; the commit DELETE carries
      // the leaf body {expected: {}} after the window. Both listeners are
      // registered BEFORE the window-creating click (helper contract).
      const dryRunPromise = dryRunDeleteWait(page, specialty.id, 204);
      const commitWait = commitDeleteWait(
        page,
        '/api/v1/specialties',
        specialty.id,
      );
      await withUndoWindow(page, async () => {
        const dropdown = await openRowActionDropdown(row);
        await clickRowDelete(dropdown);
        expect((await dryRunPromise).status()).toBe(204);
        await page.clock.fastForward(1);
        await expect(row).not.toBeVisible();
        const toast = undoToast(page);
        await expect(toast).toBeVisible();
        await expect(toast.getByTestId('toast-countdown')).toBeVisible();
        // A leaf delete never opens any dialog.
        await expect(
          page.locator('[data-testid="delete-dialog"]'),
        ).toHaveCount(0);
      });
      const commit = await commitWait;
      expect(commit.status()).toBe(204);
      expect(JSON.parse(commit.request().postData() ?? '{}')).toEqual({
        expected: {},
      });

      // 3. VERIFY DB — hard-deleted.
      expect(
        queryDBRow(
          `SELECT id FROM specialties WHERE id='${specialty.id}'`,
        ),
      ).toBeNull();
    } finally {
      // 4. CLEANUP — 404-safe no-op if the commit already landed.
      await cleanupFamilySubject(
        request,
        `/api/v1/specialties/${specialty.id}`,
      );
    }
  });
});
