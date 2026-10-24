import { defineConfig, devices } from 'playwright/test';
import path from 'path';
import { clientAuthStatePath } from './e2e/fixtures/client-auth-state';
import { resolveBackendUrl } from './e2e/lib/backend-url';
import { resolveWebPort } from './e2e/lib/stack-port';

// ── Web-e2e stack environment (#513 Task 6) ────────────────────────────────
// When run via scripts/test-e2e.sh (or scripts/e2e-stack.sh directly), the
// stack exports:
//   E2E_STACK        — '1': the stack pre-started web+backend, webServer
//                      config is SKIPPED (the admin SHARD_ID pattern —
//                      reuseExistingServer's health check is unreliable
//                      under load and can EADDRINUSE a second dev server)
//   WEB_PORT         — web dev-server port (dynamic 28000-32700 window)
//   BACKEND_URL      — backend API URL for fixtures
//   NEXT_PUBLIC_API_URL — backend URL for the browser (same host as
//                      BACKEND_URL; baked into the Next bundle)
//   TEST_DB_PATH     — the run's SQLite DB (backend/test_memo_web_<tag>.db)
//   SHARD_RUN_TAG    — 6-hex run tag (lease/port/DB/storageState scope)
//
// Standalone (manual `playwright test`): falls back to .env.test + the
// WEB_PORT default 3007 (off every reserved range — see stack-port.ts).

try {
  process.loadEnvFile(path.resolve(__dirname, '.env.test'));
} catch {
  // .env.test not found — rely on environment variables (CI)
}

// GH #387 (web port of the admin fence): the EARLIEST guard — refuse a
// bare run before the webServer even starts. Both URL vars must be
// present and share one host (SameSite=Lax memo_client_session cookie).
// Stack mode exports both — a no-op there.
resolveBackendUrl();

const WEB_PORT = resolveWebPort();

// #513: globalSetup logs the seed client (c1 «Анна Иванова», #523 OTP
// flow: phone → code read from the test DB → verify) in and saves the
// `memo_client_session` cookie here; the project starts authenticated.
// Login-flow specs opt out with `test.use({ storageState: { cookies: [],
// origins: [] } })` — a bare `undefined` does NOT override a
// project-level default (admin donor lesson). The filename is
// run-tag-scoped (parallel runs carry separate DBs/stacks and must never
// read a foreign-DB session).
const CLIENT_STORAGE_STATE = clientAuthStatePath();

export default defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/globalSetup'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { outputFolder: process.env.E2E_REPORT_DIR ?? 'playwright-report' }],
    ['json', { outputFile: process.env.E2E_RESULTS_JSON ?? 'results.json' }],
  ],
  // Generous timeouts — the first hit on a Next dev-server route compiles
  // it (20s+ under load); the admin config's headroom applies here too.
  timeout: 60_000,

  use: {
    // Pages and the API must be SAME-SITE for the HttpOnly SameSite=Lax
    // memo_client_session cookie to flow (site = scheme+host, ports
    // ignored): BACKEND_URL is 127.0.0.1, so the web base is 127.0.0.1
    // too — localhost would make every API fetch cross-site (the cookie
    // silently drops) and trip the backend Origin-vs-CORS line.
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    timezoneId: 'UTC',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
  },
  expect: {
    timeout: 10_000,
  },

  // Stack mode (E2E_STACK=1): the stack already has web+backend running
  // on WEB_PORT/BACKEND_PORT — no webServer (the admin SHARD_ID pattern).
  // Standalone: Playwright starts the web dev server itself, reusing one
  // already on the port. NOTE: the standalone backend is NOT started by
  // Playwright — see the recipe in e2e/lib/backend-url.ts.
  ...(process.env.E2E_STACK ? {} : {
    webServer: {
      command: `pnpm exec next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: true,
      cwd: '.',
    },
  }),

  // ONE project — the web cabinet specs. No visual project yet (web has
  // no snapshot baselines; arrive with a future task if ever).
  projects: [
    {
      name: 'e2e',
      use: { ...devices['Desktop Chrome'], storageState: CLIENT_STORAGE_STATE },
    },
  ],
});
