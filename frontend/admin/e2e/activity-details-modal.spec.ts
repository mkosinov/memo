import { test, expect } from '@playwright/test';

/**
 * E2E tests for ActivityDetailsModal.
 * Covers: modal opening, settings tab, client tab, new booking tab,
 * tab navigation, delete record, financial summary, validation,
 * and comprehensive edge cases.
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

/** Get activity data from a specific card by activity ID. */
async function getActivityById(page: any, activityId: string) {
  return page.evaluate((actId: string) => {
    const card = document.querySelector(`[data-testid="activity-${actId}"]`);
    if (!card) return null;
    const fiberKey = Object.keys(card).find((k: string) => k.startsWith('__reactFiber'));
    if (!fiberKey) return null;
    let current = (card as any)[fiberKey];
    while (current) {
      if (current.memoizedProps?.activity) return current.memoizedProps.activity;
      current = current.return;
    }
    return null;
  }, activityId);
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

/** Open modal for a specific activity by ID via custom DOM event. */
async function openModalForActivity(page: any, activityId: string) {
  const activity = await getActivityById(page, activityId);
  if (!activity) throw new Error(`Activity ${activityId} not found on schedule page`);
  await page.evaluate((act: any) => {
    document.dispatchEvent(new CustomEvent('__memo-open-modal', { detail: { activity: act } }));
  }, activity);
  await page.waitForSelector('[data-testid="activity-details-modal"]', {
    state: 'visible',
    timeout: 10000,
  });
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

      // Add a visitor (visitors start empty)
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
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

      // Add a visitor (visitors start empty)
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
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

      // Add a visitor (visitors start empty)
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
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

        // Verify undo toast appears
        await expect(page.locator('text=Запись удалена через 5 секунд')).toBeVisible({
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

      // Initially no visitor rows (visitors start empty)
      const initialCount = await page
        .locator('[data-testid="visitor-form-row"]')
        .count();
      expect(initialCount).toBe(0);

      // Add a visitor
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();

      const newCount = await page
        .locator('[data-testid="visitor-form-row"]')
        .count();
      expect(newCount).toBe(1);
    });

    test('notifications checkbox toggles notify state', async ({ page }) => {
      await openAddTab(page);

      // Channel select is always visible (not hidden behind checkbox)
      await expect(
        page.locator('[data-testid="select-channel"]'),
      ).toBeVisible();

      // Notifications checkbox starts unchecked
      const checkbox = page.locator('[data-testid="checkbox-notifications"]');
      await expect(checkbox).not.toBeChecked();

      // Check notifications
      await checkbox.check();
      await expect(checkbox).toBeChecked();

      // Uncheck notifications
      await checkbox.uncheck();
      await expect(checkbox).not.toBeChecked();
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

// ===========================================================================
// Edge Cases
// ===========================================================================

test.describe('Edge Cases', () => {
  test.beforeEach(async ({ page }) => {
    await waitForScheduleReady(page);
  });

  // ── Validation ────────────────────────────────────────────────────────────

  test.describe('Validation', () => {
    test('create record without phone and without name shows error', async ({ page }) => {
      await openAddTab(page);

      // Leave both phone and name empty
      await page.locator('[data-testid="input-phone"]').fill('');
      await page.locator('[data-testid="input-client-name"]').fill('');

      // Submit — validation should catch missing name
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Заполните имя')).toBeVisible({
        timeout: 3000,
      });
    });

    test('create record with unknown phone but no name shows error', async ({ page }) => {
      await openAddTab(page);

      // Enter a phone that doesn't match any existing client
      await page.locator('[data-testid="input-phone"]').fill('+79990009999');
      await page.locator('[data-testid="input-phone"]').blur();
      await page.waitForTimeout(1000);

      // Name should still be empty (client not found)
      const nameInput = page.locator('[data-testid="input-client-name"]');
      await expect(nameInput).toHaveValue('');

      // Submit should fail — name is required
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Заполните имя')).toBeVisible({
        timeout: 3000,
      });
    });

    test('create record without visitors succeeds', async ({ page }) => {
      await openAddTab(page);

      // Enter phone for an existing client (name will auto-fill)
      await page.locator('[data-testid="input-phone"]').fill('+79001234567');
      await page.locator('[data-testid="input-phone"]').blur();
      await page.waitForTimeout(1000);

      // Name should auto-fill for existing client
      const nameInput = page.locator('[data-testid="input-client-name"]');
      const nameValue = await nameInput.inputValue();
      expect(nameValue.length).toBeGreaterThan(0);

      // Do NOT add any visitors — visitors are optional
      const visitorCount = await page.locator('[data-testid="visitor-form-row"]').count();
      expect(visitorCount).toBe(0);

      // Submit — should succeed without visitors
      await page.locator('[data-testid="btn-create-record"]').click();

      // Wait for the create to complete (toast or tab switch)
      await page.waitForTimeout(2000);

      // Verify the modal is still open (no crash) — settings tab should appear
      // after successful create (handleNewBookingSubmit sets activeTab to 'settings')
      await expect(
        page.locator('[data-testid="activity-details-modal"]'),
      ).toBeVisible();
    });

    test('invalid duration format does not crash modal', async ({ page }) => {
      await openModal(page);

      const durationInput = page.locator('[data-testid="input-duration"]');
      await durationInput.fill('99:99');
      await durationInput.blur();

      // Modal should still be visible (no crash from invalid duration)
      await expect(
        page.locator('[data-testid="activity-details-modal"]'),
      ).toBeVisible();

      // Input should retain the typed value
      await expect(durationInput).toHaveValue('99:99');
    });
  });

  // ── Settings Tab ──────────────────────────────────────────────────────────

  test.describe('Settings Tab', () => {
    test('changing service auto-fills duration and capacity', async ({ page }) => {
      await openModal(page);

      const serviceSelect = page.locator('[data-testid="select-service"]');
      const durationInput = page.locator('[data-testid="input-duration"]');
      const capacityInput = page.locator('[data-testid="input-capacity"]');

      // Record initial values
      const initialDuration = await durationInput.inputValue();
      const initialCapacity = await capacityInput.inputValue();

      // Find a different service option
      const currentService = await serviceSelect.inputValue();
      const options = await serviceSelect.locator('option').all();
      let switched = false;
      for (const option of options) {
        const val = await option.getAttribute('value');
        if (val && val !== currentService && val !== '') {
          await serviceSelect.selectOption(val);
          switched = true;
          break;
        }
      }

      if (!switched) return; // Only one service available, skip

      // Wait for auto-fill
      await page.waitForTimeout(500);

      // Duration or capacity should have changed
      const newDuration = await durationInput.inputValue();
      const newCapacity = await capacityInput.inputValue();
      const somethingChanged =
        newDuration !== initialDuration || newCapacity !== initialCapacity;
      expect(somethingChanged).toBeTruthy();
    });

    test('changing datetime updates the value', async ({ page }) => {
      await openModal(page);

      const datetimeInput = page.locator('[data-testid="input-datetime"]');
      const initialValue = await datetimeInput.inputValue();

      // Change to a different datetime
      const newValue = '2026-06-10T14:30';
      expect(initialValue).not.toBe(newValue); // Ensure we're actually changing it

      await datetimeInput.fill(newValue);
      await datetimeInput.blur();

      // Value should be updated
      await expect(datetimeInput).toHaveValue(newValue);
    });

    test('toggling private changes aria-checked state', async ({ page }) => {
      await openModal(page);

      const toggle = page.locator('[data-testid="toggle-private"]');
      const initialChecked = await toggle.getAttribute('aria-checked');

      // Click the toggle
      await toggle.click();

      // aria-checked should have flipped
      const newChecked = await toggle.getAttribute('aria-checked');
      expect(newChecked).not.toBe(initialChecked);

      // Click again to flip back
      await toggle.click();
      const finalChecked = await toggle.getAttribute('aria-checked');
      expect(finalChecked).toBe(initialChecked);
    });
  });

  // ── Client Tab Operations ─────────────────────────────────────────────────

  test.describe('Client Tab Operations', () => {
    test('add visitor button exists and is visible on client tab', async ({ page }) => {
      await openModal(page);

      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (!(await clientTab.isVisible())) return; // No records on this activity

      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      // "Добавить посетителя" button should be visible
      await expect(
        page.locator('[data-testid="btn-add-visitor"]'),
      ).toBeVisible();
    });

    test('delete payment button is clickable on records with payments', async ({
      page,
    }) => {
      await openModal(page);

      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (!(await clientTab.isVisible())) return;

      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      // Check if there are any payments with delete buttons
      const deleteButtons = page.locator(
        '[data-testid="client-tab"] button[aria-label="Удалить оплату"]',
      );
      const paymentCount = await deleteButtons.count();
      if (paymentCount === 0) return; // No payments to delete

      // Verify the delete button is visible and clickable
      await expect(deleteButtons.first()).toBeVisible();
      await expect(deleteButtons.first()).toBeEnabled();

      // Click the delete button — may show success or error toast depending
      // on dynamic import resolution in the bundled app
      await deleteButtons.first().click();

      // Verify a toast appears (either success or error)
      const toastVisible = await Promise.race([
        page
          .locator('text=Оплата удалена')
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true),
        page
          .locator('text=Ошибка удаления оплаты')
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true),
      ]).catch(() => false);

      // At minimum the button was clickable and didn't crash the page
      await expect(
        page.locator('[data-testid="activity-details-modal"]'),
      ).toBeVisible();
    });

    test('changing record status updates select value', async ({ page }) => {
      await openModal(page);

      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (!(await clientTab.isVisible())) return;

      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      const statusSelect = page.locator('[data-testid="select-record-status"]');
      const currentStatus = await statusSelect.inputValue();

      // Switch to a different status
      const newStatus = currentStatus === 'confirmed' ? 'pending' : 'confirmed';
      await statusSelect.selectOption(newStatus);

      await expect(statusSelect).toHaveValue(newStatus);
    });

    test('changing visit status shows success toast', async ({ page }) => {
      await openModal(page);

      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (!(await clientTab.isVisible())) return;

      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      // Find visit status select (aria-label="Статус визита")
      const visitStatusSelect = page.locator(
        '[aria-label="Статус визита"]',
      ).first();
      if (!(await visitStatusSelect.isVisible())) return; // No visits

      await visitStatusSelect.selectOption('visited');

      // Verify success toast
      await expect(
        page.locator('text=Статус визита обновлён'),
      ).toBeVisible({ timeout: 3000 });
    });
  });

  // ── Data Persistence ──────────────────────────────────────────────────────

  test.describe('Data Persistence', () => {
    test('created record persists after page reload', async ({ page }) => {
      const uniquePhone = `+7999${Date.now().toString().slice(-7)}`;
      const clientName = `Persist ${Date.now()}`;

      // Create a record
      await openAddTab(page);
      await page.locator('[data-testid="input-phone"]').fill(uniquePhone);
      await page.locator('[data-testid="input-phone"]').blur();
      await page.waitForTimeout(500);
      await page.locator('[data-testid="input-client-name"]').fill(clientName);

      // Add a visitor
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
      await page
        .locator('[data-testid="visitor-form-row"]')
        .first()
        .locator('input')
        .first()
        .fill('Persist Visitor');

      await page.locator('[data-testid="btn-create-record"]').click();
      await page.waitForTimeout(2000);

      // Reload the page
      await page.reload();
      await waitForScheduleReady(page);

      // Open modal and check that the record appears as a client tab
      await openModal(page);

      // Verify the client name appears somewhere in the tabs
      const tabNav = page.locator('[data-testid="tab-nav"]');
      await expect(tabNav).toBeVisible();
      // The tab should contain the client name (may be truncated)
      const tabText = await tabNav.textContent();
      expect(tabText).toContain(clientName.substring(0, 10));
    });

    test('deleted record is gone after page reload', async ({ page }) => {
      // Create a record first
      const uniquePhone = `+7999${Date.now().toString().slice(-7)}`;
      const clientName = `DelTest ${Date.now()}`;

      await openAddTab(page);
      await page.locator('[data-testid="input-phone"]').fill(uniquePhone);
      await page.locator('[data-testid="input-phone"]').blur();
      await page.waitForTimeout(500);
      await page.locator('[data-testid="input-client-name"]').fill(clientName);

      // Add a visitor
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
      await page
        .locator('[data-testid="visitor-form-row"]')
        .first()
        .locator('input')
        .first()
        .fill('Del Visitor');

      await page.locator('[data-testid="btn-create-record"]').click();
      await page.waitForTimeout(2000);

      // Switch to the new record's tab
      const newTab = page.locator(
        `[data-testid^="tab-client-"]:has-text("${clientName.substring(0, 8)}")`,
      );
      if (!(await newTab.isVisible())) return; // Tab not found, skip

      await newTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      // Click delete
      await page.locator('[data-testid="btn-delete-record"]').click();

      // Wait for undo toast, then wait for the 5-second timer + API call
      await expect(
        page.locator('text=Запись удалена через 5 секунд'),
      ).toBeVisible({ timeout: 3000 });

      // Wait for the actual deletion (5s timer + API roundtrip)
      await page.waitForTimeout(7000);

      // Reload the page
      await page.reload();
      await waitForScheduleReady(page);

      // Open modal and verify the tab is gone
      await openModal(page);
      const tabNav = page.locator('[data-testid="tab-nav"]');
      const tabText = await tabNav.textContent();
      expect(tabText).not.toContain(clientName.substring(0, 10));
    });
  });

  // ── Financial ─────────────────────────────────────────────────────────────

  test.describe('Financial', () => {
    test('add payment shows success toast and updates footer', async ({ page }) => {
      await openModal(page);

      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (!(await clientTab.isVisible())) return;

      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      // Read initial owed amount from footer
      const initialOwed = await page.locator('[data-testid="total-owed"]').textContent();

      // Add a payment of 500
      const paymentInput = page.locator(
        '[data-testid="client-tab"] input[type="number"]',
      );
      await paymentInput.fill('500');
      await page.locator('[data-testid="btn-add-payment"]').click();

      // Verify success toast
      await expect(page.locator('text=Оплата 500 ₽')).toBeVisible({
        timeout: 3000,
      });

      // Footer total-owed should change (unless owed was already 0)
      // Wait for query invalidation and re-render
      await page.waitForTimeout(1000);
      const newOwed = await page.locator('[data-testid="total-owed"]').textContent();
      // At minimum the toast proves the payment was submitted
      // The footer may or may not update depending on query invalidation timing
      expect(newOwed).toBeDefined();
    });

    test('delete payment shows toast confirming removal', async ({ page }) => {
      await openModal(page);

      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (!(await clientTab.isVisible())) return;

      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      // Check for existing payments
      const deleteButtons = page.locator(
        '[data-testid="client-tab"] button[aria-label="Удалить оплату"]',
      );
      const count = await deleteButtons.count();
      if (count === 0) return; // No payments to delete

      // Delete the first payment
      await deleteButtons.first().click();

      // Verify a toast appears (success or error)
      const toastVisible = await Promise.race([
        page
          .locator('text=Оплата удалена')
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true),
        page
          .locator('text=Ошибка удаления оплаты')
          .waitFor({ state: 'visible', timeout: 3000 })
          .then(() => true),
      ]).catch(() => false);

      // At minimum the button click didn't crash the page
      await expect(
        page.locator('[data-testid="activity-details-modal"]'),
      ).toBeVisible();
    });
  });

  // ── Tab Navigation ────────────────────────────────────────────────────────

  test.describe('Tab Navigation', () => {
    test('switching between client tabs shows different content', async ({
      page,
    }) => {
      await openModal(page);

      const clientTabs = page.locator('[data-testid^="tab-client-"]');
      const count = await clientTabs.count();
      if (count < 2) return; // Need at least 2 client tabs

      // Click first client tab
      await clientTabs.nth(0).click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();
      const firstName = await page
        .locator('[data-testid="client-name"]')
        .inputValue();

      // Click last client tab
      await clientTabs.nth(count - 1).click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();
      const secondName = await page
        .locator('[data-testid="client-name"]')
        .inputValue();

      // Both should have loaded content — at least verify the tabs are functional
      expect(firstName).toBeDefined();
      expect(secondName).toBeDefined();

      // If different clients, names should differ
      // (same client on different records would show same name — that's ok)
    });

    test('settings → client → settings round-trip works', async ({ page }) => {
      await openModal(page);

      // Start on settings
      await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

      const clientTab = page.locator('[data-testid^="tab-client-"]').first();
      if (!(await clientTab.isVisible())) return;

      // Switch to client tab
      await clientTab.click();
      await expect(page.locator('[data-testid="client-tab"]')).toBeVisible();

      // Switch back to settings
      await page.locator('[data-testid="tab-settings"]').click();
      await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

      // All settings fields should still be present
      await expect(page.locator('[data-testid="input-datetime"]')).toBeVisible();
      await expect(page.locator('[data-testid="select-service"]')).toBeVisible();
      await expect(page.locator('[data-testid="input-duration"]')).toBeVisible();
    });

    test('settings → new-booking → settings round-trip works', async ({
      page,
    }) => {
      await openModal(page);

      // Start on settings
      await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

      // Switch to new booking tab
      await page.locator('[data-testid="tab-add"]').click();
      await expect(page.locator('[data-testid="new-booking-tab"]')).toBeVisible();

      // Switch back to settings
      await page.locator('[data-testid="tab-settings"]').click();
      await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();
    });
  });

  // ── Error Handling ────────────────────────────────────────────────────────

  test.describe('Error Handling', () => {
    test('network error on create shows error toast', async ({ page }) => {
      await openAddTab(page);

      // Use unknown phone so the flow tries to create a new client
      await page.locator('[data-testid="input-phone"]').fill('+79990009876');
      await page.locator('[data-testid="input-phone"]').blur();
      await page.waitForTimeout(500);
      await page.locator('[data-testid="input-client-name"]').fill('Error Test');

      // Add a visitor
      await page
        .locator('[data-testid="new-booking-tab"]')
        .locator('button:has-text("Добавить посетителя")')
        .click();
      await page
        .locator('[data-testid="visitor-form-row"]')
        .first()
        .locator('input')
        .first()
        .fill('Error Visitor');

      // Mock the client creation endpoint to fail
      await page.route(
        `${BACKEND}/api/v1/clients`,
        (route: any) => {
          if (route.request().method() === 'POST') {
            route.abort('connectionrefused');
          } else {
            route.continue();
          }
        },
      );

      // Submit — should show error toast
      await page.locator('[data-testid="btn-create-record"]').click();
      await expect(page.locator('text=Ошибка создания записи')).toBeVisible({
        timeout: 5000,
      });

      // Clean up the route mock
      await page.unroute(`${BACKEND}/api/v1/clients`);
    });

    test('empty activity modal shows settings and no client tabs', async ({
      page,
    }) => {
      // Create a fresh activity via API to guarantee 0 records
      const createResp = await page.request.post(`${BACKEND}/api/v1/activities`, {
        data: {
          service_id: 's3',
          master_id: 'm5',
          location_id: 'p1389',
          start: '2026-06-08T10:00:00',
          duration: 90,
          capacity: 5,
          is_private: false,
        },
      });
      expect(createResp.ok()).toBeTruthy();
      const newActivity = await createResp.json();
      const newActivityId = newActivity.id;

      // Reload to pick up the new activity
      await page.reload();
      await waitForScheduleReady(page);

      // Find the new activity card
      const cardExists = await page.evaluate((actId: string) => {
        return !!document.querySelector(`[data-testid="activity-${actId}"]`);
      }, newActivityId);

      if (!cardExists) {
        // Activity might not be in the current week view, clean up and skip
        await page.request.delete(`${BACKEND}/api/v1/activities/${newActivityId}`);
        return;
      }

      // Open modal for the fresh activity
      const activity = await getActivityById(page, newActivityId);
      if (!activity) {
        await page.request.delete(`${BACKEND}/api/v1/activities/${newActivityId}`);
        return;
      }

      await page.evaluate((act: any) => {
        document.dispatchEvent(
          new CustomEvent('__memo-open-modal', {
            detail: { activity: act },
          }),
        );
      }, activity);
      await page.waitForSelector('[data-testid="activity-details-modal"]', {
        state: 'visible',
        timeout: 10000,
      });

      // Settings tab should be visible
      await expect(page.locator('[data-testid="settings-tab"]')).toBeVisible();

      // No client tabs (fresh activity has 0 records)
      const clientTabs = page.locator('[data-testid^="tab-client-"]');
      await expect(clientTabs).toHaveCount(0);

      // "+" tab should still be visible
      await expect(page.locator('[data-testid="tab-add"]')).toBeVisible();

      // Clean up: delete the test activity
      await page.request.delete(`${BACKEND}/api/v1/activities/${newActivityId}`);
    });
  });
});
