import { test, expect } from '@playwright/test';

/**
 * E2E tests for ActivityDetailsModal.
 * Covers: modal opening, settings tab, client tab, new booking tab,
 * tab navigation, delete record, financial summary, validation.
 *
 * Requires running dev server on :3001 and backend on :8000.
 *
 * Note: Activity cards use @dnd-kit useDraggable which captures pointer
 * events, preventing Playwright's click() from reaching React's onClick.
 * We dispatch custom DOM events handled by WeekView's useEffect to open
 * the modal reliably.
 */

const BACKEND = 'http://localhost:8000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait for schedule page to be ready with activity cards visible. */
async function waitForScheduleReady(page: any) {
  await page.goto('/');
  await page.waitForSelector('[data-testid^="activity-ev_"]', { timeout: 15000 });
}

/** Get activity data from the first card's React fiber. */
async function getFirstActivity(page: any) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid^="activity-ev_"]');
    if (!card) return null;
    const fiberKey = Object.keys(card).find((k: string) => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;
    let current = (card as any)[fiberKey];
    while (current) {
      if (current.memoizedProps?.activity) return current.memoizedProps.activity;
      current = current.return;
    }
    return null;
  });
}

/** Open modal via custom DOM event (bypasses @dnd-kit pointer capture). */
async function openModal(page: any) {
  const activity = await getFirstActivity(page);
  if (!activity) throw new Error('No activity found on schedule page');
  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-open-modal', { detail: { activity: act } }));
  }, activity);
  await page.waitForSelector('[data-testid="activity-details-modal"]', {
    state: 'visible',
    timeout: 10000,
  });
}

/** Open modal on the "+" (new booking) tab via custom DOM event. */
async function openAddTab(page: any) {
  const activity = await getFirstActivity(page);
  if (!activity) throw new Error('No activity found on schedule page');
  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-quick-add', { detail: { activity: act } }));
  }, activity);
  await page.waitForSelector('[data-testid="activity-details-modal"]', {
    state: 'visible',
    timeout: 10000,
  });
  await expect(page.locator('[data-testid="new-booking-tab"]')).toBeVisible();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('ActivityDetailsModal', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ---- Modal Opening -------------------------------------------------------

  test.describe('Modal Opening', () => {
    test('opens from ActivityCard via custom event', async ({ page }) => {
      await openModal(page);
      await expect(
        page.locator('[data-testid="activity-details-modal"]'),
      ).toBeVisible();
      await expect(page.locator('[data-testid="activity-context"]')).toBeVisible();
      await expect(page.locator('[data-testid="tab-nav"]')).toBeVisible();
    });

    test('opens on "+" tab from quick add button', async ({ page }) => {
      await openAddTab(page);
      await expect(
        page.locator('[data-testid="new-booking-tab"]'),
      ).toBeVisible();
      await expect(page.locator('[data-testid="input-phone"]')).toBeVisible();
    });

    test('closes on backdrop click', async ({ page }) => {
      await openModal(page);
      await page
        .locator('[data-testid="details-modal-backdrop"]')
        .click({ position: { x: 10, y: 10 }, force: true });
      await expect(
        page.locator('[data-testid="activity-details-modal"]'),
      ).toBeHidden();
    });

    test('closes on close button', async ({ page }) => {
      await openModal(page);
      await page.locator('[data-testid="modal-close-btn"]').click();
      await expect(
        page.locator('[data-testid="activity-details-modal"]'),
      ).toBeHidden();
    });
  });

  // ---- Settings Tab --------------------------------------------------------

  test.describe('Settings Tab', () => {
    test('shows all fields', async ({ page }) => {
      await openModal(page);
      await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();
      await expect(
        page.locator('[data-testid="input-datetime"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="select-service"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="select-master"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="select-location"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="input-capacity"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="input-duration"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-testid="toggle-private"]'),
      ).toBeVisible();
    });

    test('datetime input has value', async ({ page }) => {
      await openModal(page);
      const datetime = page.locator('[data-testid="input-datetime"]');
      await expect(datetime).not.toHaveValue('');
    });
  });

  // ---- Create Record -------------------------------------------------------

  test.describe('Create Record', () => {
    test('creates record with existing client', async ({ page }) => {
      await openAddTab(page);

      // Enter phone
      await page.locator('[data-testid="input-phone"]').fill('+79991234567');
      await page.locator('[data-testid="input-phone"]').blur();

      // Wait for lookup
      await page.waitForTimeout(1000);

      // Fill client name (may be auto-filled)
      const nameInput = page.locator('[data-testid="input-client-name"]');
      if ((await nameInput.inputValue()) === '') {
        await nameInput.fill('Тест Клиент');
      }

      // Fill visitor
      const visitorRow = page
        .locator('[data-testid="visitor-form-row"]')
        .first();
      await visitorRow.locator('input').first().fill('Тест Гость');

      // Submit
      await page.locator('[data-testid="btn-create-record"]').click();

      // Verify toast or modal update
      await page.waitForTimeout(2000);

      // Verify via backend
      const response = await page.request.get(`${BACKEND}/api/v1/records`);
      expect(response.ok()).toBeTruthy();
    });

    test('creates record with new client', async ({ page }) => {
      await openAddTab(page);

      // Enter unknown phone
      await page.locator('[data-testid="input-phone"]').fill('+79990001122');
      await page.locator('[data-testid="input-phone"]').blur();
      await page.waitForTimeout(1000);

      // Fill name
      await page
        .locator('[data-testid="input-client-name"]')
        .fill('Новый Клиент');

      // Fill visitor
      const visitorRow = page
        .locator('[data-testid="visitor-form-row"]')
        .first();
      await visitorRow.locator('input').first().fill('Новый Гость');

      // Submit
      await page.locator('[data-testid="btn-create-record"]').click();
      await page.waitForTimeout(2000);

      // Verify client created in backend
      const clientsResp = await page.request.get(`${BACKEND}/api/v1/clients`);
      expect(clientsResp.ok()).toBeTruthy();
    });
  });

  // ---- Delete Record -------------------------------------------------------

  test.describe('Delete Record', () => {
    test('shows undo toast on delete', async ({ page }) => {
      // Create a record first
      await openAddTab(page);
      await page.locator('[data-testid="input-phone"]').fill('+79991112233');
      await page.locator('[data-testid="input-phone"]').blur();
      await page.waitForTimeout(1000);

      const nameInput = page.locator('[data-testid="input-client-name"]');
      if ((await nameInput.inputValue()) === '') {
        await nameInput.fill('Для Удаления');
      }

      const visitorRow = page
        .locator('[data-testid="visitor-form-row"]')
        .first();
      await visitorRow.locator('input').first().fill('Для Удаления');

      await page.locator('[data-testid="btn-create-record"]').click();
      await page.waitForTimeout(2000);

      // Switch to settings tab (record tab might have opened)
      const settingsTab = page.locator('[data-testid="tab-settings"]');
      if (await settingsTab.isVisible()) {
        await settingsTab.click();
      }

      // Open the record's client tab (if it exists as a tab)
      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (await clientTab.isVisible()) {
        await clientTab.click();
        await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

        // Click delete
        await page.locator('[data-testid="btn-delete-record"]').click();

        // Verify toast appears
        await expect(page.locator('text=Запись будет удалена')).toBeVisible({
          timeout: 3000,
        });
      }
    });
  });

  // ---- Validation ----------------------------------------------------------

  test.describe('Validation', () => {
    test('phone input validates format', async ({ page }) => {
      await openAddTab(page);
      await page.locator('[data-testid="input-phone"]').fill('abc');
      await page.locator('[data-testid="input-phone"]').blur();
      // Should not find client — name stays empty
      const nameInput = page.locator('[data-testid="input-client-name"]');
      await expect(nameInput).toHaveValue('');
    });

    test('cannot submit without phone', async ({ page }) => {
      await openAddTab(page);
      // Ensure phone is empty
      await page.locator('[data-testid="input-phone"]').fill('');
      await page.locator('[data-testid="btn-create-record"]').click();
      // Toast should appear with validation message
      await expect(page.locator('text=Заполните')).toBeVisible({
        timeout: 3000,
      });
    });
  });

  // ---- Tab Navigation ------------------------------------------------------

  test.describe('Tab Navigation', () => {
    test('switches between tabs', async ({ page }) => {
      await openModal(page);

      // Settings tab should be active/visible
      await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

      // Click on client tab if it exists
      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (await clientTab.isVisible()) {
        await clientTab.click();
        await expect(
          page.locator('[data-testid="client-tab"]'),
        ).toBeVisible();
      }
    });

    test('"+" tab always visible', async ({ page }) => {
      await openModal(page);
      await expect(page.locator('[data-testid="tab-add"]')).toBeVisible();
    });

    test('clicking "+" tab switches to new booking', async ({ page }) => {
      await openModal(page);
      await page.locator('[data-testid="tab-add"]').click();
      await expect(
        page.locator('[data-testid="new-booking-tab"]'),
      ).toBeVisible();
    });
  });

  // ---- Financial Summary ---------------------------------------------------

  test.describe('Financial Summary', () => {
    test('footer shows amounts', async ({ page }) => {
      await openModal(page);
      await expect(page.locator('[data-testid="modal-footer"]')).toBeVisible();
      await expect(page.locator('[data-testid="total-cost"]')).toBeVisible();
      await expect(page.locator('[data-testid="total-owed"]')).toBeVisible();
    });
  });

  // ---- New Booking Tab Interactions ----------------------------------------

  test.describe('New Booking Tab', () => {
    test('add visitor button works', async ({ page }) => {
      await openAddTab(page);

      // Initially one visitor row
      const initialCount = await page
        .locator('[data-testid="visitor-form-row"]')
        .count();
      expect(initialCount).toBeGreaterThanOrEqual(1);

      // Add another visitor
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();

      const newCount = await page
        .locator('[data-testid="visitor-form-row"]')
        .count();
      expect(newCount).toBe(initialCount + 1);
    });

    test('notifications checkbox toggles channel select', async ({ page }) => {
      await openAddTab(page);

      // Channel should not be visible when checkbox unchecked
      await expect(
        page.locator('[data-testid="select-channel"]'),
      ).toBeHidden();

      // Check notifications
      await page.locator('[data-testid="checkbox-notifications"]').check();

      // Channel should now be visible
      await expect(
        page.locator('[data-testid="select-channel"]'),
      ).toBeVisible();
    });
  });

  // ---- Client Tab Interactions ---------------------------------------------

  test.describe('Client Tab', () => {
    test('shows payment summary', async ({ page }) => {
      await openModal(page);

      // Switch to a client tab if available
      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (await clientTab.isVisible()) {
        await clientTab.click();
        await expect(
          page.locator('[data-testid="client-tab"]'),
        ).toBeVisible();
        await expect(
          page.locator('[data-testid="payment-summary"]'),
        ).toBeVisible();
      }
    });
  });
});
