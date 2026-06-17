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
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 30_000,
  // Skip visual regression tests in CI — they need baseline screenshots
  grep: process.env.CI ? /^(?!.*visual regression|.*schedule with activity|.*schedule — different|.*default state visual|.*menubar visual)/i : undefined,

  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
  },

  // Auto-start admin Next.js dev server for E2E tests
  webServer: {
    command: 'pnpm exec next dev -p 3001',
    url: 'http://localhost:3001',
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
