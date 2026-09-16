/**
 * auth-roles.spec.ts — GH #247 User Scenario 2, G2-revised (spec §6);
 * forbidden-write assertion re-targeted by GH #263 T8; nav expectations
 * re-targeted by GH #263 T9 (role menu): the master no longer sees the
 * admin-only sections (Клиенты link, Справочники minus Услуги, Мастера) —
 * S4 of the #263 design supersedes the #247 «identical nav» G2 decision.
 *
 * The user block shows the master's name. A forbidden write surfaces as
 * the standard error toast / API 403 — the enforcing layer.
 *
 * GH #263 T1 granted the master `payments:write` (scoped to own records),
 * so the original «payment POST → 403» expectation is obsolete BY DESIGN.
 * The scenario keeps its intent (master writes are LIMITED) via D7: client
 * mutations (PATCH /clients/{id}) stay admin-only → 403 AUTH_FORBIDDEN.
 */
import { test, expect } from './fixtures/test';
import { queryDBRow } from './fixtures/db-query';

const BACKEND = process.env.BACKEND_URL || 'http://127.0.0.1:8001';

test.describe('User Scenario 2 — master signs in (role menu)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('master signs in: role menu, own user block, client mutation rejected', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#login-phone').fill('+79990000002');
    await page.locator('#login-password').fill('master12345');
    await page.getByRole('button', { name: 'Войти' }).click();

    // Same app shell, role-filtered nav (GH #263 T9).
    await expect(page).toHaveURL(/\/$/);
    const menubar = page.locator('[data-testid="menubar"]');
    await expect(menubar).toBeVisible({ timeout: 30_000 });

    // Role-filtered nav (GH #263 T9): top-level items the master keeps —
    // Клиенты is ADMIN-ONLY now (S4b in master-role-menu.spec.ts pins its
    // absence); Услуги/Локации/Теги render only after the submenu expands.
    for (const label of ['Расписание', 'Записи', 'Фото']) {
      await expect(menubar.locator(`a[aria-label="${label}"]`)).toHaveCount(1);
    }
    await expect(menubar.locator('a[aria-label="Клиенты"]')).toHaveCount(0);
    const directoriesBtn = menubar.getByRole('button', { name: 'Справочники' });
    await expect(directoriesBtn).toHaveCount(1);
    await directoriesBtn.click();
    await expect(menubar.locator('a', { hasText: 'Услуги' }).first()).toBeVisible();
    // Локации/Теги/Сотрудники/Должности are admin-only — hidden (S4b).
    for (const label of ['Локации', 'Теги', 'Сотрудники', 'Должности']) {
      await expect(menubar.locator('a', { hasText: label })).toHaveCount(0);
    }
    await directoriesBtn.click();

    // User block: linked staff card (m1) → display name «Ольга Середа»
    // (snapshot first+last name, GH #262 §5.1). NO role label — removed by
    // the cabinet spec rev 3 (D1: the plate shows avatar + name only).
    const userBlock = page.locator('[data-testid="user-avatar"]').locator('..');
    await expect(userBlock).toContainText('Ольга Середа');

    // Forbidden write (GH #263 D7): a CLIENT mutation stays admin-only —
    // the master session PATCHing an existing client is rejected 403
    // AUTH_FORBIDDEN. API-level via page.request (shares the context's
    // session cookie + correct fetch metadata), same style as
    // auth-session.spec.ts. The target is a seeded client (c1..c5), so the
    // master legitimately reads it (200 scoped+masked) but may not mutate.
    const me = await page.request.get(`${BACKEND}/api/v1/auth/me`);
    expect(me.ok()).toBeTruthy();

    const seed = queryDBRow(
      `SELECT id FROM clients WHERE id IN ('c1','c2','c3','c4','c5') ORDER BY id LIMIT 1`,
    ) as unknown as { id: string } | null;
    test.skip(!seed, 'seed clients c1..c5 missing (DB reset drifted)');

    const patchResp = await page.request.patch(`${BACKEND}/api/v1/clients/${seed!.id}`, {
      data: { name: 'Взлом имени' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(patchResp.status()).toBe(403);
    const errBody = await patchResp.json();
    expect(errBody?.detail?.code ?? errBody?.code).toBe('AUTH_FORBIDDEN');
    expect(errBody?.detail?.message ?? errBody?.message).toBe('Недостаточно прав');

    // The DB is unchanged — the forbidden write never landed.
    const row = queryDBRow(
      `SELECT name FROM clients WHERE id='${seed!.id}'`,
    ) as unknown as { name: string };
    expect(row?.name).not.toBe('Взлом имени');
  });
});
