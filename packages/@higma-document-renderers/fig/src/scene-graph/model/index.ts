/**
 * @file Renderer scene model barrel.
 *
 * The package's `exports` map points `./scene-graph` directly at
 * `./types.ts`, so bun / vitest / tsc resolve through that target.
 * Tooling that does string-alias resolution does not consult the
 * `exports` map; it follows the alias to the directory and expects a
 * barrel here. Without this file renderer imports fail to resolve.
 *
 * Keep this barrel symmetric with what the `exports` map currently
 * targets: every name exported here must also be exported by
 * `types.ts` (or `blend-mode.ts`) so adding the barrel does not
 * widen the public API.
 */

export * from "./types";
export * from "./blend-mode";
