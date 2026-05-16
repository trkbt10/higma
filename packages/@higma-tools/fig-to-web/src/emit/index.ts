/**
 * @file Public entry for the JSX/CSS emit pipeline.
 */
export type { ComponentTarget, EmitFile, EmitRegistry, FrameTarget } from "./types";
export { listFrameTargets, pickFrameByName } from "./plan/targets";
export { buildRegistry, lookupInstanceTarget, variantValueForInstance } from "./plan/registry";
export { emitFromFrames } from "./orchestrate";
export type {
  AssetStrategy,
  CssImportStrategy,
  CssMode,
  EmitFromFramesOptions,
  EmitResult,
  ExportStyle,
  VariantStrategy,
} from "./orchestrate";
