/**
 * @file Root Vitest workspace configuration.
 *
 * Each package has its own vitest.config.ts. This file exists for
 * running tests from the root via `bun run test`.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/*/src/**/*.{ts,tsx}"],
    },
  },
});
