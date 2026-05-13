/**
 * @file Scene-graph barrel — re-exports the public surface so consumers
 * can `import … from "@higma-document-models/fig/scene-graph"` regardless
 * of which resolver they go through.
 *
 * The package's `exports` map points `./scene-graph` directly at
 * `./types.ts`, so bun / vitest / tsc resolve through that target.
 * Tooling that does *string-alias* resolution (the e2e Vite dev server
 * config under `@higma-document-editors/fig/spec/e2e/vite.config.ts`,
 * for example) does NOT consult the `exports` map; it follows the
 * alias to the directory and expects a barrel here. Without this
 * file every `import … from "@higma-document-models/fig/scene-graph"`
 * inside renderer code (`scene-graph/builder.ts`,
 * `svg/scene-renderer.ts`, the WebGL specs, …) fails to resolve in
 * the e2e harness and the entire Playwright suite times out.
 *
 * Keep this barrel symmetric with what the `exports` map currently
 * targets: every name exported here must also be exported by
 * `types.ts` (or `blend-mode.ts`) so adding the barrel does not
 * widen the public API.
 */

export * from "./types";
export * from "./blend-mode";
