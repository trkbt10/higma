/**
 * @file Public entry for the JSX/CSS emit pipeline.
 */
export type { ComponentTarget, EmitFile, EmitRegistry, FrameTarget } from "./types";
export { listFrameTargets, pickFrameByName } from "./targets";
export { buildRegistry, lookupInstanceTarget, variantValueForInstance } from "./registry";
export { emitFromFrames } from "./orchestrate";
export type { EmitResult } from "./orchestrate";
