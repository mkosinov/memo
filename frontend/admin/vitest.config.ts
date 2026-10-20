import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// Pin tests to UTC for parity with CI runners. Set before workers spawn:
// forked test processes inherit the env, so this reaches every test file.
process.env.TZ = 'UTC';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      '@memo/api-client': path.resolve(__dirname, '../../packages/api-client/src/index.ts'),
      '@memo/domain': path.resolve(__dirname, '../../packages/domain/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    // Node's experimental built-in localStorage stub conflicts with the
    // jsdom environment; disable it so jsdom's own storage is used.
    execArgv: ['--no-experimental-webstorage'],
    setupFiles: ['__tests__/setup.ts'],
    globals: true,
    pool: 'forks',
    exclude: ['e2e/**', 'node_modules/**'],
    // Tests that render many DOM options (e.g. TimePicker with 1440 options)
    // can exceed the 5s default under load. 30s gives headroom without
    // hiding real timeouts.
    testTimeout: 30_000,
  },
});
