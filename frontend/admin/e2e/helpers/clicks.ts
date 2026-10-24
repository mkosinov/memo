import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Schedule-grid click helpers (#562) — the duplicated slot/card click
 * mechanics lifted from file-local copies across the admin e2e specs.
 *
 * Grid elements swallow plain pointer clicks for two known reasons: slots
 * live in DndContext (@dnd-kit — the drag sensor may intercept the pointer)
 * and the WeekView carousel may demote overlapping cards to
 * pointer-events:none. In both cases a dispatched click reaches the same
 * React handler — so every grid click goes through `clickWithFallback`
 * (a plain 5 s click with the dispatched fallback), which lives HERE, once.
 *
 * Testids/ARIA in play:
 *   - empty slot:  [data-testid="empty-slot"] (first one = the click target)
 *   - create form: dialog role with aria-label «Новое занятие»
 *   - activity card: [data-testid="activity-{id}"]
 *   - quick-add (+) button on a card: [data-testid="btn-quick-add"]
 *
 * Heavier open-flows with their own waits (records response + modal) stay in
 * fixtures/helpers.ts (`clickActivityCard`, `openAddTab`) — these helpers are
 * the light click mechanics, not their replacement.
 */

/**
 * Click with the dnd-kit fallback: a plain click (5 s), and when the drag
 * sensor swallows it, a dispatched click on the same locator.
 */
export async function clickWithFallback(locator: Locator): Promise<void> {
  try {
    await locator.click({ timeout: 5_000 });
  } catch {
    await locator.dispatchEvent('click');
  }
}

/**
 * Click an empty grid slot. `slot` defaults to the first empty slot;
 * pass an explicit locator for column-specific slots. Does not wait for
 * the create dialog — for that use `openCreateDialog`.
 */
export async function clickEmptySlot(page: Page, slot?: Locator): Promise<void> {
  await clickWithFallback(slot ?? page.locator('[data-testid="empty-slot"]').first());
}

/**
 * Click the first empty slot → the create-activity dialog («Новое занятие»)
 * opens. Returns the dialog locator.
 */
export async function openCreateDialog(page: Page): Promise<Locator> {
  const emptySlot = page.locator('[data-testid="empty-slot"]').first();
  await expect(emptySlot).toBeVisible();
  await clickWithFallback(emptySlot);
  const dialog = page.getByRole('dialog', { name: 'Новое занятие' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Click the activity card with the given id. Returns the card locator.
 * No waits beyond the click itself — modal flows belong to the caller
 * (or to the heavier `clickActivityCard` in fixtures/helpers.ts).
 */
export async function clickCard(page: Page, activityId: string): Promise<Locator> {
  const card = page.locator(`[data-testid="activity-${activityId}"]`);
  await clickWithFallback(card);
  return card;
}

/**
 * Click the quick-add (+) button on an activity card — opens the modal in
 * quickAdd mode (new-record tab active).
 */
export async function clickQuickAdd(card: Locator): Promise<void> {
  await clickWithFallback(card.locator('[data-testid="btn-quick-add"]'));
}
