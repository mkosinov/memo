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

/**
 * Playwright E2E configuration for Memo admin.
 * - Frontend: Next.js admin on port 3001
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
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },

  // Auto-start admin Next.js dev server for E2E tests
  webServer: {
    command: 'pnpm exec next dev -p 3001',
    url: 'http://localhost:3001',
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
