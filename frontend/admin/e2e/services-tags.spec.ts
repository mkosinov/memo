/**
 * GH #328 — E2E S1–S4: the ServiceModal «Теги» field (spec §5).
 *
 * S1 `edit-other-field-keeps-tags` (the original bug): seed s4 «Акварель»
 *    carries the seed link to tag3 «для детей» (seed.py `_seed_service_tags`
 *    — the link exists BEFORE the form opens, the #328 setup). Open edit,
 *    change ONLY «Длительность», save → the chip is still in the table row
 *    and a fresh GET returns the live link. The strict GET asserts after
 *    the save are the regression guard: pre-fix, the form submitted
 *    `tag_ids: []` and the full-update PUT hard-replaced the links —
 *    `after.tags` would come back empty.
 * S2 `swap-tag-set`: s1 «Картина маслом» (tag2 «хит» + tag4 «популярное»)
 *    → remove chip «хит», add tag6 «сезонное» via the ≥2-char typeahead,
 *    save → the row shows «сезонное» and not «хит»; GET confirms exactly
 *    [популярное, сезонное].
 * S3 `create-with-tag`: create a service from the blank form, pick tag1
 *    «новинка» via the typeahead, save → the row shows the chip and GET
 *    returns the link. Cleanup DELETEs the created service with the
 *    deferred-delete execute body — the tag link is a dependency, so the
 *    bare dry-run DELETE would only 409.
 * S4 `remove-all-tags`: s1 (tag2 + tag4) → remove both chips, save →
 *    neither tag in the row, GET returns [], success toast.
 *
 * Seed-picking note (verified against the live shard backend): a FULL PUT
 * on services whose tariffs are referenced by seed visits (s2/s3/s5/s7 —
 * visits ride the t2x/t3x/t5x/t7x tariff rows) fails with
 * INTEGRITY_VIOLATION — the canonical update hard-replaces tariffs
 * (delete+insert) and the live visits.tariff_id FK blocks the delete. That is pre-existing backend
 * behaviour outside #328's scope; S2/S4 therefore run on s1, whose
 * tariffs no visit references (t1*), and S1 on s4 (t4* likewise free).
 *
 * State restore (spec §6.4): RESET_SQL does not touch services /
 * service_tags, so every seed mutation is undone in `finally` with a FULL
 * PUT payload whose `tag_ids` come from the GET snapshot (`row.tags`) —
 * a partial PUT would itself wipe the tags (the very bug #328). No
 * sqlite reads: the GET body carries the eager-loaded `tags` (spec §2.6).
 */
import { test, expect } from './fixtures/test';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { waitForServicesReady, waitForToast } from './fixtures/helpers';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

/** Seed tag titles (seed.py `_seed_tags`: tag1..tag7). */
const TAG_TITLES = {
  news: 'новинка', // tag1
  hit: 'хит', // tag2
  kids: 'для детей', // tag3
  popular: 'популярное', // tag4
  seasonal: 'сезонное', // tag6
} as const;

/** Full service row as the GET endpoint returns it (fields we restore). */
interface ServiceRow {
  id: string;
  title: string;
  description: string;
  image_url: string;
  specialty: string;
  min_age: number;
  max_age: number | null;
  duration: number;
  record_info: string;
  tariffs: { title: string; description: string | null; price: number }[];
  tags: { id: string; title: string }[];
  materials: { id: string; note: string | null }[];
}

/** GET /api/v1/services/{id} — Node-side request context, bypasses the UI. */
async function getService(request: APIRequestContext, id: string): Promise<ServiceRow> {
  const resp = await request.get(`${BACKEND}/api/v1/services/${id}`);
  expect(resp.ok(), `GET /services/${id} must succeed`).toBeTruthy();
  return (await resp.json()) as ServiceRow;
}

/** Capture the CURRENT state of a service as a restorable snapshot.
 * Tag ids come straight from the GET body — it carries the eager-loaded
 * `tags` relation (spec §2.6; the old «tags arrives empty» comment in
 * services-null-max-age.spec.ts was a wrong-DB artefact, resolved). */
async function captureService(request: APIRequestContext, id: string) {
  const row = await getService(request, id);
  const tagIds = row.tags.map((t) => t.id);
  return { row, tagIds };
}

/** Map a GET response onto the exact ServiceUpdate shape (PUT forbids
 * extras). Material links ride the GET as `{id, note}` — the write shape
 * is `{material_id, note}`. Same mapping as the null-max-age canon. */
function toUpdatePayload(s: ServiceRow, tagIds: string[]) {
  return {
    title: s.title,
    description: s.description,
    image_url: s.image_url,
    specialty: s.specialty,
    min_age: s.min_age,
    max_age: s.max_age,
    duration: s.duration,
    record_info: s.record_info,
    tariffs: s.tariffs.map((t) => ({ title: t.title, description: t.description, price: t.price })),
    tag_ids: tagIds,
    materials: s.materials.map((m) => ({ material_id: m.id, note: m.note })),
  };
}

/** PUT the captured state back — undo every mutation the test made.
 * The payload is FULL and carries `tag_ids` from the snapshot: PUT is a
 * full-update canonical replace (a missing list would read as «wipe all»)
 * — restoring with a partial payload would re-inflict bug #328. */
async function restoreService(
  request: APIRequestContext,
  snapshot: { row: ServiceRow; tagIds: string[] },
): Promise<void> {
  const resp = await request.put(`${BACKEND}/api/v1/services/${snapshot.row.id}`, {
    data: toUpdatePayload(snapshot.row, snapshot.tagIds),
  });
  expect(resp.ok(), `restore PUT /services/${snapshot.row.id} must succeed: ${await resp.text()}`)
    .toBeTruthy();
}

/** Row of the service in the services table, anchored to the row testid
 * baked into the accessible name («… — строка s4») — the null-max-age
 * canon pattern (text filters alone are ambiguous). */
function serviceRow(page: Page, id: string) {
  return page.getByRole('row', { name: new RegExp(`строка ${id}$`) });
}

/** The top-level «Название» input (tariff items carry identical labels —
 * the top-level field renders first; index-0 convention of the canon). */
function titleInput(dialog: Locator) {
  return dialog.getByLabel('Название').first();
}

/** The top-level «Длительность» number input (label-bound). */
function durationInput(dialog: Locator) {
  return dialog.getByLabel('Длительность');
}

/** A selected-tag chip by its visible title inside the modal. */
function chip(dialog: Locator, title: string) {
  return dialog.getByText(title);
}

/** The chip removal button — aria-label `Удалить тег <title>` (spec §6.2). */
function removeTagButton(dialog: Locator, title: string) {
  return dialog.getByRole('button', { name: `Удалить тег ${title}` });
}

/** Add a tag through the RemoteSearchSelect typeahead: type ≥2 chars
 * (server `?q=` min-2 contract, debounce 300ms), pick the dropdown
 * option, then assert the chip appeared in the form. */
async function addTagViaSearch(page: Page, dialog: Locator, query: string, title: string) {
  const input = dialog.getByPlaceholder('Введите название тега...');
  await input.fill(query);
  const option = page.getByRole('option', { name: title, exact: true });
  await expect(option, `typeahead must offer «${title}» for «${query}»`).toBeVisible({
    timeout: 10_000,
  });
  await option.click();
  await expect(chip(dialog, title), `chip «${title}» appears after pick`).toBeVisible();
}

/** Enable the «Теги» column through the ColumnPicker (it is
 * defaultVisible:false). Idempotent per test: each test runs in a fresh
 * browser context (no persisted column set). The picker closes on
 * outside mousedown — click the page heading (inert) after toggling. */
async function enableTagsColumn(page: Page): Promise<void> {
  await page.click('[aria-label="Настроить колонки"]');
  await page.locator('label').filter({ hasText: /^Теги$/ }).click();
  await page.getByRole('heading', { name: 'Управление услугами' }).click();
  await expect(page.getByRole('columnheader', { name: 'Теги' })).toBeVisible({
    timeout: 10_000,
  });
}

/** Open the edit modal by clicking the service row; identity check via
 * the top-level title input carrying the service title (canon pattern). */
async function openServiceModal(page: Page, id: string, title: string) {
  await serviceRow(page, id).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await expect(titleInput(dialog)).toHaveValue(title, { timeout: 10_000 });
  return dialog;
}

test.describe('Services — ServiceModal tags S1–S4 (#328 §5)', () => {
  test('S1 edit-other-field-keeps-tags: duration-only save keeps the seed link alive', async ({
    page,
    request,
  }) => {
    const snapshot = await captureService(request, 's4');
    expect(
      snapshot.tagIds,
      'seed contract: s4 «Акварель» → tag3 «для детей» (created before the form opens)',
    ).toContain('tag3');
    try {
      await waitForServicesReady(page);
      await enableTagsColumn(page);

      // Seed link visible in the table BEFORE any mutation.
      await expect(
        serviceRow(page, 's4'),
        'S1: seed tag visible in the table before the edit',
      ).toContainText(TAG_TITLES.kids);

      const dialog = await openServiceModal(page, 's4', snapshot.row.title);
      await expect(
        chip(dialog, TAG_TITLES.kids),
        'S1: modal prefills the chip from service.tags',
      ).toBeVisible();

      // ACTION — touch ONLY «Длительность» (the #328 repro: an
      // unrelated-field save must not disturb the tag set).
      await durationInput(dialog).fill('160');
      await dialog.getByText('Сохранить').click();
      await waitForToast(page, 'Услуга обновлена');

      // VERIFY UI — the chip is still on the row after the save+refetch.
      await expect(
        serviceRow(page, 's4'),
        'S1: tag chip survives a duration-only save (table)',
      ).toContainText(TAG_TITLES.kids);

      // VERIFY API — the live link. Pre-fix the form PUT tag_ids:[] and
      // this GET would return no tags (the reported bug).
      const after = await getService(request, 's4');
      expect(after.duration, 'S1: the duration change landed').toBe(160);
      expect(after.title, 'S1: title untouched').toBe(snapshot.row.title);
      expect(
        after.tags.map((t) => t.id),
        'S1: GET returns the live service→tag link',
      ).toContain('tag3');
    } finally {
      await restoreService(request, snapshot);
    }
  });

  test('S2 swap-tag-set: remove A, add B via typeahead', async ({ page, request }) => {
    const snapshot = await captureService(request, 's1');
    expect(
      [...snapshot.tagIds].sort(),
      'seed contract: s1 «Картина маслом» → tag2 «хит» + tag4 «популярное»',
    ).toEqual(['tag2', 'tag4']);
    try {
      await waitForServicesReady(page);
      await enableTagsColumn(page);

      const dialog = await openServiceModal(page, 's1', snapshot.row.title);
      await expect(chip(dialog, TAG_TITLES.hit)).toBeVisible();

      // ACTION — remove chip A («хит»), add chip B («сезонное») through
      // the ≥2-char search; «популярное» stays untouched.
      await removeTagButton(dialog, TAG_TITLES.hit).click();
      await expect(chip(dialog, TAG_TITLES.hit), 'S2: chip A removed from the form').toHaveCount(0);
      await addTagViaSearch(page, dialog, 'сезон', TAG_TITLES.seasonal);

      await dialog.getByText('Сохранить').click();
      await waitForToast(page, 'Услуга обновлена');

      // VERIFY UI — B present in the row, A gone.
      const row = serviceRow(page, 's1');
      await expect(row, 'S2: new tag chip in the table').toContainText(TAG_TITLES.seasonal);
      await expect(row, 'S2: removed tag gone from the table').not.toContainText(TAG_TITLES.hit);

      // VERIFY API — the set was REPLACED (full-update PUT semantics):
      // exactly the untouched seed tag plus the newly picked one.
      const after = await getService(request, 's1');
      expect(
        after.tags.map((t) => t.title).sort(),
        'S2: GET returns exactly the new set',
      ).toEqual([TAG_TITLES.popular, TAG_TITLES.seasonal]);
    } finally {
      await restoreService(request, snapshot);
    }
  });

  test('S3 create-with-tag: a new service is born with a link', async ({ page, request }) => {
    const TITLE = 'E2E #328 create-with-tag';
    let createdId: string | null = null;
    try {
      await waitForServicesReady(page);
      await enableTagsColumn(page);

      // ACTION — blank form, minimal valid service, pick a tag in-form.
      await page.getByRole('button', { name: '+ Добавить услугу' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await titleInput(dialog).fill(TITLE);
      await durationInput(dialog).fill('90');
      await addTagViaSearch(page, dialog, 'новин', TAG_TITLES.news);
      await dialog.getByText('Сохранить').click();
      await waitForToast(page, 'Услуга создана');

      // Find the created id via the API list (no q= dependence).
      const listResp = await request.get(`${BACKEND}/api/v1/services?page=1&per_page=100`);
      expect(listResp.ok(), 'GET /services must succeed').toBeTruthy();
      const items = ((await listResp.json()) as { items?: ServiceRow[] }).items ?? [];
      createdId = items.find((s) => s.title === TITLE)?.id ?? null;
      expect(createdId, 'S3: the created service is listable').toBeTruthy();

      // VERIFY UI — toolbar search narrows the table to the new row; the
      // chip column shows the tag it was born with.
      await page.getByPlaceholder('Название...').fill(TITLE);
      await page.keyboard.press('Enter');
      const row = serviceRow(page, createdId!);
      await expect(row, 'S3: created row shows the tag chip').toContainText(TAG_TITLES.news);

      // VERIFY API — the link was created together with the service.
      const after = await getService(request, createdId!);
      expect(
        after.tags.map((t) => t.title),
        'S3: GET returns the created link',
      ).toEqual([TAG_TITLES.news]);
    } finally {
      if (createdId) {
        // Fresh service deps = just its tag links (service_tags, auto).
        // The bare DELETE is only a dry-run (409 + preview) — execute the
        // deferred-delete contract with the cascade resolution so the
        // created service and its link never leak past the run.
        const resp = await request.delete(`${BACKEND}/api/v1/services/${createdId}`, {
          data: { resolutions: { service_tags: 'cascade' } },
        });
        expect(resp.ok(), `cleanup DELETE /services/${createdId} must succeed`).toBeTruthy();
      }
    }
  });

  test('S4 remove-all-tags: both chips off, no links left, no errors', async ({ page, request }) => {
    const snapshot = await captureService(request, 's1');
    expect(
      [...snapshot.tagIds].sort(),
      'seed contract: s1 «Картина маслом» → tag2 «хит» + tag4 «популярное»',
    ).toEqual(['tag2', 'tag4']);
    try {
      await waitForServicesReady(page);
      await enableTagsColumn(page);

      const row = serviceRow(page, 's1');
      await expect(row, 'S4: both seed chips visible before the edit').toContainText(
        TAG_TITLES.hit,
      );
      await expect(row).toContainText(TAG_TITLES.popular);

      // ACTION — remove both chips, save the now-empty set.
      const dialog = await openServiceModal(page, 's1', snapshot.row.title);
      await removeTagButton(dialog, TAG_TITLES.hit).click();
      await removeTagButton(dialog, TAG_TITLES.popular).click();
      await expect(chip(dialog, TAG_TITLES.hit)).toHaveCount(0);
      await expect(chip(dialog, TAG_TITLES.popular)).toHaveCount(0);

      await dialog.getByText('Сохранить').click();
      // Success toast — the save itself raised no error.
      await waitForToast(page, 'Услуга обновлена');

      // VERIFY UI — neither tag in the row anymore.
      await expect(row, 'S4: «хит» gone from the row').not.toContainText(TAG_TITLES.hit);
      await expect(row, 'S4: «популярное» gone from the row').not.toContainText(TAG_TITLES.popular);

      // VERIFY API — zero links survive.
      const after = await getService(request, 's1');
      expect(after.tags, 'S4: GET returns an empty tag set').toEqual([]);
    } finally {
      await restoreService(request, snapshot);
    }
  });
});
