/**
 * user-settings-guarantee.spec.ts — GH #319 User Scenarios С1, С3, С5
 * (spec §7; plan Task 6). The settings-row guarantee e2e anchor.
 *
 * С1 — Создание с гарантией: an admin creates a staff card WITH an
 *      account → the UserSettings defaults row exists in the DB BEFORE
 *      the user ever logs in; the fresh user signs in (the session GET
 *      get-or-create reads the PRE-CREATED row), changes the theme
 *      (popup toggle + the patchUserSettings write corridor), reloads —
 *      the dark theme persists visually AND in the server row.
 * С3 — Сброс к дефолтам: the row is customized to dark (patchUserSettings
 *      corridor via the user's session — the theme field's server write
 *      path; the popup toggle drives #262's device-local memo-theme) →
 *      DELETE the row via the API → the next read (reload → get-or-create
 *      GET) returns defaults (light) and the row is recreated in the DB.
 * С5 — Каскад смерти: delete the staff card with an account → the DB has
 *      NEITHER the user row NOR the settings row (no orphans).
 *
 * Isolation rules (cabinet.spec.ts conventions): a dedicated throwaway
 * staff card + account per scenario; the PAGE logs in as the dedicated
 * user after `clearCookies()`; the `request` fixture keeps the admin
 * cookie for data creation. DB checks use the shared db-query helpers.
 * The server-theme write uses `page.request` (shares the page context's
 * logged-in user cookie — same write the frontend's patchUserSettings
 * makes; the decorational `memo-theme` localStorage is UIContext's).
 */
import { test, expect } from './fixtures/test';
import type { Page } from '@playwright/test';
import {
  createTestStaff,
  E2E_PASSWORD,
  cleanup,
} from './fixtures/factories';
import { queryDBRow, queryDBRows } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

let phoneCounter = 0;
/** A unique 11-digit RU phone per call (no collision across tests/shards). */
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7995${String(Date.now()).slice(-7)}${phoneCounter}`.slice(0, 12);
}

/**
 * Log the PAGE in as a dedicated user. Clears the inherited admin cookie
 * first, then drives the /login form (cabinet.spec.ts helper shape — the
 * cold-stack /login compile gets generous headroom).
 */
async function loginAsUser(page: Page, phone: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  const submit = page.getByRole('button', { name: 'Войти' });
  await expect(submit).toBeVisible({ timeout: 60_000 });
  await page.locator('#login-phone').fill(phone);
  await page.locator('#login-password').fill(password);
  await submit.click({ timeout: 30_000 });
  await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });
}

/** Open the UserMenu popup from the sidebar plate and return its locator. */
async function openUserMenu(page: Page) {
  const popup = page.locator('[data-testid="user-menu-popup"]');
  await page.getByRole('button', { name: 'Меню пользователя' }).click();
  await expect(popup).toBeVisible({ timeout: 5_000 });
  return popup;
}

/**
 * Toggle the theme row inside a freshly opened UserMenu popup (light →
 * dark): flips aria-checked, applies data-theme and memo-theme
 * localStorage (#262 visual theme persistence).
 */
async function toggleTheme(page: Page) {
  const popup = await openUserMenu(page);
  const themeRow = popup.getByRole('menuitemcheckbox', { name: /Тема/ });
  await themeRow.click();
  await expect(themeRow).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
}

/** Resolve the user id by phone (no /auth/me round-trip needed). */
function userIdByPhone(phone: string): string {
  const userRow = queryDBRow(`SELECT id FROM users WHERE phone='${phone}'`);
  expect(userRow).not.toBeNull();
  return String(userRow!.id);
}

// ===========================================================================
// С1 — Создание с гарантией (spec §7 С1)
// ===========================================================================
test.describe('GH #319 С1 — settings row exists before first login', () => {
  // Staff POST with an account hashes a password (argon2) — first-hit
  // cold-stack compile storms can push it past the default action cap.
  test.use({ actionTimeout: 60_000 });

  test('card with account → row pre-exists → login → theme change → reload → persisted', async ({ page, request }) => {
    test.setTimeout(150_000);

    // 1. SETUP — staff card WITH an account (the «учётка» flow; Task 2
    //    guarantees the settings row in the SAME transaction).
    const phone = uniquePhone();
    const staff = await createTestStaff(request, {
      first_name: 'Гарантия',
      last_name: `Настроек ${Date.now()}`,
      user: { phone, password: E2E_PASSWORD },
    });

    try {
      // 2. VERIFY DB — the settings row exists BEFORE the first login.
      const userId = userIdByPhone(phone);
      const settingsBefore = queryDBRow(
        `SELECT id, user_id, theme, language FROM user_settings WHERE user_id='${userId}'`,
      );
      expect(settingsBefore).toMatchObject({ user_id: userId, theme: 'light', language: 'ru' });
      const settingsId = String(settingsBefore!.id);

      // 3. ACTION — the fresh user signs in and changes the theme:
      //    the popup toggle (visual) + the patchUserSettings write into
      //    the pre-guaranteed row — WITHOUT any preliminary creation
      //    (the C1 guarantee: PATCH 200, never 404 SETTIGS_NOT_FOUND).
      await loginAsUser(page, phone, E2E_PASSWORD);
      await toggleTheme(page);
      const patch = await page.request.patch(`${BACKEND}/api/v1/user-settings`, {
        data: { theme: 'dark' },
      });
      expect(patch.status()).toBe(200);
      expect(queryDBRow(`SELECT theme FROM user_settings WHERE user_id='${userId}'`))
        .toMatchObject({ theme: 'dark' });

      // 4. ACTION — reload; the theme survives BOTH as the visible palette
      //    (memo-theme bootstrap) and in the server row (fresh GET reads
      //    the same persisted row — get-or-create does NOT re-create it).
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });

      const after = queryDBRow(
        `SELECT id, theme FROM user_settings WHERE user_id='${userId}'`,
      );
      expect(after).toMatchObject({ id: settingsId, theme: 'dark' });
    } finally {
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });
});

// ===========================================================================
// С3 — Сброс к дефолтам (spec §7 С3)
// ===========================================================================
test.describe('GH #319 С3 — DELETE resets settings to defaults', () => {
  test('theme change → DELETE row via API → next read returns defaults, row recreated', async ({ page, request }) => {
    test.setTimeout(150_000);

    // 1. SETUP — card WITH an account (the settings row exists pre-login).
    const phone = uniquePhone();
    const staff = await createTestStaff(request, {
      first_name: 'Сброс',
      last_name: `Дефолтов ${Date.now()}`,
      user: { phone, password: E2E_PASSWORD },
    });

    try {
      await loginAsUser(page, phone, E2E_PASSWORD);
      const userId = userIdByPhone(phone);

      // 2. ACTION — change the theme (patchUserSettings corridor). DB row
      //    becomes dark; its id is captured for the recreate check.
      const patch = await page.request.patch(`${BACKEND}/api/v1/user-settings`, {
        data: { theme: 'dark' },
      });
      expect(patch.status()).toBe(200);
      const darkRow = queryDBRow(`SELECT id, theme FROM user_settings WHERE user_id='${userId}'`);
      expect(darkRow).toMatchObject({ theme: 'dark' });
      const settingsId = String(darkRow!.id);

      // 3. ACTION — DELETE the row via the API (page.request shares the
      //    logged-in user's session → own row → 204).
      const del = await page.request.delete(`${BACKEND}/api/v1/user-settings/${settingsId}`);
      expect(del.status()).toBe(204);
      expect(queryDBRow(`SELECT id FROM user_settings WHERE user_id='${userId}'`)).toBeNull();

      // 4. ACTION/VERIFY — next read (reload) → defaults (light) back;
      //    capture the get-or-create GET's body directly.
      const getDone = page.waitForResponse(
        (resp) => resp.url().includes('/api/v1/user-settings')
          && resp.request().method() === 'GET'
          && resp.status() === 200,
        { timeout: 30_000 },
      );
      await page.reload();
      const getResp = await getDone;
      expect((await getResp.json()).theme).toBe('light');
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });

      // 5. VERIFY DB — the row is RECREATED with defaults (a NEW row id).
      const recreated = queryDBRow(
        `SELECT id, theme, language, column_order_staff, column_order_locations FROM user_settings WHERE user_id='${userId}'`,
      );
      expect(recreated).not.toBeNull();
      expect(recreated!.id).not.toBe(settingsId);
      expect(recreated).toMatchObject({
        theme: 'light',
        language: 'ru',
        column_order_staff: '[]',
        column_order_locations: '[]',
      });

      // 6. VERIFY CACHE — the GET response overwrote the localStorage cache
      //    (Task 5 §5.6: cache is always subordinate to the GET response).
      const cache = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('memo-user-settings') ?? '{}'),
      );
      expect(cache.theme).toBe('light');
      expect(cache.columnOrderMasters).toEqual([]);
    } finally {
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });
});

// ===========================================================================
// С5 — Каскад смерти (spec §7 С5)
// ===========================================================================
test.describe('GH #319 С5 — card delete cascades the account AND its settings', () => {
  test('create card with account → delete card → neither user nor settings row remains', async ({ request }) => {
    // 1. SETUP — card WITH an account (settings row guaranteed in-transaction).
    const phone = uniquePhone();
    const staff = await createTestStaff(request, {
      first_name: 'Каскад',
      last_name: `Настроек ${Date.now()}`,
      user: { phone, password: E2E_PASSWORD },
    });
    const userId = userIdByPhone(phone);

    try {
      // Precondition: both rows exist.
      expect(queryDBRow(`SELECT id FROM user_settings WHERE user_id='${userId}'`)).not.toBeNull();

      // 2. ACTION — delete the staff card (API; cascade-resolve like the
      //    factories cleanup helper: dry-run 409 → resolutions body).
      const dry = await request.delete(`${BACKEND}/api/v1/staff/${staff.id}`);
      const resolutions: Record<string, string> = {};
      if (dry.status() === 409) {
        const body = (await dry.json().catch(() => null)) as {
          dependencies?: Array<{ entity: string; allowed_actions?: string[] }>;
        } | null;
        for (const dep of body?.dependencies ?? []) {
          if ((dep.allowed_actions ?? []).includes('cascade')) {
            resolutions[dep.entity] = 'cascade';
          }
        }
      }
      const commit = await request.delete(`${BACKEND}/api/v1/staff/${staff.id}`, {
        data: Object.keys(resolutions).length > 0 ? { resolutions } : undefined,
      });
      expect(commit.status()).toBe(204);

      // 3. VERIFY DB — no orphans: the user AND its settings row are gone.
      expect(queryDBRow(`SELECT id FROM users WHERE phone='${phone}'`)).toBeNull();
      expect(queryDBRows(`SELECT * FROM user_settings WHERE user_id='${userId}'`)).toHaveLength(0);
    } finally {
      // The card is already hard-deleted on the passing path — best-effort.
      await cleanup(request, `/api/v1/staff/${staff.id}`);
      expect(queryDBRow(`SELECT id FROM staff WHERE id='${staff.id}'`)).toBeNull();
    }
  });
});
