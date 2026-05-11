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
export type { Breakpoint, CaptureOptions, CaptureResult, CapturedBreakpoint, CdpExtractOptions, ExtractOptions, ExtractResult, MultiCaptureOptions, RawViewportSnapshot, UrlExtractOptions } from "./web-source";
export { DEFAULT_BREAKPOINTS, captureMultiViewport, captureViewport, captureViewportInBrowser, extractElement, jsonToSnapshot, launchBrowser } from "./web-source";

export { normalizeViewport, resolveFontFamily, parseFontStack, UnresolvedFontStackError } from "./normalize";
export type { FontResolver, FontStackCandidate, GenericFamily, NormalizeViewportOptions } from "./normalize";
export {
  createDarwinFontResolver,
  loadDarwinFontCatalog,
  parseDarwinFontDump,
  resolverFromCatalog,
} from "./font-resolver/darwin";
export type { DarwinFontCatalog } from "./font-resolver/darwin";
export { createHostFontResolver } from "./font-resolver/host";

export type { BuildDocumentResult, EmitFigOptions, EmitFigResult, MultiFigBuildResult } from "./emit";
export { buildDocument, buildMultiFigFileBytes, emitFig, irToSpecGraph } from "./emit";

// Visual-fidelity verification lives in `@higma-tools/web-fig-roundtrip`
// because it needs to import `@higma-tools/fig-to-web` (a same-scope
// sibling). web-to-fig stays focused on the capture-to-emit half of
// the pipeline.

export type { CdpExtractCliOptions, ExtractCliOptions, UrlExtractCliOptions } from "./cli";
export { CliUsageError, parseArgs, parseExtractArgs, runCli, runExtractCli } from "./cli";
