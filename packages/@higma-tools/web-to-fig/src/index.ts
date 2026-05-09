/**
 * @file `@higma-tools/web-to-fig` public entry — programmatic API
 * for capturing a live web viewport and emitting a `.fig` file.
 *
 * Layered like `@higma-tools/fig-to-web` but in the inverse direction:
 *
 *   1. `web-source` — drive Playwright to capture a `RawViewportSnapshot`.
 *   2. `normalize`  — translate the snapshot into the shared
 *                     `@higma-bridges/web-fig` IR.
 *   3. `emit`       — convert the IR into a FigDesignDocument and
 *                     export `.fig` bytes via `@higma-document-io/fig`.
 *
 * The shared IR is the contract that pairs this tool with
 * `@higma-tools/fig-to-web`: any IR `@higma-tools/web-to-fig` produces
 * is a valid input for the inverse direction (and vice versa).
 */
export type { Breakpoint, CaptureOptions, CaptureResult, CapturedBreakpoint, MultiCaptureOptions, RawViewportSnapshot } from "./web-source";
export { DEFAULT_BREAKPOINTS, captureMultiViewport, captureViewport, jsonToSnapshot } from "./web-source";

export { normalizeViewport } from "./normalize";

export type { BuildDocumentResult, EmitFigOptions, EmitFigResult, MultiFigBuildResult } from "./emit";
export { buildDocument, buildMultiFigFileBytes, emitFig, irToSpecGraph } from "./emit";

export type { ComparisonOutcome, RenderedFrame, VerificationReport, VerifiedBreakpoint } from "./verify";
export { comparePng, renderFigBytes, verifyFidelity } from "./verify";

export { CliUsageError, parseArgs, runCli } from "./cli";
