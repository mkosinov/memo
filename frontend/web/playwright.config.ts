import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3002',
    headless: true,
    viewport: { width: 1280, height: 720 },
    actionTimeout: 30000,
  },
  webServer: [
    {
      command: 'npx next dev -p 3002',
      port: 3002,
      reuseExistingServer: true,
      timeout: 60000,
    },
  ],
});
