import { defineConfig, devices } from '@playwright/test';
import path from 'path';

// ── Per-shard environment variables ────────────────────────────────────────
// When run via test-all.sh, each shard sets:
//   SHARD_ID        — 1-2 (used by globalSetup/cleanTestData for DB path)
//   SHARD_PORT      — frontend port (3002-3003)
//   BACKEND_PORT    — backend port (8001-8002)
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
 *   - 2 shards, each with its own Next.js (SHARD_PORT 3002-3003),
 *     FastAPI (BACKEND_PORT 8001-8002), and SQLite DB.
 *   - No cross-shard interference.
 *   - webServer finds the pre-started server via reuseExistingServer.
 *   - 2 shards instead of 5 to avoid CPU contention on 4-core machines
 *     (5 parallel Next.js dev servers caused 30s+ page loads).
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
  workers: 1,
  reporter: 'list',
  // Generous timeouts — 2 Next.js dev servers on 4 cores may still be slow
  // on first compilation. 60s test timeout + 60s navigation gives headroom.
  timeout: 60_000,

  use: {
    baseURL: `http://localhost:${SHARD_PORT}`,
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 720 },
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
  },
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      // Declarative invariant: hide the Next.js dev-overlay (hydration-error
      // toast) at screenshot time, in every current and future visual shot.
      stylePath: './e2e/fixtures/hide-dev-overlay.css',
    },
  },

  // Playwright validates webServer URL before running tests.
  // In per-shard mode: test-all.sh pre-starts the server, so
  // reuseExistingServer finds it. In standalone mode: Playwright
  // starts the server itself.
  //
  // IMPORTANT: In shard mode (SHARD_ID set), we skip the webServer config
  // entirely. The shard stack already has a server running on SHARD_PORT,
  // and Playwright's reuseExistingServer health check is unreliable under
  // load — it sometimes fails, causing EADDRINUSE when Playwright tries
  // to start a second Next.js on the same port.
  ...(process.env.SHARD_ID ? {} : {
    webServer: {
      command: `pnpm exec next dev -p ${SHARD_PORT}`,
      url: `http://localhost:${SHARD_PORT}`,
      reuseExistingServer: true,
      cwd: '.',
    },
  }),

  // 2 shards instead of 5 to avoid CPU contention on 4-core machines.
  // Shard 1: schedule-heavy tests (services, schedule, records, activity-details)
  //   — all share schedule page data, heavy per-test.
  // Shard 2: everything else (clients, masters, locations, tags, photos, etc.)
  //   — lighter per-test, more files.
  projects: [
    {
      name: 'shard-schedule',
      // records.* — records page specs (records.spec.ts, records-view.spec.ts, …).
      // Filename-anchored ((^|\/)…$ + [^/]*) so the patterns match the spec
      // FILE name, not an arbitrary path segment — Playwright tests these
      // regexes against the absolute path, and a worktree directory named
      // e.g. records-view-213 would otherwise sweep every spec in here.
      testMatch: /(^|\/)(services-crud|schedule[^/]*|records[^/]*|activity-details-modal)\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'shard-rest',
      // Everything whose FILE NAME does not belong to the schedule shard
      // (same filename-anchoring rationale as above).
      testMatch: /^(?!.*(\/|^)(services-crud|schedule|records|activity-details-modal)[^/]*\.spec\.ts$).*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
