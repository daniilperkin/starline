import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["packages/*/src/**/*.test.ts", "packages/*/tests/**/*.test.ts"],
          exclude: ["packages/driver-wasm/tests/**"],
          environment: "node",
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        extends: true,
        optimizeDeps: {
          include: ["@sqlite.org/sqlite-wasm"],
        },
        test: {
          name: "browser",
          include: ["packages/driver-wasm/tests/**/*.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 120_000,
          browser: {
            enabled: true,
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
