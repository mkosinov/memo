import { test, expect } from '@playwright/test';

/**
 * S6 — web client derives materials from service links (GH #223 spec §9).
 *
 * Data (seeded test DB + service_materials rows):
 * - s7 «Морской пейзаж» links: Акварель (note: NULL) + Масло (note: «Масляные краски для морского пейзажа»).
 *   Materials ordered by title ASC → first = «Акварель».
 * - s2 «Картина акрилом» has NO links → NO materials block at all.
 */

const DAY_WITH_LINKED_SERVICE = '10'; // Sept 10 — ev_40, s7 «Морской пейзаж»

async function openDay(page: import('@playwright/test').Page, dayNumber: string) {
  await page.goto('/');
  await expect(
    page.locator('[data-testid="activity-card"]:not([data-card-id="custom-booking"]):not([data-card-id="empty-background-card"])').first(),
  ).toBeVisible({ timeout: 20000 });
  // Calendar day buttons contain a <span> with the bare day number (CalendarLine.tsx)
  await page.locator('button span', { hasText: new RegExp(`^${dayNumber}$`) }).first().click();
  await expect(page.getByRole('heading', { name: 'Морской пейзаж' })).toBeVisible({ timeout: 20000 });
}

test.describe('S6 — materials from links', () => {
  test('linked service: chip = first material title, details = note ?? description', async ({ page }) => {
    await openDay(page, DAY_WITH_LINKED_SERVICE);

    // Tap the card → ActivityDetail
    await page.locator('[data-testid="activity-card"] h3', { hasText: 'Морской пейзаж' }).click();

    const panel = page.locator('[data-testid="overlay-panel"]');
    const materialBlock = panel.locator('[data-testid="material-block"]');
    await expect(materialBlock).toBeVisible();

    // Chip = FIRST linked material title (Акварель sorts before Масло)
    await expect(materialBlock).toContainText('Акварель');

    // Details popup: hint trigger for the chip → click → popup with both lines
    await materialBlock.getByRole('button', { name: 'Подробнее о Акварель' }).click();
    const popup = materialBlock.locator('span[role="button"] > span').last();
    await expect(popup).toContainText('требуют специальной бумаги'); // Акварель description (note is NULL → fallback)
    await expect(popup).toContainText('Масляные краски для морского пейзажа'); // Масло note (overrides description)
  });

  test('service without linked materials renders NO materials block', async ({ page }) => {
    await page.goto('/');
    await expect(
      page.locator('[data-testid="activity-card"]:not([data-card-id="custom-booking"]):not([data-card-id="empty-background-card"])').first(),
    ).toBeVisible({ timeout: 20000 });

    // Today (default) — s2 «Картина акрилом», no material links
    await page.locator('[data-testid="activity-card"] h3', { hasText: 'Картина акрилом' }).click();

    const panel = page.locator('[data-testid="overlay-panel"]');
    await expect(panel).toBeVisible();

    // The guard is the point: the materials block (label + chip) is absent entirely
    await expect(panel.locator('[data-testid="material-block"]')).toHaveCount(0);
    await expect(panel.getByText('Материал', { exact: true })).toHaveCount(0);

    // The rest of the row still renders
    await expect(panel.getByText('Стоимость', { exact: true })).toBeVisible();
  });

  test('private booking form prefills «Материал» with first material title and stays editable', async ({ page }) => {
    await openDay(page, DAY_WITH_LINKED_SERVICE);

    // View the linked service (sets the client's last-viewed material)
    await page.locator('[data-testid="activity-card"] h3', { hasText: 'Морской пейзаж' }).click();
    const panel = page.locator('[data-testid="overlay-panel"]');
    await expect(panel.locator('[data-testid="material-block"]')).toContainText('Акварель');

    // Close the detail and wait for the overlay to fully unmount (exit animation)
    await page.locator('[aria-label="Close overlay"]').click();
    await expect(panel).toHaveCount(0);
    await expect(page.locator('[data-testid="overlay-backdrop"]')).toHaveCount(0);

    // Switch to an empty day (beyond seeded data, Sept 16) — the custom
    // «individual MK» card becomes the top of the swipe stack and is directly tappable
    await page.locator('button span', { hasText: /^16$/ }).first().click();
    const customCard = page.locator('[data-card-id="custom-booking"]');
    await expect(customCard).toBeVisible();
    await customCard.getByRole('button', { name: 'Записаться' }).click();

    // The «Материал» label is not programmatically associated with its select;
    // it is the first combobox on the page (before the contact-form one).
    const materialSelect = page.getByRole('combobox').first();

    // Prefill = first linked material title, then still editable (client input)
    await expect(materialSelect).toHaveValue('Акварель');
    await materialSelect.selectOption('Масло');
    await expect(materialSelect).toHaveValue('Масло');
  });
});
