/**
 * @file Public entry — programmatic API for fig-to-web.
 *
 * The package exposes three layers (the `findCanvas` /
 * `findInternalCanvas` helpers live in `@higma-document-io/fig/context`
 * — the no-cross-package-reexport rule forbids re-exporting them
 * here, so consumers import them from that package directly):
 *
 *   1. `loadFigSource` — load a `.fig` buffer into a symbol-resolved
 *      context. Defined locally because the rule also forbids
 *      re-exporting `createFigSymbolContext`.
 *   2. `tokens` — extract design tokens (colors / typography /
 *      spacing / radii / shadows) and serialise them to CSS.
 *   3. `emit` — convert target frames into TSX file contents.
 */
export { loadFigSource } from "./fig-source/load";
// `FigSymbolContext` (the type returned by `loadFigSource`) lives in
// `@higma-document-io/fig/context` — consumers must import it directly.

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
  AssetStrategy,
  ComponentTarget,
  CssImportStrategy,
  CssMode,
  EmitFile,
  EmitFromFramesOptions,
  EmitRegistry,
  EmitResult,
  ExportStyle,
  FrameTarget,
  VariantStrategy,
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
