/**
 * @file Public entry for the SwiftUI emit pipeline.
 */
export type { FrameTarget, SwiftFile } from "./file";
export { buildFrameTarget, emitFrameFile } from "./file";
export { listFrameTargets, pickFrameByName } from "./targets";
export { emitFromFrames } from "./orchestrate";
export type { EmitResult } from "./orchestrate";
export { emitNode, emitRootFrame } from "./walk";
export type { EmitContext } from "./walk";
// Complexity scoring moved to the shared asset-plan module
// (`@higma-document-renderers/fig/asset-plan`) so fig-to-web (and
// any other emitter that needs a "code vs asset" decision) consumes
// the same heuristic. The no-cross-package-reexport lint rule
// forbids surfacing it through this barrel — consumers import
// `complexityScore` / `ComplexityOptions` directly from
// `@higma-document-renderers/fig/asset-plan`.
export { planRasterization, nodeKey } from "./rasterize";
export type { RasterizationEntry, PlanRasterizationOptions } from "./rasterize";
