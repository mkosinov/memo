import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// ── Per-shard environment variables ────────────────────────────────────────
// When run via test-all.sh, each shard sets:
//   SHARD_ID        — 1-5 (used by globalSetup/cleanTestData for DB path)
//   SHARD_PORT      — frontend port (3002-3006)
//   BACKEND_PORT    — backend port (8001-8005)
//   BACKEND_URL     — backend API URL for E2E factories
//   TEST_DB_PATH    — shard's SQLite DB path
//   NEXT_PUBLIC_API_URL — backend URL for browser (baked into Next.js bundle)
//
// When run standalone (not via test-all.sh), falls back to .env.test defaults.
// process.loadEnvFile does NOT override existing env vars, so shard vars win.

try {
  process.loadEnvFile(path.resolve(__dirname, '.env.test'));
} catch {
  // .env.test not found — rely on environment variables (CI)
}

const SHARD_PORT = process.env.SHARD_PORT || '3002';

/**
 * Playwright E2E configuration for Memo admin.
 *
 * Per-shard architecture (when run via test-all.sh):
 *   - Each shard gets its own Next.js (SHARD_PORT 3002-3006),
 *     FastAPI (BACKEND_PORT 8001-8005), and SQLite DB.
 *   - No cross-shard interference.
 *   - webServer finds the pre-started server via reuseExistingServer.
 *
 * Standalone mode (manual `playwright test`):
 *   - Single Next.js on :3002, single FastAPI on :8000.
 *   - Backwards compatible with .env.test.
 *
 * Browsers are pre-installed in the Docker image.
 * Do NOT run `npx playwright install` in worktrees.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/globalSetup'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 30_000,

  use: {
    baseURL: `http://localhost:${SHARD_PORT}`,
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },

  // Playwright validates webServer URL before running tests.
  // In per-shard mode: test-all.sh pre-starts the server, so
  // reuseExistingServer finds it. In standalone mode: Playwright
  // starts the server itself.
  webServer: {
    command: `pnpm exec next dev -p ${SHARD_PORT}`,
    url: `http://localhost:${SHARD_PORT}`,
    reuseExistingServer: true,
    cwd: '.',
  },

  projects: [
    {
      name: 'shard-services',
      testMatch: /services-crud\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'shard-schedule',
      testMatch: /schedule.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'shard-records',
      testMatch: /(records|activity-details-modal)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'shard-clients',
      testMatch: /clients\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'shard-rest',
      testMatch: /^((?!services|schedule|records|activity-details-modal|clients).)*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
