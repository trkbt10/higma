/** @file Playwright configuration for higma-vsc-plugin webview E2E tests. */
import { defineConfig } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 5193;

export default defineConfig({
  testDir: resolve(__dirname, "spec/e2e"),
  testMatch: "**/*.e2e.ts",
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 720 },
  },
  webServer: {
    command: `bunx vite --config spec/e2e/vite.config.ts --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
    cwd: __dirname,
  },
});
