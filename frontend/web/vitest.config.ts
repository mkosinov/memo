import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: ["./app/__tests__/**/*.test.{ts,tsx}", "./app/**/__tests__/**/*.test.{ts,tsx}"],
    pool: 'forks',
  },
  oxc: {
    jsx: {
      runtime: "automatic",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
      "@memo/api-client": path.resolve(__dirname, "../../packages/api-client/src/index.ts"),
    },
  },
});
