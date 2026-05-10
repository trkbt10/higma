/**
 * @file Public entry — programmatic API for fig-to-godot.
 *
 * The package exposes two layers (the ".fig load + canvas lookup"
 * helpers live in `@higma-document-io/fig/context`; the boundary rule
 * forbids re-exporting them from a tools-scope package):
 *
 *   1. `loadFigSource` — load a `.fig` buffer into a symbol-resolved
 *      context. Thin alias for `createFigSymbolContext` exposed under
 *      a converter-friendly name; this is the only `fig-source` symbol
 *      the package owns.
 *   2. `emit` — convert target frames to Godot scene files (one
 *      `.tscn` per frame).
 *   3. `cli` — the argv parser + runtime that drives the pipeline.
 *
 * Consumers that need `findCanvas` / `findInternalCanvas` should
 * import them directly from `@higma-document-io/fig/context`.
 */
export { loadFigSource } from "./fig-source/load";

export type { FrameTarget, GodotFile, EmitResult } from "./emit";
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
