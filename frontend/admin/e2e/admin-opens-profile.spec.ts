import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import {
  waitForScheduleReady,
  openModal,
  gotoScheduleWeek,
  clickActivityCard,
} from './fixtures/helpers';
import {
  createTestClient,
  createTestActivity,
  createTestRecord,
  cleanup,
  cleanupRecord,
} from './fixtures/factories';
import { queryDBRow } from './fixtures/db-query';

/**
 * US-M04 (GH #232 re-anchored): admin opens a client profile from a record's
 * client tab. The link opens /clients?clientId=<uuid> in a new tab.
 *
 * The #232 deep-link narrowing only works for STRICT UUID ids — seed clients
 * (c1…c5) are not UUIDs and get dropped by the parser. So this spec creates
 * its own client+activity+record (UUID ids) and opens the record's activity
 * card directly, instead of relying on seed data via openModal().
 */

/** Resolve the record's activity date (YYYY-MM-DD) from the DB. */
function recordActivityDate(recordId: string): string | null {
  const row = queryDBRow(
    `SELECT substr(a.start, 1, 10) AS d FROM records r ` +
      `JOIN activities a ON r.activity_id = a.id WHERE r.id = '${recordId.replace(/'/g, "''")}'`,
  );
  return row?.d ?? null;
}

test('US-M04: Admin can open client profile from a record', async ({
  page,
  request,
}) => {
  const client = await createTestClient(request);
  const activity = await createTestActivity(request);
  const record = await createTestRecord(request, activity.id, client.id);

  try {
    // Navigate to the week of the record's activity and open its card.
    const targetDate = recordActivityDate(record.id);
    if (!targetDate) throw new Error(`No activity date for record ${record.id}`);
    await gotoScheduleWeek(page, targetDate);
    const card = page.locator(`[data-testid="activity-${activity.id}"]`);
    await expect(card).toBeVisible({ timeout: 5_000 });
    await clickActivityCard(page, card);

    // Switch to first client tab
    const clientTab = page.locator('[data-testid^="tab-client-"]').first();
    await expect(clientTab).toBeVisible({ timeout: 5_000 });
    await clientTab.click();
    await expect(page.locator('[data-testid="client-tab"]')).toBeVisible({ timeout: 5_000 });

    // The profile link is a span with data-testid="open-profile-{recordId}"
    // that opens /clients?clientId={id} in a new tab
    const profileLink = page.locator('[data-testid^="open-profile-"]').first();
    await expect(profileLink).toBeVisible({ timeout: 5_000 });

    // Click the profile link — it opens a new tab via window.open and closes the modal
    const [newPage] = await Promise.all([
      page.context().waitForEvent('page'),
      profileLink.click(),
    ]);

    // Assert: new page URL changes to /clients?clientId=...
    await expect(newPage).toHaveURL(/\/clients\?clientId=/);

    // #232 US-1 (new-scheme assertions, replacing the old «UUID lands in the
    // search box» expectation): the single-id deep link narrows the table to
    // that client, auto-opens the card, keeps the search EMPTY, and renders
    // the narrowing chip — the search box never carries the UUID anymore.
    await expect(newPage.locator('table tbody tr')).toHaveCount(1, { timeout: 10_000 });
    await expect(
      newPage.locator('[data-testid="client-card-modal"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(newPage.locator('input[placeholder*="Поиск"]')).toHaveValue('');
    await expect(
      newPage.locator('[data-testid="client-deeplink-chip"] span[aria-live]'),
    ).toHaveText('Открыт по ссылке');

    await newPage.close();
  } finally {
    await cleanupRecord(request, record.id);
    await cleanup(request, `/api/v1/clients/${client.id}`);
    await cleanup(request, `/api/v1/activities/${activity.id}`);
  }
});
