/**
 * @file Public entry for the SwiftUI emit pipeline.
 */
export type { FrameTarget, SwiftFile } from "./file";
export { buildFrameTarget, emitFrameFile } from "./file";
export { listFrameTargets, pickFrameByName } from "./targets";
export { emitFromFrames } from "./orchestrate";
export type { EmitResult } from "./orchestrate";
export { emitNode, emitRootFrame } from "./walk";
