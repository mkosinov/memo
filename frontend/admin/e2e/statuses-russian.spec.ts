import { test, expect } from './fixtures/test';
import { installReferenceWeekClock, waitForRecordsReady } from './fixtures/helpers';
import { createTestRecordWithClient } from './fixtures/factories';

const RU_STATUS_LABELS = ['Ожидание', 'Посетил', 'Неявка', 'Отменён'];

test('US-ST01: All status displays use Russian names', async ({ page, request }) => {
  // GH #520: pin the clock to the seed's reference week BEFORE navigation —
  // the /records default period is the page-clock week; without the pin the
  // table is empty and the old `if (count > 0)` guard silently skipped every
  // assertion (the spec was vacuum). The same guard also looked for a native
  // select[aria-label="Фильтр по статусу"] that does not exist on /records
  // (that select lives in locations/staff/services filters) and a
  // `record-status` testid that only renders inside modals — both blocks were
  // eternal skips. Real target: StatusBadge cells (`status-badge-<status>`)
  // in the records table; the filter popover is owned by wave6-status-shared.
  //
  // Factory records land on the reference week (the seed's own records sit on
  // the visual 06-15 week — the records.spec factory pattern), so the default
  // period has rows to check.
  await createTestRecordWithClient(request, 'Статус Раз');
  await createTestRecordWithClient(request, 'Статус Два');
  await installReferenceWeekClock(page);
  await waitForRecordsReady(page);

  const statusCells = page.locator('[data-testid^="status-badge-"]');
  await expect(statusCells.first()).toBeVisible(); // hard fail on an empty week (GH #520)
  const count = await statusCells.count();
  for (let i = 0; i < count; i++) {
    const text = (await statusCells.nth(i).textContent())?.trim() ?? '';
    expect(RU_STATUS_LABELS).toContain(text);
  }
});
