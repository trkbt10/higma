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
      "@higma-document-editors/fig": path.resolve(__dirname, "../../src"),
      "@higma-editor-kernel/core": path.resolve(__dirname, "../../../../-editor/core/src"),
      "@higma-editor-surfaces/controls": path.resolve(__dirname, "../../../../-editor/controls/src"),
      "@higma-editor-kernel/ui": path.resolve(__dirname, "../../../../-editor/ui/src"),
      "@higma-document-models/fig": path.resolve(__dirname, "../../../../-document-models/fig/src"),
      "@higma-document-renderers/fig": path.resolve(__dirname, "../../../../-document-renderers/fig/src"),
      "@higma-document-io/fig": path.resolve(__dirname, "../../../../-document-io/fig/src"),
    },
  },
});
