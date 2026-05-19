/**
 * @file Public entry — programmatic API for fig-to-swiftui.
 *
 * The package exposes the SwiftUI emitter and CLI. `.fig` loading,
 * canvas lookup, and symbol resolution are owned by
 * `@higma-document-io/fig/context`; callers import that SoT directly.
 *
 *   1. `emit` — convert target frames to Swift files (one struct per frame).
 *   2. `cli` — the argv parser + runtime that drives the pipeline.
 */
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
