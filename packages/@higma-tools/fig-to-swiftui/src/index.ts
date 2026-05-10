/**
 * @file Public entry — programmatic API for fig-to-swiftui.
 *
 * The package exposes three layers (the `findCanvas` /
 * `findInternalCanvas` helpers live in `@higma-document-io/fig/context`
 * — the no-cross-package-reexport rule forbids re-exporting them
 * here, so consumers import them from that package directly):
 *
 *   1. `loadFigSource` — load a `.fig` buffer into a symbol-resolved
 *      context. Defined locally because the rule also forbids
 *      re-exporting `createFigSymbolContext`.
 *   2. `emit` — convert target frames to Swift files (one struct per frame).
 *   3. `cli` — the argv parser + runtime that drives the pipeline.
 */
export { loadFigSource } from "./fig-source/load";

export type { FrameTarget, SwiftFile, EmitResult } from "./emit";
export {
  buildFrameTarget,
  emitFrameFile,
  emitFromFrames,
  emitNode,
  emitRootFrame,
  listFrameTargets,
  pickFrameByName,
} from "./emit";

export { runCli, parseArgs, USAGE, CliUsageError } from "./cli";
export type { CliOptions, CliConsole, CliMode } from "./cli";
