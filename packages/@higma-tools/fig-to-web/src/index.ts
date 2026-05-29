/**
 * @file Public entry — programmatic API for fig-to-web.
 *
 * The package exposes two layers. Loading a `.fig` byte buffer is an
 * IO concern owned by `@higma-document-io/fig/context`; consumers call
 * `createFigDocumentContext` there and pass the resulting context into
 * this package.
 *
 *   1. `tokens` — extract design tokens (colors / typography /
 *      spacing / radii / shadows) and serialise them to CSS.
 *   2. `emit` — convert target frames into TSX file contents.
 */
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
  LayoutSizing,
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
