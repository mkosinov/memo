import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// Load .env.test so E2E tests use the test database (TEST_DB_PATH).
// The backend must also be started with ENV_FILE=.env.test.
// In CI, TEST_DB_PATH is set directly — file may not exist.
try {
  process.loadEnvFile(path.resolve(__dirname, '.env.test'));
} catch {
  // .env.test not found — rely on environment variables (CI)
}

// SHARD_PORT: dev server port. Default 3002 — NOT 3001, so the user's
// dev server (started by dev.sh on :3001) stays free for development
// while tests run. Override via env var for multi-shard setups.
const SHARD_PORT = process.env.SHARD_PORT || '3002';

/**
 * Playwright E2E configuration for Memo admin.
 * - Frontend: Next.js admin on port 3002 (or SHARD_PORT). NOT :3001,
 *   so the user's dev server (started by dev.sh on :3001) stays free
 *   for development while tests run.
 * - Backend:  FastAPI on port 8000
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
  // Visual regression runs locally (pre-push) — not skipped.
  // Baseline screenshots committed in *-snapshots/ directories.

  use: {
    baseURL: `http://localhost:${SHARD_PORT}`,
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },

  // Auto-start admin Next.js dev server for E2E tests.
  // When SHARD_PORT is set, starts a dev server on that port (per-shard).
  // reuseExistingServer: true so subsequent runs reuse the running server
  // (important for parallel shard runs where each shard has its own server).
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
