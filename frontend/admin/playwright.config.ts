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
 * - Frontend: Next.js admin on port 3002
 * - Backend:  FastAPI on port 8000
 * Browsers are pre-installed in the Docker image.
 * Do NOT run `npx playwright install` in worktrees.
 *
 * NOTE: port 3002 avoids conflict with other worktrees (admin-clients
 * uses 3001). In CI both dev-server and backend are started externally.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 30_000,
  // Skip visual regression tests in CI — they need baseline screenshots
  grep: process.env.CI ? /^(?!.*visual regression)/i : undefined,

  use: {
    baseURL: 'http://localhost:3002',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },

  // Auto-start admin Next.js dev server for E2E tests
  webServer: {
    command: 'npx next dev -p 3002',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    cwd: '.',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
