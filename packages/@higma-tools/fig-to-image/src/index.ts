/**
 * @file Public surface of `@higma-tools/fig-to-image`.
 *
 * Streaming CLI + library that rasterises named frames / symbols
 * out of a `.fig` file into one image per node.
 *
 * Scope: this module exposes only the building blocks that own
 * no cross-package state — argument parsing, the CLI runner, the
 * fingerprint canonicaliser, and the PNG `tEXt` codec. The WebGL
 * rasterisation backend (`@higma-tools/web-fig-roundtrip`) lives
 * behind a `same-scope sibling` boundary; the CLI loads it via a
 * dynamic import at run time and never re-exports its types.
 * Callers that need direct access to the harness should import
 * `@higma-tools/web-fig-roundtrip/verify` themselves.
 */
export { runCli } from "./cli/run";
export type { CliConsole } from "./cli/run";
export { parseArgs, CliUsageError } from "./cli/args";
export type { CliOptions } from "./cli/args";
export { fingerprintFigSubtree } from "./fingerprint";
export type { FingerprintOptions } from "./fingerprint";
export { setTextMetadata, getTextMetadata } from "./png-meta";
