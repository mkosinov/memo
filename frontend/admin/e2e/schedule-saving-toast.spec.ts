import { test, expect } from './fixtures/test';
import {
  waitForScheduleReady,
  delayActivityMutations,
} from './fixtures/helpers';
import { openCombobox } from './helpers/combobox';

/**
 * GH #261 — «Сохраняем…» loading toast in the common toast stack (spec §6).
 *
 * Five scenarios (S1–S5) covering the visibility lifecycle of the
 * `toast-loading` indicator during activity mutations on /schedule:
 *
 *   S1  create   → loading visible in flight, hidden after + «Создано: …»
 *   S2  update   → loading visible in flight, hidden after
 *   S3  overlap  → exactly ONE loading toast across two concurrent creates
 *   S4  500      → loading disappears, error toast appears, nothing hangs
 *   S5  delete   → loading in flight, then undo toast («удалено»)
 *
 * The delay helper (`delayActivityMutations`) holds non-GET activity API
 * requests for ~1.5 s, making the in-flight window deterministic.
 *
 * RED note (TDD, Task 3 of plan 2026-09-14-saving-toast): at this point the
 * `useSavingToast` hook does not exist yet — the «Сохраняем…» toast is never
 * shown, so every scenario below MUST fail on a `toast-loading` assertion.
 * Task 4 (hook) turns them GREEN.
 */

/** Open the create dialog by clicking an empty grid slot (GH #258/#259). */
async function openCreateDialog(page: import('@playwright/test').Page) {
  const emptySlot = page.locator('[data-testid="empty-slot"]').first();
  await expect(emptySlot).toBeVisible();
  try {
    await emptySlot.click({ timeout: 5_000 });
  } catch {
    // Slots live in DndContext (@dnd-kit) — the drag sensor may intercept
    // the pointer; a dispatched click still runs the same handler.
    await emptySlot.dispatchEvent('click');
  }
  const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Fill and submit the create dialog (first real option for each dict). */
async function submitCreateDialog(
  page: import('@playwright/test').Page,
  dialog: import('@playwright/test').Locator,
) {
  await dialog.getByTestId('create-master').selectOption({ index: 1 });
  await dialog.getByTestId('create-service').selectOption({ index: 1 });
  await dialog.getByTestId('create-location').selectOption({ index: 1 });
  await dialog.getByTestId('btn-create-activity').click();
}

/**
 * Make the stamp panel ready (master + service + first location) so empty
 * slot clicks create activities directly, without the dialog — the proven
 * pattern of schedule-empty-week.spec.ts S4.
 */
async function makeStampReady(page: import('@playwright/test').Page) {
  const rightPanel = page.locator('[data-testid="right-panel"]');
  if (!(await rightPanel.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Открыть панель инструментов' }).click();
  }

  // Master: Combobox inside the stamp master picker (index 0 is the pinned
  // clear option «Не выбран» — pick the first real option).
  const masterTrigger = page
    .getByTestId('stamp-master-picker')
    .getByTestId('combobox-trigger');
  await expect(masterTrigger).toBeVisible();
  await openCombobox(page, masterTrigger);
  await page
    .locator('[data-testid^="combobox-option-"]:not([data-testid="combobox-option-clear"])')
    .first()
    .click();

  // Service: Combobox labelled «Услуга» (first real option).
  const serviceTrigger = page.getByRole('button', { name: 'Услуга' });
  await expect(serviceTrigger).toBeVisible();
  await openCombobox(page, serviceTrigger);
  await page
    .locator('[data-testid^="combobox-option-"]:not([data-testid="combobox-option-clear"])')
    .first()
    .click();

  // Location: check the first checkbox in the stamp locations block.
  await rightPanel.locator('input[type="checkbox"]').first().check();

  await expect(page.getByTestId('stamp-summary')).toBeVisible();
}

test.describe('«Сохраняем…» toast during schedule mutations (GH #261)', () => {
  test.beforeEach(async ({ page }) => {
    await delayActivityMutations(page);
    await waitForScheduleReady(page);
  });

  // ── S1. Создание занятия ────────────────────────────────────────────────

  test('S1: create shows «Сохраняем…» in flight, then «Создано: …» toast', async ({
    page,
  }) => {
    const cardsBefore = await page.locator('[data-testid^="activity-"]').count();

    const dialog = await openCreateDialog(page);
    await submitCreateDialog(page, dialog);

    // In flight: the loading toast is visible in the common stack.
    await expect(page.getByTestId('toast-loading')).toBeVisible();

    // After the response: loading is gone, success toast appears.
    await expect(page.getByTestId('toast-loading')).toBeHidden();
    await expect(page.getByTestId('toast-info')).toContainText('Создано:');
    await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(
      cardsBefore + 1,
    );
  });

  // ── S2. Изменение занятия ───────────────────────────────────────────────

  test('S2: edit shows «Сохраняем…» in flight, hidden after the update', async ({
    page,
  }) => {
    // Open the first existing activity in edit mode: pull the card's activity
    // payload from its react props and dispatch __memo-open-modal — the same
    // event a real card click drives (openEditModal, WeekView.tsx:94).
    const firstCard = page.locator('[data-testid^="activity-"]').first();
    const activityId = (await firstCard.getAttribute('data-drag-id')) ?? '';
    expect(activityId).not.toBe('');

    const updateResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/activities/${activityId}`) &&
        r.request().method() === 'PATCH',
      { timeout: 15_000 },
    );

    const activity = await firstCard.evaluate((el: any) => {
      const k = Object.keys(el).find((x: string) => x.startsWith('__reactFiber'));
      if (!k) return null;
      let c = el[k];
      while (c) {
        if (c.memoizedProps?.activity) return c.memoizedProps.activity;
        c = c.return;
      }
      return null;
    });
    expect(activity).not.toBeNull();
    await page.evaluate((act: unknown) => {
      document.dispatchEvent(
        new CustomEvent('__memo-open-modal', { detail: { activity: act } }),
      );
    }, activity);

    const dialog = page.locator('[data-testid="activity-details-modal"]');
    await expect(dialog).toBeVisible();

    // Change capacity — SettingsTab auto-saves on change (onUpdate).
    const capacityInput = dialog.getByTestId('input-capacity');
    const current = await capacityInput.inputValue();
    await capacityInput.fill(current === '5' ? '6' : '5');

    // In flight: exactly one loading toast while the PATCH is pending.
    await expect(page.getByTestId('toast-loading')).toBeVisible();
    await updateResponse;

    // After the response: indicator withdrawn.
    await expect(page.getByTestId('toast-loading')).toBeHidden();
  });

  // ── S3. Параллельные операции ───────────────────────────────────────────

  test('S3: two overlapping creates keep exactly one loading toast', async ({
    page,
  }) => {
    // Both creates go through the stamp path (ready stamp + empty slot
    // click → direct POST, no dialog — schedule-empty-week.spec.ts S4).
    // The dialog path cannot overlap with itself: while create #1 is in
    // flight the dialog stays open with saving=true, so a second submit
    // would hit a disabled button instead of firing a second mutation.
    await makeStampReady(page);

    // Create #1 — POST held in the delay window.
    await page.locator('[data-testid="empty-slot"]').first().click();

    // Create #2 while #1 is still in flight — grid has not updated yet,
    // so the next slot is still rendered as empty-slot.
    const slots = page.locator('[data-testid="empty-slot"]');
    await expect(slots.nth(1)).toBeVisible();
    await slots.nth(1).click();

    // Throughout BOTH operations: exactly one loading toast (counter, not N).
    await expect(page.getByTestId('toast-loading')).toBeVisible();
    expect(await page.getByTestId('toast-loading').count()).toBe(1);

    // After both responses the single indicator is withdrawn.
    await expect(page.getByTestId('toast-loading')).toBeHidden({ timeout: 10_000 });
  });

  // ── S4. Ошибка сервера ──────────────────────────────────────────────────

  test('S4: 500 on create — loading withdrawn, error toast, nothing hangs', async ({
    page,
  }) => {
    // Override the mutation route for this test: POST → 500 (GET passes).
    // Routes are consulted LIFO, so this handler REPLACES beforeEach's
    // delay route for every matched request — the 1.5 s window therefore
    // lives HERE (a fallback chain back to the delay route would work too,
    // but an explicit sleep keeps the override self-contained).
    await page.route('**/api/v1/activities**', async (route) => {
      if (route.request().method() === 'POST') {
        // Deterministic in-flight window before the 500 lands.
        await new Promise((r) => setTimeout(r, 1500));
        return route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ detail: { code: 'INTERNAL', message: 'boom' } }),
        });
      }
      return route.continue();
    });

    const dialog = await openCreateDialog(page);
    await submitCreateDialog(page, dialog);

    // Loading appears…
    await expect(page.getByTestId('toast-loading')).toBeVisible();
    // …and is withdrawn on the failure (no hanging indicator).
    await expect(page.getByTestId('toast-loading')).toBeHidden();
    // An error toast explains the failure.
    await expect(page.getByTestId('toast-error')).toBeVisible();
    // Nothing lingers: no loading toast anywhere in the stack afterwards.
    await expect
      .poll(async () => page.getByTestId('toast-loading').count(), { timeout: 5_000 })
      .toBe(0);
  });

  // ── S5. Удаление с отменой ──────────────────────────────────────────────

  test('S5: delete shows «Сохраняем…», then undo toast «удалено»', async ({
    page,
  }) => {
    // Card-based deletion: enable «Режим удаления» in the right panel
    // (open through the FAB if collapsed), then click the card.
    const panel = page.locator('[data-testid="right-panel"]');
    if (!(await panel.isVisible().catch(() => false))) {
      const fab = page.getByRole('button', { name: 'Открыть панель инструментов' });
      await expect(fab).toBeVisible();
      await fab.click();
    }
    await page.getByRole('button', { name: 'Режим удаления' }).click();

    const firstCard = page.locator('[data-testid^="activity-"]').first();
    const activityId = (await firstCard.getAttribute('data-drag-id')) ?? '';
    expect(activityId).not.toBe('');

    const deleteResponse = page.waitForResponse(
      (r) =>
        r.url().includes(`/api/v1/activities/${activityId}`) &&
        r.request().method() === 'DELETE',
      { timeout: 15_000 },
    );
    await firstCard.click({ timeout: 5_000 }).catch(() =>
      firstCard.dispatchEvent('click'),
    );

    // In flight: loading toast visible during the DELETE.
    await expect(page.getByTestId('toast-loading')).toBeVisible();
    await deleteResponse;

    // After: loading hidden, then the sequential undo toast («удалено»).
    // Scoped to toast-info (the undo toast's kind) — the generic
    // `[data-testid^="toast-"]` prefix also matches `toast-container`
    // (GH #260 added the container testid).
    await expect(page.getByTestId('toast-loading')).toBeHidden();
    await expect(
      page.getByTestId('toast-info').filter({ hasText: 'удалено' }),
    ).toBeVisible();
  });
});
