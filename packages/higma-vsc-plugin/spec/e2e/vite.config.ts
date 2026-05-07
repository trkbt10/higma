/**
 * @file Vite config for higma-vsc-plugin webview E2E test server.
 *
 * Serves the same `webview/index.tsx` that the VS Code extension
 * loads inside its custom editor webview, but with `acquireVsCodeApi`
 * stubbed via `harness.tsx`. Source aliases route every workspace
 * `@higma-*` package to its `src/` so we exercise the live source
 * tree (matching the editor's E2E pattern).
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(here, "../../../..");
const packagesRoot = resolve(workspaceRoot, "packages");

export default defineConfig({
  plugins: [react()],
  root: here,
  server: {
    port: 5193,
    strictPort: true,
    fs: {
      allow: [workspaceRoot],
    },
  },
  resolve: {
    alias: {
      "@higma-document-io/fig": resolve(packagesRoot, "@higma-document-io/fig/src"),
      "@higma-document-models/fig": resolve(packagesRoot, "@higma-document-models/fig/src"),
      "@higma-document-renderers/fig": resolve(packagesRoot, "@higma-document-renderers/fig/src"),
      "@higma-figma-runtime/react-renderer": resolve(packagesRoot, "@higma-figma-runtime/react-renderer/src"),
      "@higma-primitives/tree": resolve(packagesRoot, "@higma-primitives/tree/src"),
      "@higma-primitives/buffer": resolve(packagesRoot, "@higma-primitives/buffer/src"),
      "@higma-codecs/png": resolve(packagesRoot, "@higma-codecs/png/src"),
    },
  },
  optimizeDeps: {
    exclude: [
      "@higma-document-io/fig",
      "@higma-document-models/fig",
      "@higma-document-renderers/fig",
      "@higma-figma-runtime/react-renderer",
      "@higma-primitives/tree",
      "@higma-primitives/buffer",
      "@higma-codecs/png",
    ],
  },
  assetsInclude: ["**/*.fig"],
});
