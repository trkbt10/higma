/**
 * @file Playwright configuration for the operator-perspective audit.
 *
 * Targets the already-running dev server on http://localhost:5175 (the same
 * URL the human operator uses) so the layout-level breakages the user
 * actually sees are the ones the tests can observe. There is no
 * `webServer` block — start the dev server manually with
 * `bun run dev` from packages/@higma-document-editors/fig before running.
 */
import { defineConfig } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: __dirname,
  testMatch: "**/*.audit.ts",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5175",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "off",
    screenshot: "only-on-failure",
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  outputDir: resolve(__dirname, "results"),
});
