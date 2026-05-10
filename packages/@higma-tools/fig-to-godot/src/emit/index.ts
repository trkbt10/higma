/**
 * @file Public entry for the Godot emit pipeline.
 */
export type { FrameTarget, GodotFile } from "./file";
export { buildFrameScene, buildFrameTarget, emitFrameFile } from "./file";
export { listFrameTargets, pickFrameByName } from "./targets";
export { emitFromFrames } from "./orchestrate";
export type { EmitOptions, EmitResult } from "./orchestrate";
export { extractSharedTheme } from "./shared-theme";
export type { SharedThemeFile, SharedThemeResult } from "./shared-theme";
export { createWalkContext, emitNode, emitRootFrame } from "./walk";
export type { EmitContext, WalkContext } from "./walk";
