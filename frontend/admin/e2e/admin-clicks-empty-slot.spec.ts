import { test, expect } from './fixtures/test';
import { waitForScheduleReady } from './fixtures/helpers';

/**
 * US-S01 (GH #258/#259, spec §5): Admin clicks an empty slot on a regular
 * week → the create-activity dialog «Новое занятие» opens with the slot
 * prefill → picks master/service/location → «Создать» → dialog closes and
 * the activity card count grows by 1.
 */
test('US-S01: Admin can click empty slot to create activity', async ({
  page,
}) => {
  // ARRANGE: on /schedule with the seeded week rendered
  await waitForScheduleReady(page);

  const cardsBefore = await page.locator('[data-testid^="activity-"]').count();

  // ACT: click an empty time slot.
  // Slots live in DndContext (@dnd-kit) — prefer a real click, but fall
  // back to dispatchEvent if the drag sensor intercepts the pointer.
  const emptySlot = page.locator('[data-testid="empty-slot"]').first();
  await expect(emptySlot).toBeVisible();
  await test.step('click empty slot', async () => {
    try {
      await emptySlot.click({ timeout: 5_000 });
    } catch {
      await emptySlot.dispatchEvent('click');
    }
  });

  // ASSERT: the create-activity dialog is open (semantic, web-first —
  // no .catch per spec §6).
  const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
  await expect(dialog).toBeVisible();

  // Fill master/service/location with the first real option each.
  await test.step('fill create form and submit', async () => {
    await dialog.getByTestId('create-master').selectOption({ index: 1 });
    await dialog.getByTestId('create-service').selectOption({ index: 1 });
    await dialog.getByTestId('create-location').selectOption({ index: 1 });

    await dialog.getByTestId('btn-create-activity').click();
    await expect(dialog).toBeHidden();

    // Card appeared in the grid.
    await expect(page.locator('[data-testid^="activity-"]')).toHaveCount(
      cardsBefore + 1,
    );
  });
});
