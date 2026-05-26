/**
 * @file Vite config for the web-fig-roundtrip WebGL harness.
 *
 * Mirrors the harness used by `@higma-document-renderers/fig`'s WebGL
 * parity tests — minimal page + WebGLFigmaRenderer entry point that
 * exposes a single `globalThis.renderSceneGraph(json)` surface for
 * the verifier to call.
 */
import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname),
  server: {
    port: 0,
    strictPort: false,
  },
});
