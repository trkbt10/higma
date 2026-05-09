/**
 * @file Public entry — programmatic API for fig-to-web.
 *
 * The package exposes three layers:
 *
 *   1. `fig-source` — load a `.fig` and walk it as raw FigNodes.
 *   2. `tokens` — extract design tokens (colors / typography /
 *      spacing / radii / shadows) and serialise them to CSS.
 *   3. `emit` — convert target frames into TSX file contents.
 *
 * The CLI lives in `./cli/bin.ts` and consumes only the public
 * functions re-exported below; downstream consumers can either go
 * through the CLI or call `emitFromFrames` directly to integrate the
 * generator into a larger build pipeline.
 */
export { findCanvas, findInternalCanvas, loadFigSource } from "./fig-source";
export type { FigSource } from "./fig-source";

export type {
  ColorToken,
  RadiusToken,
  ShadowToken,
  SpacingToken,
  TokenColor,
  TokenIndex,
  TokenSet,
  TypographyToken,
} from "./tokens";
export { buildTokensFromFrames, tokensToCss } from "./tokens";
export type { TokenBuildResult } from "./tokens";

export type {
  ComponentTarget,
  EmitFile,
  EmitRegistry,
  EmitResult,
  FrameTarget,
} from "./emit";
export {
  buildRegistry,
  emitFromFrames,
  listFrameTargets,
  pickFrameByName,
} from "./emit";

/**
 * Programmatic entry to the same pipeline `bin.ts` invokes from the
 * command line. Required by `@higma-tools/web-fig-roundtrip`'s
 * verifier, which needs to drive emit + bundle from inside a Node
 * process without spawning a child CLI.
 */
export { runCli, parseArgs, USAGE, CliUsageError } from "./cli";
export type { CliOptions, CliConsole } from "./cli";
