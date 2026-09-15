/**
 * cabinet.spec.ts — GH #262 User Scenarios S1–S6 (spec §7, binding).
 *
 * The user cabinet: the UserMenu popup (theme + «Мои данные» + «Сменить
 * пароль» + «Выйти»), theme persistence, the self-service profile form
 * (public card half + private user_profiles half), portrait upload, and the
 * cardless-user fallback.
 *
 * Isolation rules (the whole point of the dedicated users below):
 *  - NEVER mutate the shared seeded admin (+79990000001) or master
 *    (+79990000002): RESET_SQL does not restore passwords or names, and the
 *    globalSetup admin session must outlive every spec in the run. Each
 *    scenario therefore creates its OWN throwaway user/card.
 *  - S2 changes a password and S5 logs out — both would poison a shared
 *    account, so both run on a dedicated user.
 *  - The `request` fixture keeps the admin storageState (needed to create
 *    staff cards via POST /api/v1/staff). The PAGE logs in as the dedicated
 *    user after `clearCookies()` — a separate browser context, so the admin
 *    API session is never rotated/deleted (the staff-s7 login-probe lesson).
 *
 * Avatar note (S3): the served portrait URL is RELATIVE
 * (`/api/v1/files/avatar/…`) and the e2e stack splits the frontend
 * (SHARD_PORT) from the API (BACKEND_PORT) with no Next rewrite, so the
 * browser <img> cannot fetch the bytes cross-port. The assertion is therefore
 * DOM-level (the <img> carries the served src) + a direct backend GET proving
 * the file is stored and served — not a cross-origin pixel load.
 */
import { test, expect } from './fixtures/test';
import { request as apiRequest, type Page } from '@playwright/test';
import {
  cleanup,
  createTestStaff,
  seedUser,
  E2E_PASSWORD,
} from './fixtures/factories';
import { waitForStaffReady } from './fixtures/helpers';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

// Minimal valid-by-magic-bytes PNG (services/files.py sniffs only the 8-byte
// signature; it never decodes). Stays far under the 5 MB cap.
const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // ‰PNG....
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // ....IHDR
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
]);

let phoneCounter = 0;
/** A unique 11-digit RU phone per call (no collision across tests/shards). */
function uniquePhone(): string {
  phoneCounter += 1;
  return `+7995${String(Date.now()).slice(-7)}${phoneCounter}`.slice(0, 12);
}

/** A policy-valid throwaway password (8–64 chars), unique per scenario. */
function newPassword(): string {
  return `NewE2ePass${Date.now() % 1_000_000}`;
}

/**
 * Log the PAGE in as a dedicated user. Clears the inherited admin cookie
 * first (the `request` fixture keeps it for data creation), then drives the
 * /login form. Mirrors auth-login/auth-roles. Lands on `/` with the menubar.
 */
async function loginAsUser(page: Page, phone: string, password: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/login');
  // Cold-stack safety: /login is not in the shard warmup list, so the FIRST
  // spec to reach it triggers a Next.js dev compile + hydration that can
  // outlast the default 15s action timeout. Wait for the button to be
  // actionable (visible + stable) with generous headroom, then click — so
  // this helper is order-independent (first test or not).
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

/** Delete a throwaway user row (RESET_SQL never touches users/sessions). */
function deleteUser(phone: string): void {
  try { queryDBRow(`DELETE FROM users WHERE phone='${phone}'`); } catch { /* best-effort */ }
}

// ===========================================================================
// S1 — Cabinet popup + theme (spec §7.1)
// ===========================================================================
test.describe('S1 — cabinet popup + theme persistence', () => {
  test('plate opens a 4-item popup; theme switches instantly, survives reload; old slider gone', async ({ page }) => {
    const phone = uniquePhone();
    seedUser({ phone, role: 'master' }); // cardless → plate «Аноним»
    try {
      await loginAsUser(page, phone, E2E_PASSWORD);

      // The old standalone theme slider row is GONE from the left panel
      // (it moved into the popup, §5.1). Its old aria-label must not exist.
      await expect(page.getByRole('button', { name: 'Переключить тему' })).toHaveCount(0);

      // ── Expanded plate → popup with EXACTLY 4 items ──────────────────────
      const popup = await openUserMenu(page);
      const items = popup.locator('[role="menuitem"], [role="menuitemcheckbox"]');
      await expect(items).toHaveCount(4);
      // The four controls, in order: theme (checkbox item) + 3 menu items.
      await expect(popup.getByRole('menuitemcheckbox', { name: /Тема/ })).toHaveCount(1);
      await expect(popup.getByRole('menuitem', { name: 'Мои данные' })).toHaveCount(1);
      await expect(popup.getByRole('menuitem', { name: 'Сменить пароль' })).toHaveCount(1);
      await expect(popup.getByRole('menuitem', { name: 'Выйти' })).toHaveCount(1);

      // ── Theme switches INSTANTLY ─────────────────────────────────────────
      const themeRow = popup.getByRole('menuitemcheckbox', { name: /Тема/ });
      await expect(themeRow).toHaveAttribute('aria-checked', 'false'); // light
      await themeRow.click();
      await expect(themeRow).toHaveAttribute('aria-checked', 'true'); // dark
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      // The popup stays open on toggle (the user sees the palette switch).
      await expect(popup).toBeVisible();

      // ── Theme SURVIVES reload without a light flash ──────────────────────
      // The pre-hydration bootstrap script (app/layout.tsx) applies
      // data-theme from localStorage BEFORE React mounts, so the reloaded
      // document is dark from the first paint — never light-then-dark. (The
      // no-flash bootstrap is unit-pinned in __tests__/layout.theme-bootstrap
      // .test.ts; here we prove the end-state: a reload keeps the dark theme.)
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });

      // ── Collapsed sidebar: circular avatar trigger still opens the popup ──
      await page.getByRole('button', { name: 'Свернуть sidebar' }).click();
      // Collapsed plate = avatar-only circular trigger (no name text).
      const collapsedTrigger = page.getByRole('button', { name: 'Меню пользователя' });
      await expect(collapsedTrigger).toBeVisible();
      await expect(page.locator('[data-testid="user-avatar"]')).toBeVisible();
      await collapsedTrigger.click();
      const collapsedPopup = page.locator('[data-testid="user-menu-popup"]');
      await expect(collapsedPopup).toBeVisible({ timeout: 5_000 });
      await expect(
        collapsedPopup.locator('[role="menuitem"], [role="menuitemcheckbox"]'),
      ).toHaveCount(4);
      // Theme is still dark after the reload (aria-checked reflects state).
      await expect(
        collapsedPopup.getByRole('menuitemcheckbox', { name: /Тема/ }),
      ).toHaveAttribute('aria-checked', 'true');
    } finally {
      deleteUser(phone);
    }
  });
});

// ===========================================================================
// S2 — Change password (spec §7.2)
// ===========================================================================
test.describe('S2 — change password', () => {
  test('wrong old → field error; correct → toast + session alive; after logout old rejected, new accepted', async ({ page }) => {
    // Longest auth flow in the file: login + open menu + two change-password
    // submits (wrong then correct) + logout + two /login attempts. Headroom
    // for the cold-stack /login compile (the warmup list does not include it).
    test.setTimeout(120_000);

    const phone = uniquePhone();
    seedUser({ phone, role: 'master' });
    const next = newPassword();
    try {
      await loginAsUser(page, phone, E2E_PASSWORD);

      // ── Wrong current password → INLINE field error, nothing changes ─────
      let popup = await openUserMenu(page);
      await popup.getByRole('menuitem', { name: 'Сменить пароль' }).click();
      const modal = page.locator('[data-testid="password-modal"]');
      await expect(modal).toBeVisible({ timeout: 5_000 });

      await page.locator('[data-testid="password-current"]').fill('definitely-wrong-pass');
      await page.locator('[data-testid="password-new"]').fill(next);
      await page.locator('[data-testid="password-repeat"]').fill(next);
      await page.locator('[data-testid="password-submit"]').click();

      // Inline error on the current field (a normal flow, never a toast).
      await expect(page.locator('[data-testid="password-current-error"]'))
        .toContainText('Неверный пароль', { timeout: 10_000 });
      // Modal stays open; no success toast; still authenticated (menubar alive).
      await expect(modal).toBeVisible();
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible();

      // ── Correct change → toast «Пароль изменён», session stays alive ──────
      await page.locator('[data-testid="password-current"]').fill(E2E_PASSWORD);
      await page.locator('[data-testid="password-new"]').fill(next);
      await page.locator('[data-testid="password-repeat"]').fill(next);
      await page.locator('[data-testid="password-submit"]').click();

      await expect(page.locator('[data-testid="toast-success"]'))
        .toContainText('Пароль изменён', { timeout: 10_000 });
      // No redirect / no logout — the current session keeps working (D6).
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible();
      await expect(page).not.toHaveURL(/\/login/);

      // ── Logout, then the OLD password is rejected and the NEW accepted ────
      popup = await openUserMenu(page);
      await popup.getByRole('menuitem', { name: 'Выйти' }).click();
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

      // Old password → rejected (one wrong attempt, under the 3-strike ladder).
      await page.locator('#login-phone').fill(phone);
      await page.locator('#login-password').fill(E2E_PASSWORD);
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page.locator('[data-testid="login-error"]'))
        .toContainText('Неверный телефон или пароль', { timeout: 15_000 });
      await expect(page).toHaveURL(/\/login/);

      // New password → accepted, back in the app.
      await page.locator('#login-password').fill(next);
      await page.getByRole('button', { name: 'Войти' }).click();
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });
    } finally {
      deleteUser(phone);
    }
  });
});

// ===========================================================================
// S3 — Public part of «Мои данные» (spec §7.3)
// ===========================================================================
test.describe('S3 — edit name + portrait, specialty read-only', () => {
  test('name + portrait update plate and staff table; specialty read-only and unchanged', async ({ page, request }) => {
    // Heaviest scenario in the file: login + open menu + GET /my + name edit +
    // portrait upload (POST /my/portrait) + save (PUT /my) + plate refresh +
    // a second-page navigation to /staff. On a cold shard stack the route
    // compiles alone can eat the default 60s, so give this one headroom (the
    // scenario is cohesive per spec §7.3 — the staff-table check is binding).
    test.setTimeout(150_000);

    const phone = uniquePhone();
    const specialty = 'живопись, керамика';
    // The actor must be an ADMIN: it edits its own name/portrait via /my AND
    // then views the «Сотрудники» table to prove the row updated — and
    // GET /api/v1/staff is staff:read (admin-only, #247 default-deny). A
    // master-role user would 403 on the table. So: create the card WITH a
    // master section but NO account, then seed a dedicated ADMIN user linked
    // to that card (has_staff + has_master both true regardless of role).
    const staff = await createTestStaff(request, {
      first_name: 'Исходное',
      last_name: `Имя${Date.now()}`,
      master: { specialty, color: '#5B8C7A' },
    });
    seedUser({ phone, role: 'admin', masterId: staff.id });
    const newFirst = 'НовоеИмя';
    const newLast = `НоваяФамилия${Date.now()}`;
    try {
      await loginAsUser(page, phone, E2E_PASSWORD);

      // Plate shows the card name before the edit.
      await expect(page.locator('[data-testid="user-avatar"]').locator('..'))
        .toContainText('Исходное');

      const popup = await openUserMenu(page);
      await popup.getByRole('menuitem', { name: 'Мои данные' }).click();
      // MyDataModal renders `mydata-loading` first; `mydata-form` only mounts
      // once GET /my resolves — anchor on the form with a generous timeout
      // (the cold-stack GET can take a few seconds). Same pattern as S4/S6.
      const modal = page.locator('[data-testid="mydata-modal"]');
      await expect(page.locator('[data-testid="mydata-form"]')).toBeVisible({ timeout: 15_000 });

      // ── Specialty is READ-ONLY and shows the admin-owned CSV value ────────
      const specInput = page.locator('[data-testid="mydata-specialties"]');
      await expect(specInput).toBeVisible();
      await expect(specInput).toBeDisabled();
      await expect(specInput).toHaveValue(specialty);

      // ── Edit the public name half ────────────────────────────────────────
      await page.locator('[data-testid="mydata-first_name"]').fill(newFirst);
      await page.locator('[data-testid="mydata-last_name"]').fill(newLast);

      // ── Upload a portrait ────────────────────────────────────────────────
      await page.locator('[data-testid="mydata-portrait-file"]').setInputFiles({
        name: 'portrait.png',
        mimeType: 'image/png',
        buffer: PNG_BYTES,
      });
      // The preview <img> appears carrying the served avatar path. (Bytes are
      // not fetchable cross-port in the shard stack — assert the src, then
      // prove storage/serving with a direct backend GET below.)
      const preview = page.locator('[data-testid="mydata-avatar-preview"]');
      await expect(preview).toBeVisible({ timeout: 10_000 });
      const src = await preview.getAttribute('src');
      expect(src).toMatch(/^\/api\/v1\/files\/avatar\/.+\.png$/);

      // ── Save → toast, plate updates without a reload ─────────────────────
      await page.locator('[data-testid="mydata-submit"]').click();
      await expect(page.locator('[data-testid="toast-success"]'))
        .toContainText('Данные сохранены', { timeout: 10_000 });
      await expect(modal).toBeHidden({ timeout: 10_000 });

      // Plate now shows the NEW name (AuthContext.refresh after save).
      await expect(page.locator('[data-testid="user-avatar"]').locator('..'))
        .toContainText(newFirst, { timeout: 10_000 });

      // ── DB: the card name changed, the specialty is UNCHANGED (admin-owned) ─
      expect(queryDBRow(`SELECT first_name, last_name FROM staff WHERE id='${staff.id}'`))
        .toMatchObject({ first_name: newFirst, last_name: newLast });
      expect(queryDBRow(`SELECT specialty FROM masters WHERE staff_id='${staff.id}'`))
        .toMatchObject({ specialty });

      // ── The portrait file is stored AND publicly served by the backend ────
      const served = await request.get(`${BACKEND}${src}`);
      expect(served.ok(), 'portrait must be served by the backend').toBeTruthy();
      expect(served.headers()['content-type']).toContain('image/');

      // ── «Сотрудники» table reflects the new name ──────────────────────────
      await waitForStaffReady(page);
      const row = page.locator(`[data-testid="master-row-${staff.id}"]`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await expect(row).toContainText(newFirst);
      await expect(row).toContainText(newLast);
    } finally {
      deleteUser(phone);
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });
});

// ===========================================================================
// S4 — Private part of «Мои данные» (spec §7.4)
// ===========================================================================
test.describe('S4 — private fields persist; /my 401; /masters leaks nothing private', () => {
  test('private fields persist across reopen; anonymous /my 401; public /masters key set has no private keys', async ({ page, request }) => {
    const phone = uniquePhone();
    const staff = await createTestStaff(request, {
      first_name: 'Приватный',
      last_name: `Пользователь${Date.now()}`,
      master: { specialty: 'керамика', color: '#6B7E9C' },
      user: { phone, password: E2E_PASSWORD },
    });

    const patronymic = 'Сергеевна';
    const residence = 'ул. Тестовая, 1';
    const birthPlace = 'г. Москва';
    const seriesNumber = '4512 345678';
    const issuedDate = '2020-01-15';
    const issuedBy = 'ОВD Test';
    const registration = 'ул. Регистрации, 2';

    // Anonymous context for the no-session checks (the `request` fixture
    // carries the admin cookie; /my-without-session must be truly cookie-less).
    const anon = await apiRequest.newContext({
      baseURL: BACKEND,
      storageState: { cookies: [], origins: [] },
      extraHTTPHeaders: { Origin: BACKEND, 'Sec-Fetch-Site': 'same-origin' },
    });

    try {
      await loginAsUser(page, phone, E2E_PASSWORD);

      const popup = await openUserMenu(page);
      await popup.getByRole('menuitem', { name: 'Мои данные' }).click();
      await expect(page.locator('[data-testid="mydata-form"]')).toBeVisible({ timeout: 10_000 });

      // ── Fill the private half ────────────────────────────────────────────
      await page.locator('[data-testid="mydata-patronymic"]').fill(patronymic);
      // birth_date — read-only input driven by the CalendarPopover.
      await page.locator('[data-testid="mydata-birth_date-toggle"]').click();
      const popover = page.locator('[data-testid="calendar-popover"]');
      await expect(popover).toBeVisible({ timeout: 5_000 });
      await popover.getByRole('button', { name: '15', exact: true }).click();
      await expect(page.locator('[data-testid="mydata-birth_date"]')).not.toHaveValue('');

      await page.locator('[data-testid="mydata-residence_address"]').fill(residence);
      await page.locator('[data-testid="mydata-birth_place"]').fill(birthPlace);
      await page.locator('[data-testid="mydata-passport_series_number"]').fill(seriesNumber);
      await page.locator('[data-testid="mydata-passport_issued_date"]').fill(issuedDate);
      await page.locator('[data-testid="mydata-passport_issued_by"]').fill(issuedBy);
      await page.locator('[data-testid="mydata-registration_address"]').fill(registration);

      await page.locator('[data-testid="mydata-submit"]').click();
      await expect(page.locator('[data-testid="toast-success"]'))
        .toContainText('Данные сохранены', { timeout: 10_000 });
      await expect(page.locator('[data-testid="mydata-modal"]')).toBeHidden({ timeout: 10_000 });

      // ── Reopen → values persisted (proves the user_profiles row was written
      //    and GET /my returns it) ──────────────────────────────────────────
      const popup2 = await openUserMenu(page);
      await popup2.getByRole('menuitem', { name: 'Мои данные' }).click();
      await expect(page.locator('[data-testid="mydata-form"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="mydata-patronymic"]')).toHaveValue(patronymic);
      await expect(page.locator('[data-testid="mydata-residence_address"]')).toHaveValue(residence);
      await expect(page.locator('[data-testid="mydata-birth_place"]')).toHaveValue(birthPlace);
      await expect(page.locator('[data-testid="mydata-passport_series_number"]')).toHaveValue(seriesNumber);
      await expect(page.locator('[data-testid="mydata-passport_issued_date"]')).toHaveValue(issuedDate);
      await expect(page.locator('[data-testid="mydata-passport_issued_by"]')).toHaveValue(issuedBy);
      await expect(page.locator('[data-testid="mydata-registration_address"]')).toHaveValue(registration);

      // ── GET /api/v1/my WITHOUT a session → 401 (AUTH_UNAUTHORIZED) ────────
      const anonMy = await anon.get('/api/v1/my');
      expect(anonMy.status()).toBe(401);
      expect((await anonMy.json())?.detail?.code).toBe('AUTH_UNAUTHORIZED');

      // ── Public GET /api/v1/masters key set contains NO private field keys ──
      const mastersResp = await anon.get('/api/v1/masters');
      expect(mastersResp.ok()).toBeTruthy();
      const mastersJson = await mastersResp.json();
      const mastersList: any[] = mastersJson.items || mastersJson;
      expect(mastersList.length).toBeGreaterThan(0);
      const PRIVATE_KEYS = [
        'patronymic', 'birth_date', 'residence_address', 'birth_place',
        'passport_series_number', 'passport_issued_date', 'passport_issued_by',
        'registration_address', 'role',
      ];
      for (const m of mastersList) {
        const keys = Object.keys(m);
        for (const pk of PRIVATE_KEYS) {
          expect(keys, `public /masters must not expose "${pk}"`).not.toContain(pk);
        }
      }
    } finally {
      await anon.dispose();
      deleteUser(phone);
      await cleanup(request, `/api/v1/staff/${staff.id}`);
    }
  });
});

// ===========================================================================
// S5 — Logout from the popup (spec §7.5)
// ===========================================================================
test.describe('S5 — logout from the popup', () => {
  test('«Выйти» → /login; returning to /schedule redirects to /login', async ({ page }) => {
    const phone = uniquePhone();
    seedUser({ phone, role: 'master' });
    try {
      await loginAsUser(page, phone, E2E_PASSWORD);

      // A protected route renders the shell while the session is live.
      await page.goto('/schedule');
      await expect(page.locator('[data-testid="menubar"]')).toBeVisible({ timeout: 30_000 });

      const popup = await openUserMenu(page);
      await popup.getByRole('menuitem', { name: 'Выйти' }).click();
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

      // The session is dead: navigating back to /schedule bounces to /login.
      await page.goto('/schedule');
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    } finally {
      deleteUser(phone);
    }
  });
});

// ===========================================================================
// S6 — User WITHOUT a staff card (spec §7.6)
// ===========================================================================
test.describe('S6 — cardless user', () => {
  test('plate «Аноним» + initial; form = role + private fields only; private fields work', async ({ page }) => {
    const phone = uniquePhone();
    // noStaffId: true — forces staff_id NULL even though the factory default
    // is already NULL (explicit per spec §7.6 / plan T8).
    seedUser({ phone, role: 'admin', noStaffId: true });
    const patronymic = 'Безкарточный';
    try {
      await loginAsUser(page, phone, E2E_PASSWORD);

      // ── Plate shows «Аноним» + the initial avatar «А» (D9) ────────────────
      const plate = page.locator('[data-testid="user-avatar"]').locator('..');
      await expect(plate).toContainText('Аноним');
      await expect(page.locator('[data-testid="user-avatar"]')).toContainText('А');

      const popup = await openUserMenu(page);
      await popup.getByRole('menuitem', { name: 'Мои данные' }).click();
      await expect(page.locator('[data-testid="mydata-form"]')).toBeVisible({ timeout: 10_000 });

      // ── Form = role + private fields ONLY (no name / specialty / portrait) ─
      await expect(page.locator('[data-testid="mydata-role"]')).toHaveValue('admin');
      await expect(page.locator('[data-testid="mydata-first_name"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="mydata-last_name"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="mydata-specialties"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="mydata-portrait-block"]')).toHaveCount(0);
      // The private half IS present.
      await expect(page.locator('[data-testid="mydata-patronymic"]')).toBeVisible();

      // ── Private fields save and persist ──────────────────────────────────
      await page.locator('[data-testid="mydata-patronymic"]').fill(patronymic);
      await page.locator('[data-testid="mydata-submit"]').click();
      await expect(page.locator('[data-testid="toast-success"]'))
        .toContainText('Данные сохранены', { timeout: 10_000 });
      await expect(page.locator('[data-testid="mydata-modal"]')).toBeHidden({ timeout: 10_000 });

      const popup2 = await openUserMenu(page);
      await popup2.getByRole('menuitem', { name: 'Мои данные' }).click();
      await expect(page.locator('[data-testid="mydata-form"]')).toBeVisible({ timeout: 10_000 });
      await expect(page.locator('[data-testid="mydata-patronymic"]')).toHaveValue(patronymic);

      // Plate is STILL «Аноним» (a cardless user has no public name to show).
      await expect(plate).toContainText('Аноним');
    } finally {
      deleteUser(phone);
    }
  });
});
