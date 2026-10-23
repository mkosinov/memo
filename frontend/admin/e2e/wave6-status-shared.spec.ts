import { SEED_WEEK_MONDAY } from './fixtures/seed-week';
import { test, expect } from './fixtures/test';
import {
  waitForScheduleReady,
  openModal,
  installReferenceWeekClock,
} from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

/**
 * Wave 6 — User Scenario 5: shared status labels across call sites.
 *
 * Verifies the status labels the user sees are the same everywhere:
 * 1. /records filter (RecordsFilters → StatusFiltersPicker)
 * 2. Activity modal ClientTab (RecordSummary → StatusPicker)
 * 3. /clients modal record tab (ClientRecordTab → RecordHeader → StatusBadge)
 * 4. StatusPicker DOM structure in the activity modal
 *
 * GH #520: the spec used to be vacuum — `count > 0` guards silently skipped
 * everything on the empty default-period week (no page clock) and the
 * /clients test asserted an always-true `count >= 0` against a
 * `[data-testid^="status-picker"]` that does not render on /clients at all
 * (StatusPicker lives in modals; the /clients modal shows a StatusBadge).
 *
 * Uses DOM text comparison instead of visual snapshots for reliability.
 */

const EXPECTED_LABELS = ['Ожидание', 'Посетил', 'Неявка', 'Отменён'];

test.describe('Wave 6 — StatusPicker shared across sites', () => {
  test('Scenario 5: same StatusPicker labels in /records filter', async ({
    page,
  }) => {
    // GH #520: pin the clock to the seed's reference week — the spec lands on
    // the /records DEFAULT period (the page-clock week); without seeded rows
    // there the old `count > 0` guard silently skipped the whole block.
    await installReferenceWeekClock(page);
    await page.goto('/records');
    await page.waitForSelector('h1:has-text("Управление записями")', { timeout: 15_000 });

    // Find the StatusPicker in RecordsFilters (testid prefix: "records-filters-status")
    const statusFilter = page.locator('[data-testid="records-filters-status"]');
    await expect(statusFilter).toBeVisible(); // hard fail (GH #520): was a silent guard
    await statusFilter.locator('button').first().click();

    // The popover lists «Все статусы» + the 4 config labels — no extras, none missing
    const options = statusFilter.locator('[data-testid^="records-filters-status-option-"]');
    await expect(options.first()).toBeVisible();
    const optionTexts = await options.allTextContents();
    expect(optionTexts).toHaveLength(EXPECTED_LABELS.length + 1);
    expect(optionTexts).toContain('Все статусы');
    for (const label of EXPECTED_LABELS) {
      expect(optionTexts).toContain(label);
    }
  });

  test('Scenario 5: same StatusPicker in activity modal ClientTab', async ({
    page,
  }) => {
    await page.goto(`/schedule?date=${SEED_WEEK_MONDAY}`);
    await waitForScheduleReady(page);
    await openModal(page);

    // Find a client tab
    const clientTabs = page.locator('[data-testid^="tab-client-"]');
    await clientTabs.first().click();
    await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 10_000 });

    // Find the StatusPicker inside the client tab (testidPrefix="record-status" in RecordSummary)
    const statusPicker = page.locator('[data-testid="client-tab"] [data-testid="record-status"]');
    await expect(statusPicker).toBeVisible();
    // Verify it has the correct testid
    const testId = await statusPicker.getAttribute('data-testid');
    expect(testId).toBe('record-status');
  });

  test('Scenario 5: status display in /clients modal record tab', async ({
    page,
  }) => {
    // GH #520: no StatusPicker renders on /clients — the client modal's record
    // tab shows the status as a RecordHeader StatusBadge. Pick a client that
    // HAS records (deterministic DB lookup) and open their record tab.
    const row = queryDBRow(
      `SELECT c.name AS name FROM clients c
       JOIN records r ON r.client_id = c.id
       GROUP BY c.id ORDER BY c.id LIMIT 1`,
    );
    expect(row).not.toBeNull();

    await page.goto('/clients');
    await page.waitForSelector('h1:has-text("Клиенты")', { timeout: 15_000 });

    const clientRow = page.locator('table tbody tr').filter({ hasText: row!.name });
    await expect(clientRow).toBeVisible({ timeout: 10_000 });
    await clientRow.click();
    const modal = page.locator('[data-testid="client-card-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Record tabs follow the «Клиент» tab in the left panel (clients.spec pattern)
    const recordTabButton = modal.locator('[data-testid="client-card-left-panel"] button').nth(1);
    await expect(recordTabButton).toBeVisible({ timeout: 10_000 });
    await recordTabButton.click();
    const recordTab = page.locator('[data-testid="client-record-tab"]');
    await recordTab.waitFor({ state: 'visible', timeout: 10_000 });

    // The record header's badge shows the shared Russian status label
    const badge = recordTab.locator('[data-testid^="status-badge-"]');
    await expect(badge.first()).toBeVisible();
    const badgeText = (await badge.first().textContent())?.trim() ?? '';
    expect(EXPECTED_LABELS).toContain(badgeText);
  });

  test('Scenario 5: StatusPicker DOM structure is consistent', async ({
    page,
  }) => {
    // Navigate to schedule and open modal to check StatusPicker structure
    await page.goto(`/schedule?date=${SEED_WEEK_MONDAY}`);
    await waitForScheduleReady(page);
    await openModal(page);

    const clientTabs = page.locator('[data-testid^="tab-client-"]');
    await clientTabs.first().click();
    await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 10_000 });

    // Verify StatusPicker structure
    const statusPicker = page.locator('[data-testid="client-tab"] [data-testid="record-status"]');
    await expect(statusPicker).toBeVisible();

    // Should contain a trigger element (button or select)
    const hasTrigger = (await statusPicker.locator('button, select').count()) > 0;
    expect(hasTrigger).toBeTruthy();

    // Verify the StatusPicker has the correct testid prefix
    const testId = await statusPicker.getAttribute('data-testid');
    expect(testId).toBe('record-status');
  });
});
