/**
 * my-two-cookies.spec.ts — #584 §7 scenario 5: «человек с двумя учётками».
 *
 * One browser context carries BOTH session cookies:
 *   - `memo_client_session` — the project-default storageState (globalSetup
 *     logs seed client c1 «Анна Иванова» in via the real OTP flow, the
 *     #513 pattern);
 *   - `memo_staff_session` — seeded in-test: the REAL staff password login
 *     (seed demo master +79990000002) whose Set-Cookie is added to the
 *     context (cookie seeding per the #513/globalSetup storageState canon:
 *     domain+path form, HttpOnly preserved, SameSite=Lax holds — both
 *     apps and the API are 127.0.0.1, ports are exempt from the site
 *     definition).
 *
 * The scenario's three claims (spec §7.5):
 *   1. `/my` отдаёт ОБЕ роли — whoami answers 200 with the STAFF account
 *      as the primary identity and `roles: [master, client]` (§4.1: a
 *      role enters the list only via a valid cookie of its own audience;
 *      staff-side entries first).
 *   2. кабинет — по клиентской: the cabinet bootstrap (`GET /my/client`)
 *      keeps answering the CLIENT identity with the staff cookie present
 *      (the client guard reads only `memo_client_session`) — the shell
 *      renders c1's phone, not the master's.
 *   3. админка — по стафф-роли: the admin SPA bootstrap wire (Task 8:
 *      whoami → `GET /my/{branch}` by the staff role) answers 200 with
 *      the profile + permissions + master section; the foreign ADMIN
 *      branch stays 403 (§4.3 branch admission). The admin SPA itself
 *      lives on the admin stack — its rendering with the staff session is
 *      pinned by the admin-side specs (auth-session, master-role-smoke);
 *      this spec pins the exact wires that bootstrap it.
 *
 * RED vehicle: dropping the addCookies line (or the backend losing either
 * audience in the whoami) turns claim 1 red — the both-roles assert is
 * the discriminator, not a tautology over the storageState.
 */
import { test, expect } from 'playwright/test';
import { resolveBackendUrl } from './lib/backend-url';
import { resolveWebPort } from './lib/stack-port';

const BACKEND = resolveBackendUrl();

/** Seed demo master (#247 §3.11) — the «employee» half of the two
 * accounts. The web-e2e stack seeds the SAME backend seed as the admin
 * stacks, so the password login exists here too. */
const STAFF_PHONE = '+79990000002';
const STAFF_PASSWORD = 'master12345';

test.describe('#584 scenario 5 — two accounts, both cookies in one context', () => {
  // Runs with the project-default storageState: globalSetup's OTP login
  // as seed client c1 (+79001234567) — the client half of the pair.

  test('whoami returns both roles; cabinet by client; staff branch by staff cookie', async ({ page, request }) => {
    // ── Seed the staff half: the real password login (the same wire the
    //    admin /login form drives), Origin = the WEB origin (what a
    //    browser at this stack sends; the stack's CORS list carries it).
    const login = await request.post(`${BACKEND}/api/v1/auth/login`, {
      data: { phone: STAFF_PHONE, password: STAFF_PASSWORD },
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${resolveWebPort()}`,
        'Sec-Fetch-Site': 'same-origin',
      },
    });
    expect(login.status(), `staff login body: ${(await login.text()).slice(0, 120)}`).toBe(200);
    const setCookie = login.headers()['set-cookie'];
    expect(setCookie, 'the staff login must Set-Cookie').toBeTruthy();
    // #584 §2.6: the staff cookie is memo_staff_session.
    const staffToken = /memo_staff_session=([^;]+)/.exec(setCookie)![1];
    await page.context().addCookies([
      {
        name: 'memo_staff_session',
        value: staffToken,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      },
    ]);

    // ── Claim 1: `/my` отдаёт обе роли. The whoami rides BOTH cookies
    //    (page.request shares the context): the STAFF account is the
    //    primary identity (§4.1 — staff-first), the role list carries
    //    one entry per audience.
    const who = await page.request.get(`${BACKEND}/api/v1/my`);
    expect(who.status()).toBe(200);
    const whoBody = await who.json();
    expect(whoBody?.phone).toBe(STAFF_PHONE);
    expect(whoBody?.id).toBeTruthy();
    expect([...(whoBody?.roles ?? [])].sort()).toEqual(['client', 'master']);

    // ── Claim 2: кабинет — по клиентской. The cabinet bootstrap wire
    //    answers the CLIENT identity with both cookies present.
    const myClient = await page.request.get(`${BACKEND}/api/v1/my/client`);
    expect(myClient.status()).toBe(200);
    expect(await myClient.json()).toMatchObject({
      phone: '+79001234567',
      name: 'Анна Иванова',
    });
    // And the SHELL renders the client, not the master (the staff cookie
    // must not hijack the cabinet).
    await page.goto('/cabinet');
    await expect(page.locator('[data-testid="cabinet-logged-in"]')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="cabinet-phone"]')).toHaveText('+79001234567');

    // ── Claim 3: админка — по стафф-роли. The admin bootstrap's second
    //    wire (whoami picks the master branch for `"master" ∈ roles`):
    //    profile + account half + master section — 200 under BOTH
    //    cookies. The foreign admin branch: 403 (§4.3).
    const profile = await page.request.get(`${BACKEND}/api/v1/my/master`);
    expect(profile.status()).toBe(200);
    const prof = await profile.json();
    expect(prof?.role).toBe('master');
    expect(prof?.phone).toBe(STAFF_PHONE);
    expect(Array.isArray(prof?.permissions) && prof.permissions.length).toBeGreaterThan(0);
    expect(prof?.master_section).not.toBeNull();
    expect(prof?.first_name).toBe('Ольга');

    const foreignBranch = await page.request.get(`${BACKEND}/api/v1/my/admin`);
    expect(foreignBranch.status()).toBe(403);
  });
});
