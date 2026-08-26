import { test, expect } from '@playwright/test';
import {
  waitForScheduleReady,
  waitForTagsReady,
  waitForLocationsReady,
  waitForClientsReady,
} from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';

/**
 * E2E tests for error message scenarios (spec §9).
 *
 * Verifies that the correct user-facing Russian error messages appear
 * in toasts for various failure modes:
 *   1. Activity at capacity → "Недостаточно мест"
 *   2. Delete non-existent tag → "Не найдено"
 *   3. Empty location name → "Проверьте правильность заполнения полей"
 *   4. Server error 500 → "Ошибка сервера"
 *   5. Network offline → "Ошибка сети"
 *   6. Duplicate phone → "Клиент с таким телефоном..."
 *
 * Scenarios 2, 3, 4, 5, 6 use page.route() to mock API error responses
 * with the new structured error shape: {detail: {code, message}}.
 *
 * Requires: backend on :8005, admin on :3005
 */

const BACKEND = process.env.BACKEND_URL || 'http://localhost:8005';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the last (most recent) error toast and assert its text. */
async function expectErrorToast(page: import('@playwright/test').Page, textPattern: string | RegExp) {
  const toast = page.locator('[data-testid="toast-error"]');
  await expect(toast.last()).toBeVisible({ timeout: 10_000 });
  await expect(toast.last()).toContainText(textPattern);
}

// ---------------------------------------------------------------------------
// Scenario 1 — Activity at capacity → "Недостаточно мест"
// ---------------------------------------------------------------------------

test.describe('Scenario 1 — Activity at capacity', () => {
  test('full activity shows "Недостаточно мест" when creating a record', async ({
    page,
    request,
  }) => {
    // 1. SETUP — create activity with capacity=2, fill both seats
    const activity = await createTestActivity(request, { capacity: 2 });
    const client1 = await createTestClient(request);
    const client2 = await createTestClient(request);
    const record1 = await createTestRecord(request, activity.id, client1.id);
    const record2 = await createTestRecord(request, activity.id, client2.id);

    try {
      // 2. Navigate to schedule and wait for the activity card
      await waitForScheduleReady(page);

      // Reload to force React Query to refetch fresh data.
      // waitForScheduleReady waits for any activity card (seed data)
      // but the newly created activity above may not be in the initial
      // React Query cache. Hard reload bypasses stale cache.
      await page.reload({ waitUntil: 'networkidle' });
      await waitForScheduleReady(page);

      // Find the specific activity card
      const activityCard = page.locator(`[data-testid="activity-${activity.id}"]`);
      await expect(activityCard).toBeVisible({ timeout: 30_000 });

      // Open the modal via custom event (same pattern as openAddTab helper)
      await page.evaluate((act: any) => {
        document.dispatchEvent(new CustomEvent('__memo-quick-add', { detail: { activity: act } }));
      }, activity);

      await page.waitForSelector('[data-testid="activity-details-modal"]', {
        state: 'visible',
        timeout: 10_000,
      });

      // Wait for the new booking tab to be visible
      await expect(page.locator('[data-testid="new-booking-tab"]')).toBeVisible({ timeout: 5_000 });

      // Fill phone and name
      await page.locator('[data-testid="input-phone"]').fill('+79991234567');
      await page.locator('[data-testid="input-client-name"]').fill('Test User');

      // Submit
      await page.locator('[data-testid="btn-create-record"]').click();

      // 3. VERIFY UI — toast should contain "Недостаточно мест"
      await expectErrorToast(page, /Недостаточно мест/);
    } finally {
      // 5. CLEANUP
      await cleanupRecord(request, record1.id);
      await cleanupRecord(request, record2.id);
      await cleanup(request, `/api/v1/clients/${client1.id}`);
      await cleanup(request, `/api/v1/clients/${client2.id}`);
      await cleanup(request, `/api/v1/activities/${activity.id}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Scenario 2 — Delete non-existent tag → "Не найдено"
// ---------------------------------------------------------------------------

test.describe('Scenario 2 — Delete non-existent tag', () => {
  test('shows "Не найдено" when deleting a non-existent tag', async ({ page }) => {
    await waitForTagsReady(page);

    // Get the first real tag's ID from the table so we can intercept its delete
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    const testId = await firstRow.getAttribute('data-testid');
    const tagId = testId?.replace('tag-row-', '');

    // Intercept DELETE for this specific tag — return 404 with TAG_NOT_FOUND
    await page.route(`**/api/v1/tags/${tagId}`, (route) => {
      if (route.request().method() === 'DELETE') {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: { code: 'TAG_NOT_FOUND', message: 'Tag not found' },
          }),
        });
      } else {
        route.continue();
      }
    });

    // Set up dialog handler BEFORE clicking delete
    page.on('dialog', (dialog) => dialog.accept());

    // Click the actions dropdown on the first tag row
    const actionsBtn = firstRow.locator('button[aria-label^="Действия"]');
    await expect(actionsBtn).toBeVisible();
    await actionsBtn.click();

    // Click "Удалить" in the dropdown
    const dropdown = page.locator('[data-testid^="dropdown-"]').first();
    await expect(dropdown).toBeVisible();
    await dropdown.locator('button:has-text("Удалить")').click();

    // Verify toast shows "Не найдено"
    await expectErrorToast(page, 'Не найдено');
  });
});

// ---------------------------------------------------------------------------
// Scenario 3 — Empty location name → "Проверьте правильность заполнения полей"
// ---------------------------------------------------------------------------

test.describe('Scenario 3 — Validation error on location', () => {
  test('shows validation message when location update fails', async ({ page }) => {
    await waitForLocationsReady(page);

    // Intercept PUT/PATCH for location update — return 422 with VALIDATION_ERROR
    await page.route('**/api/v1/locations/**', (route) => {
      if (route.request().method() === 'PUT' || route.request().method() === 'PATCH') {
        route.fulfill({
          status: 422,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: {
              code: 'VALIDATION_ERROR',
              message: 'field required',
            },
          }),
        });
      } else {
        route.continue();
      }
    });

    // Click the first row to open edit modal
    const firstRow = page.locator('table tbody tr').first();
    await expect(firstRow).toBeVisible();
    await firstRow.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // Click "Сохранить" to submit (with existing data — the mock will reject it)
    await dialog.getByText('Сохранить').click();

    // Verify toast shows validation message
    await expectErrorToast(page, 'Проверьте правильность заполнения полей');
  });
});

// ---------------------------------------------------------------------------
// Scenario 4 — Server error 500 → "Ошибка сервера"
// ---------------------------------------------------------------------------

test.describe('Scenario 4 — Server error', () => {
  test('shows "Ошибка сервера" on 500 response', async ({ page }) => {
    await waitForTagsReady(page);

    // Intercept POST /api/v1/tags — return 500 with INTERNAL_ERROR
    await page.route('**/api/v1/tags', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' },
          }),
        });
      } else {
        route.continue();
      }
    });

    // Open create modal
    await page.click('text=+ Добавить тег');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill in a tag name
    const tagInput = dialog.locator('input[type="text"]').first();
    await tagInput.fill('Тестовый тег');

    // Click "Сохранить"
    await dialog.getByText('Сохранить').click();

    // Verify toast shows "Ошибка сервера"
    await expectErrorToast(page, 'Ошибка сервера');
  });
});

// ---------------------------------------------------------------------------
// Scenario 5 — Network offline → "Ошибка сети"
// ---------------------------------------------------------------------------

test.describe('Scenario 5 — Network failure', () => {
  test('shows "Ошибка сети" when network is offline', async ({ page }) => {
    await waitForTagsReady(page);

    // Intercept all POST requests and abort them (simulate network failure)
    await page.route('**/api/v1/tags', (route) => {
      if (route.request().method() === 'POST') {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    // Open create modal
    await page.click('text=+ Добавить тег');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Fill in a tag name
    const tagInput = dialog.locator('input[type="text"]').first();
    await tagInput.fill('Тестовый тег');

    // Click "Сохранить"
    await dialog.getByText('Сохранить').click();

    // Verify toast shows "Ошибка сети"
    await expectErrorToast(page, 'Ошибка сети');
  });
});

// ---------------------------------------------------------------------------
// Scenario 6 — Duplicate phone → "Клиент с таким телефоном..."
// ---------------------------------------------------------------------------

test.describe('Scenario 6 — Duplicate phone', () => {
  test('shows "Клиент с таким телефоном" on duplicate phone error', async ({ page }) => {
    await waitForClientsReady(page);

    // Intercept POST /api/v1/clients — return 409 with CLIENT_DUPLICATE_PHONE
    await page.route('**/api/v1/clients', (route) => {
      if (route.request().method() === 'POST') {
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            detail: {
              code: 'CLIENT_DUPLICATE_PHONE',
              message: 'Client with this phone already exists',
            },
          }),
        });
      } else {
        route.continue();
      }
    });

    // Open create client form — click "+ Новый клиент"
    const addBtn = page.locator('button:has-text("Новый клиент")');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Wait for the client card modal in create mode
    const modal = page.locator('[data-testid="client-card-modal"]');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Fill in the name field to enable the save button (hasChanges must be true)
    const nameInput = page.locator('#client-name');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await nameInput.fill('Тестовый клиент');

    // Click "Создать" button (create mode uses "Создать" not "Сохранить")
    const saveBtn = modal.locator('button:has-text("Создать")');
    await expect(saveBtn).toBeEnabled({ timeout: 3_000 });
    await saveBtn.click();

    // Verify toast shows duplicate phone message
    await expectErrorToast(page, /Клиент с таким телефоном/);
  });
});
