/**
 * @file Root Vitest workspace configuration.
 *
 * Each package has its own vitest.config.ts. This file exists for
 * running tests from the root via `bun run test`.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function rootPath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      react: rootPath("./node_modules/react"),
      "react-dom": rootPath("./node_modules/react-dom"),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    globals: true,
    environment: "node",
    setupFiles: [
      rootPath("./packages/@higma-editor-kernel/ui/src/test/setup.ts"),
      rootPath("./packages/@higma-editor-surfaces/controls/src/test/setup.ts"),
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["packages/@higma/*/src/**/*.{ts,tsx}"],
    },
  },
});
