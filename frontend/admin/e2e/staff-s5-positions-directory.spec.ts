/**
 * S5 (GH #266) — «Справочник должностей».
 *
 * A new position is created and deleted; the built-in «мастер» cannot be
 * deleted (the refusal is EXPLAINED) but can be renamed; positions touch
 * nothing else — the schedule master filter is unchanged (D4: «на расписание
 * и доступы должности не влияют»).
 *
 * The dictionary screen is the UI under test. The «no impact on filters» half
 * is asserted against the read-only /masters view + the schedule filter
 * dropdown, which is what a position write could have leaked into.
 */
import { test, expect } from './fixtures/test';
import { cleanup } from './fixtures/factories';
import { waitForPositionsReady, waitForScheduleReady, waitForToast } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Open the ⋯ menu on a position row. */
async function openPositionRowMenu(page: import('@playwright/test').Page, id: string) {
  const row = page.locator(`[data-testid="position-row-${id}"]`);
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole('button', { name: /^Действия/ }).click();
  const dropdown = row.locator('[data-testid^="dropdown-"]');
  await expect(dropdown).toBeVisible({ timeout: 5_000 });
  return dropdown;
}

test.describe('S5 — positions dictionary', () => {
  test('the directory screen lists the seed dictionary with built-ins marked', async ({ page }) => {
    await waitForPositionsReady(page);

    await expect(page.getByText('Управление должностями')).toBeVisible();
    await expect(page.getByText('+ Добавить должность')).toBeVisible();

    // Seed rows (RESET_SQL pins these titles back before every test).
    for (const id of ['master', 'admin', 'smm']) {
      await expect(page.locator(`[data-testid="position-row-${id}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="position-row-master"]')).toContainText('Встроенная');
    await expect(page.locator('[data-testid="position-row-admin"]')).toContainText('Встроенная');
    await expect(page.locator('[data-testid="position-row-smm"]')).toContainText('Пользовательская');
  });

  test('a new position is created through the UI and lands in the dictionary', async ({ page, request }) => {
    const title = `S5 Должность ${Date.now()}`;
    let createdId: string | undefined;

    try {
      await waitForPositionsReady(page);

      // 2. ACTION — create through the UI.
      await page.getByText('+ Добавить должность').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Новая должность')).toBeVisible();

      const postPromise = page.waitForResponse((r) =>
        r.url().includes('/api/v1/positions') && r.request().method() === 'POST',
      );
      await dialog.getByLabel('Должность', { exact: false }).fill(title);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const post = await postPromise;

      // 3. VERIFY UI — toast + the new row appears in the table.
      expect(post.status()).toBe(201);
      const body = (await post.json()) as { id: string; title: string; is_system: boolean };
      createdId = body.id;
      await waitForToast(page);
      const newRow = page.locator(`[data-testid="position-row-${createdId}"]`);
      await expect(newRow).toBeVisible({ timeout: 10_000 });
      await expect(newRow).toContainText(title);
      // A created row is always user-defined — is_system is owned by the dictionary.
      await expect(newRow).toContainText('Пользовательская');

      // 4. VERIFY DB — a user-defined row (uuid id), is_system false.
      expect(body.title).toBe(title);
      expect(body.is_system).toBe(false);
      expect(queryDBRow(
        `SELECT title, is_system FROM positions WHERE id='${createdId}'`,
      )).toMatchObject({ title, is_system: 0 });
    } finally {
      // 5. CLEANUP
      if (createdId) await cleanup(request, `/api/v1/positions/${createdId}`);
    }
  });

  test('a new position is deleted through the UI and leaves the dictionary', async ({ page, request }) => {
    const title = `S5 На удаление ${Date.now()}`;

    // 1. SETUP — create via API (the delete flow is under test, not create).
    const created = await request.post(`${BACKEND}/api/v1/positions`, {
      data: { title },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    try {
      await waitForPositionsReady(page);
      const row = page.locator(`[data-testid="position-row-${id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });

      // 2. ACTION — delete through the row menu (+ the locked window.confirm).
      page.once('dialog', (d) => void d.accept());
      const dropdown = await openPositionRowMenu(page, id);
      const deletePromise = page.waitForResponse((r) =>
        r.url().includes(`/api/v1/positions/${id}`) && r.request().method() === 'DELETE',
      );
      await dropdown.getByRole('menuitem', { name: 'Удалить' }).click();
      const del = await deletePromise;

      // 3. VERIFY UI — toast, row gone.
      expect(del.status()).toBe(204);
      await waitForToast(page);
      await expect(row).toHaveCount(0, { timeout: 10_000 });

      // 4. VERIFY DB — physically gone (the dictionary is not archive-aware).
      expect((await request.get(`${BACKEND}/api/v1/positions/${id}`)).status()).toBe(404);
      expect(queryDBRow(`SELECT id FROM positions WHERE id='${id}'`)).toBeNull();
    } finally {
      // 5. CLEANUP — no-op when the UI delete already succeeded.
      await cleanup(request, `/api/v1/positions/${id}`);
    }
  });

  test('the built-in «мастер» cannot be deleted — the refusal is explained, the row stays', async ({ page }) => {
    // The seed built-in is owned by RESET_SQL; this test only ATTEMPTS a delete
    // (422), so no cleanup is needed — and renaming is covered separately.
    await waitForPositionsReady(page);
    const row = page.locator('[data-testid="position-row-master"]');
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 2. ACTION — request a delete of the built-in.
    page.once('dialog', (d) => void d.accept());
    const dropdown = await openPositionRowMenu(page, 'master');
    const deletePromise = page.waitForResponse((r) =>
      r.url().includes('/api/v1/positions/master') && r.request().method() === 'DELETE',
    );
    await dropdown.getByRole('menuitem', { name: 'Удалить' }).click();
    const del = await deletePromise;

    // 3. VERIFY UI — the 422 explanation surfaces as an error toast (D4).
    expect(del.status()).toBe(422);
    expect((await del.json()).detail.code).toBe('POSITION_IS_SYSTEM');
    await expect(page.getByTestId('toast-error')).toContainText(
      'Встроенная должность не удаляется',
    );

    // 4. VERIFY DB — untouched: still there, still a built-in, title unchanged.
    await expect(row).toBeVisible();
    expect(queryDBRow(
      `SELECT title, is_system FROM positions WHERE id='master'`,
    )).toMatchObject({ title: 'Мастер', is_system: 1 });
  });

  test('the built-in «мастер» can be renamed (title свободен, D4) — id stays the anchor', async ({ page }) => {
    const newTitle = `Ведущий мастер ${Date.now()}`;

    await waitForPositionsReady(page);
    const row = page.locator('[data-testid="position-row-master"]');
    await expect(row).toBeVisible({ timeout: 10_000 });

    // 2. ACTION — rename through the edit modal.
    await row.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Редактирование должности')).toBeVisible();
    await expect(dialog.getByLabel('Должность', { exact: false })).toHaveValue('Мастер');

    const putPromise = page.waitForResponse((r) =>
      r.url().includes('/api/v1/positions/master') && r.request().method() === 'PUT',
    );
    await dialog.getByLabel('Должность', { exact: false }).fill(newTitle);
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    const put = await putPromise;

    // 3. VERIFY UI — toast, new title in the row, still marked built-in.
    expect(put.status()).toBe(200);
    await waitForToast(page);
    await expect(page.locator('[data-testid="position-row-master"]')).toContainText(newTitle, {
      timeout: 10_000,
    });
    await expect(page.locator('[data-testid="position-row-master"]')).toContainText('Встроенная');

    // 4. VERIFY DB — SAME fixed id (the code anchor never moves), still system.
    const body = (await put.json()) as { id: string; title: string; is_system: boolean };
    expect(body).toMatchObject({ id: 'master', title: newTitle, is_system: true });
    expect(queryDBRow(
      `SELECT title, is_system FROM positions WHERE id='master'`,
    )).toMatchObject({ title: newTitle, is_system: 1 });
    // The staff links survive the rename (the M2M keys on id, not title).
    expect(queryDBRow(
      `SELECT COUNT(*) AS n FROM staff_positions WHERE position_id='master'`,
    ) as unknown as { n: number }).toMatchObject({ n: 6 }); // seed m1–m5, m7
    // RESET_SQL restores the seed title before the next test — no cleanup here.
  });

  test('position writes do not affect the schedule master filter (D4)', async ({ page, request }) => {
    // Baseline: the acting-master view the schedule filter reads.
    const actingBefore = ((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json()) as { id: string }[])
      .map((m) => m.id)
      .sort();
    expect(actingBefore.length).toBeGreaterThan(0);

    // 1. SETUP — a brand new position, created through the UI screen.
    const title = `S5 Без влияния ${Date.now()}`;
    let createdId: string | undefined;
    try {
      await waitForPositionsReady(page);
      await page.getByText('+ Добавить должность').click();
      const dialog = page.getByRole('dialog');
      const postPromise = page.waitForResponse((r) =>
        r.url().includes('/api/v1/positions') && r.request().method() === 'POST',
      );
      await dialog.getByLabel('Должность', { exact: false }).fill(title);
      await dialog.getByRole('button', { name: 'Сохранить' }).click();
      const post = await postPromise;
      expect(post.status()).toBe(201);
      createdId = ((await post.json()) as { id: string }).id;

      // 2/3. VERIFY — the acting-master view is byte-identical, and the
      // schedule's «Мастера» filter offers the SAME options (no new entries,
      // none removed): positions feed neither /masters nor the schedule.
      const actingAfter = ((await (await request.get(`${BACKEND}/api/v1/masters/all`)).json()) as { id: string }[])
        .map((m) => m.id)
        .sort();
      expect(actingAfter).toEqual(actingBefore);

      await waitForScheduleReady(page);
      const mastersFilter = page.locator(
        '[data-testid="center-content"] button[aria-label="Мастера"]',
      );
      await expect(mastersFilter).toBeVisible();
      await mastersFilter.click();
      const dropdown = page.locator('[data-testid="multiselect-dropdown"]');
      await expect(dropdown).toBeVisible();

      const optionIds = (
        await dropdown
          .locator('[data-testid^="multiselect-option-"]')
          .evaluateAll((els) =>
            els.map((el) =>
              String(el.getAttribute('data-testid') ?? '').replace('multiselect-option-', ''),
            ),
          )
      ).sort();
      expect(optionIds).toEqual(actingBefore);
      // The position title never leaks into the master filter.
      await expect(dropdown).not.toContainText(title);
    } finally {
      // 5. CLEANUP
      if (createdId) await cleanup(request, `/api/v1/positions/${createdId}`);
    }
  });
});
