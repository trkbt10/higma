/**
 * @file Vite config for Fig editor E2E test server
 *
 * Isolated dev server on port 5192, serving the test harness
 * that renders FigEditor with a synthetic document.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname),
  server: {
    port: 5192,
  },
  resolve: {
    alias: {
      "@higuma/fig-editor": path.resolve(__dirname, "../../src"),
      "@higuma/editor-core": path.resolve(__dirname, "../../../editor-core/src"),
      "@higuma/editor-controls": path.resolve(__dirname, "../../../editor-controls/src"),
      "@higuma/ui-components": path.resolve(__dirname, "../../../ui-components/src"),
      "@higuma/fig": path.resolve(__dirname, "../../../fig/src"),
      "@higuma/fig-renderer": path.resolve(__dirname, "../../../fig-renderer/src"),
      "@higuma/fig-builder": path.resolve(__dirname, "../../../fig-builder/src"),
    },
  },
});
