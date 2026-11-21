import { test, expect } from './fixtures/test';
import { gotoScheduleWeek, clickActivityCard, closeModal } from './fixtures/helpers';
import { openCreateDialog } from './helpers/clicks';
import { pickComboboxOption, openCombobox } from './helpers/combobox';
import { hallTitleWithDefault, locationCheckByTitle } from './helpers/location-group';
import { createTestLocation, createTestActivity, cleanup } from './fixtures/factories';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

/**
 * GH #551 (design §User Scenarios + §E2E) — вместимость 0–99:
 * 0 = «запись закрыта» у занятий, 0 = «не задана» у локаций.
 *
 *   US-1  create with an explicit 0 → the card reads «Запись закрыта · 0»
 *         (the web half of US-1 — the client-side refusal — lives in
 *         frontend/web/e2e/booking-closed-activity.spec.ts).
 *   US-2  edit 0 → 12 → instant patch, the card flips to «0/12».
 *   US-3  an EMPTY capacity field blocks «Создать» (empty never sends 0).
 *   US-5  location modal bounds: 0 and 99 save, 100 → «Максимум: 99».
 *   US-7  a grid stamp on a capacity-0 hall creates the closed activity
 *         WITH the loud toast («… запись закрыта (у зала «X» не задана
 *         вместимость)»), rev.4 вариант C.
 *
 * US-6 is the existing multi-location-create.spec.ts (stays green, no
 * edits); US-4 has no e2e by spec (pytest + vitest cover the bounds).
 *
 * Navigation deep-links to the 2099-01-05 week — no seed data ever lands
 * there, so the week window (2099-01-04..10) isolates every DB assert.
 * State purity: the per-test seed reset (#252) restores canonical state;
 * grid-created activities self-heal, the factory halls are cleaned in
 * `finally` (dictionaries survive the reset only until the NEXT test).
 */

/** Empty week far in the future — the only activities there are ours. */
const EMPTY_WEEK_DATE = '2099-01-05';
/** The whole open week window (Mon..Sun of 2099-01-05) for DB asserts. */
const WEEK_WINDOW = `substr(start,1,10) BETWEEN '2099-01-04' AND '2099-01-10'`;

test.describe('GH #551 — вместимость 0–99 (0 = «запись закрыта»)', () => {
  test('US-1: явный 0 при создании — карточка «Запись закрыта · 0», в БД вместимость 0', async ({
    page,
  }) => {
    await gotoScheduleWeek(page, EMPTY_WEEK_DATE);
    const dialog = await openCreateDialog(page);

    // Fill the form: master + service + one hall WITH a default (its value
    // lands in the field first — the explicit 0 must be a deliberate edit).
    await pickComboboxOption(page, 'create-master');
    await pickComboboxOption(page, 'create-service');
    const hallTitle = hallTitleWithDefault();
    await locationCheckByTitle(dialog, hallTitle).check();
    await expect(dialog.getByTestId('create-capacity')).not.toHaveValue('');

    // ACT: clear the autofill and type an explicit 0 — «Создать» stays
    // enabled (0 is a legal deliberate value, GH #551 supersedes #280 «min 1»).
    await dialog.getByTestId('create-capacity').fill('0');
    await expect(dialog.getByTestId('btn-create-activity')).toBeEnabled();
    await dialog.getByTestId('btn-create-activity').click();
    await expect(dialog).toBeHidden();

    // ASSERT UI: the card carries the closed-enrollment label (N = occupied).
    const card = page.locator('[data-testid^="activity-"]').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('Запись закрыта · 0');

    // VERIFY DB: exactly our activity on the empty week, capacity 0.
    const rows = queryDBRows(
      `SELECT capacity FROM activities WHERE ${WEEK_WINDOW}`,
    ) as Array<{ capacity: number }>;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].capacity)).toBe(0);
  });

  test('US-2: правка 0 → 12 мгновенным патчем — карточка «0/12», в БД 12', async ({
    page,
    request,
  }) => {
    // SETUP: a closed activity on the empty week via the API factory.
    const activity = await createTestActivity(request, {
      start: `${EMPTY_WEEK_DATE}T10:00:00`,
      capacity: 0,
    });
    try {
      await gotoScheduleWeek(page, EMPTY_WEEK_DATE);
      const card = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(card).toBeVisible();
      await expect(card).toContainText('Запись закрыта · 0');

      // ACT: open the details modal (settings tab is the default in edit
      // mode) and retype the capacity — the instant-patch convention.
      await clickActivityCard(page, card);
      const modal = page.locator('[data-testid="activity-details-modal"]');
      await expect(modal).toBeVisible();
      const patchLanded = page.waitForResponse(
        (r) =>
          r.url().includes(`/api/v1/activities/${activity.id}`) &&
          r.request().method() === 'PATCH',
      );
      await modal.getByTestId('input-capacity').fill('12');
      const patch = await patchLanded;
      expect(patch.status()).toBe(200);

      // VERIFY DB: the patch persisted 12.
      const row = queryDBRow(
        `SELECT capacity FROM activities WHERE id='${activity.id}'`,
      )!;
      expect(Number(row.capacity)).toBe(12);

      // ASSERT UI: the card flipped to the regular «occupied/capacity» label.
      await closeModal(page);
      await expect(card).toContainText('0/12');
    } finally {
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });

  test('US-3: пустое поле вместимости блокирует «Создать» — ни POST, ни строки в БД', async ({
    page,
  }) => {
    await gotoScheduleWeek(page, EMPTY_WEEK_DATE);
    const dialog = await openCreateDialog(page);

    await pickComboboxOption(page, 'create-master');
    await pickComboboxOption(page, 'create-service');
    const hallTitle = hallTitleWithDefault();
    await locationCheckByTitle(dialog, hallTitle).check();

    // Discriminator: with the hall default autofilled the button is live —
    // the ONLY thing that can block below is the emptied capacity field.
    await expect(dialog.getByTestId('btn-create-activity')).toBeEnabled();

    // ACT: empty the field — blocked, and the field STAYS empty (an
    // autopinned 0 must not appear — the #280 invariant).
    await dialog.getByTestId('create-capacity').fill('');
    await expect(dialog.getByTestId('create-capacity')).toHaveValue('');
    await expect(dialog.getByTestId('btn-create-activity')).toBeDisabled();

    // ASSERT: no create request ever fired (flight counter)…
    let createPosts = 0;
    page.on('request', (r) => {
      if (
        new URL(r.url()).pathname.endsWith('/api/v1/activities') &&
        r.method() === 'POST'
      ) {
        createPosts++;
      }
    });
    await dialog.getByTestId('btn-create-activity').click({ force: true });
    await expect(dialog).toBeVisible(); // form still open
    expect(createPosts).toBe(0);

    // …and the DB agrees — nothing was created on the empty week.
    const rows = queryDBRows(
      `SELECT id FROM activities WHERE ${WEEK_WINDOW}`,
    );
    expect(rows).toHaveLength(0);
  });

  test('US-5: модалка локации — 0 и 99 сохраняются, 100 даёт «Максимум: 99»', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const titleZero = `e2e 551 зал ноль ${stamp}`;
    const titleMax = `e2e 551 зал девяносто девять ${stamp}`;
    const titleBad = `e2e 551 зал сто ${stamp}`;
    const createdIds: string[] = [];

    /** id of a location row by its unique title (null = absent). */
    const idByTitle = (title: string): string | null => {
      const row = queryDBRow(
        `SELECT id FROM locations WHERE title='${title.replace(/'/g, "''")}'`,
      );
      return row ? String(row.id) : null;
    };

    /**
     * The created location row, waited into existence: the create POST's
     * row can land in the WAL a beat after the response (FastAPI commits
     * in the get_db_session teardown AFTER the 201) — a one-shot read
     * races the commit. Positive retrying poll (class-1 wait).
     */
    const waitForLocationRow = async (
      title: string,
    ): Promise<{ id: string; capacity: number }> => {
      const safe = title.replace(/'/g, "''");
      const deadline = Date.now() + 10_000;
      for (;;) {
        const row = queryDBRow(
          `SELECT id, capacity FROM locations WHERE title='${safe}'`,
        );
        if (row) {
          return { id: String(row.id), capacity: Number(row.capacity) };
        }
        if (Date.now() > deadline) {
          throw new Error(`location "${title}" never appeared in the DB`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    /** Open the create modal, fill title+capacity, click «Сохранить». */
    const saveWithTitleAndCapacity = async (title: string, capacity: string) => {
      await page.getByText('+ Добавить локацию').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Новая локация')).toBeVisible();
      // Exact regex: «Название» alone — a substring match would also hit
      // the «Короткое название» field (required fields carry a trailing *).
      await dialog.getByLabel(/^Название\s*\*?$/).fill(title);
      await dialog.getByLabel('Вместимость').fill(capacity);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      return dialog;
    };

    try {
      await page.goto('/locations');
      await page.waitForSelector('h1:has-text("Управление локациями")', {
        timeout: 60_000,
      });

      // ACT/ASSERT: 0 («не задана») is legal — saved, toast, row in DB
      // (the toast is the UI signal; the DB row is the settle for the
      // next step — it is read through the retrying positive wait).
      await saveWithTitleAndCapacity(titleZero, '0');
      await expect(page.getByTestId('toast-info')).toContainText(
        'Локация создана',
      );
      const zeroRow = await waitForLocationRow(titleZero);
      createdIds.push(zeroRow.id);
      expect(zeroRow.capacity).toBe(0);

      // ACT/ASSERT: the upper bound 99 is legal too.
      await saveWithTitleAndCapacity(titleMax, '99');
      const maxRow = await waitForLocationRow(titleMax);
      createdIds.push(maxRow.id);
      expect(maxRow.capacity).toBe(99);

      // ACT: 100 is blocked by the FIELD config — «Максимум: 99» under the
      // capacity input, modal stays open, no row is created.
      const dialog = await saveWithTitleAndCapacity(titleBad, '100');
      await expect(dialog.getByText('Максимум: 99')).toBeVisible();
      await expect(dialog).toBeVisible();
      expect(idByTitle(titleBad)).toBeNull();
    } finally {
      for (const id of createdIds) {
        await cleanup(request, `/api/v1/locations/${id}`);
      }
    }
  });

  test('US-7: штамп на зал с вместимостью 0 — занятие закрыто, громкий тост называет причину', async ({
    page,
    request,
  }) => {
    // SETUP: the capacity-0 hall must exist BEFORE navigation (the page's
    // directory fetch runs once per load — a later factory row would miss
    // the stamp panel render).
    const hall = await createTestLocation(request, { capacity: 0 });
    try {
      await gotoScheduleWeek(page, EMPTY_WEEK_DATE);

      // Open the toolbar (stamp panel) if it starts collapsed.
      const rightPanel = page.locator('[data-testid="right-panel"]');
      if (!(await rightPanel.isVisible().catch(() => false))) {
        await page
          .getByRole('button', { name: 'Открыть панель инструментов' })
          .click();
      }

      // Master: Combobox inside the stamp master picker (first real option;
      // index 0 is the pinned clear option «Не выбран»).
      const masterTrigger = page
        .getByTestId('stamp-master-picker')
        .getByTestId('combobox-trigger');
      await expect(masterTrigger).toBeVisible();
      await openCombobox(page, masterTrigger);
      await page
        .locator(
          '[data-testid^="combobox-option-"]:not([data-testid="combobox-option-clear"])',
        )
        .first()
        .click();

      // Service: Combobox labelled «Услуга» (first real option).
      const serviceTrigger = page.getByRole('button', { name: 'Услуга' });
      await expect(serviceTrigger).toBeVisible();
      await openCombobox(page, serviceTrigger);
      await page
        .locator(
          '[data-testid^="combobox-option-"]:not([data-testid="combobox-option-clear"])',
        )
        .first()
        .click();

      // Location: check ONLY the capacity-0 factory hall — the stamp copies
      // `defaultCapacity ?? 0` from the FIRST checked hall (вариант C).
      const hallCheckbox = rightPanel
        .locator('label')
        .filter({ hasText: hall.title })
        .locator('input[type="checkbox"]');
      await hallCheckbox.check();
      await expect(page.getByTestId('stamp-summary')).toBeVisible();

      // ACT: click an empty slot — creation without the dialog (stamp path).
      const emptySlot = page.locator('[data-testid="empty-slot"]').first();
      await expect(emptySlot).toBeVisible();
      await emptySlot.click();

      // ASSERT: the LOUD toast names the closed enrollment AND the hall
      // (rev.4: no silent «Создано» when copying a 0).
      const toast = page.getByTestId('toast-info');
      await expect(toast).toContainText('Создано:');
      await expect(toast).toContainText('запись закрыта');
      await expect(toast).toContainText('не задана вместимость');
      await expect(toast).toContainText(hall.title);

      // …the card is closed («Запись закрыта · 0»)…
      const card = page.locator('[data-testid^="activity-"]').first();
      await expect(card).toBeVisible();
      await expect(card).toContainText('Запись закрыта · 0');
      // …and no dialog opened (stamp path, not the create modal).
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // VERIFY DB: the stamped activity carries capacity 0 for our hall.
      const row = queryDBRow(
        `SELECT capacity, location_id FROM activities WHERE ${WEEK_WINDOW}`,
      )!;
      expect(row).not.toBeNull();
      expect(Number(row.capacity)).toBe(0);
      expect(row.location_id).toBe(hall.id);
    } finally {
      await cleanup(request, `/api/v1/locations/${hall.id}`);
    }
  });
});
