/**
 * @file `@higma-bridges/web-fig` public entry — neutral IR plus
 * boundary codecs used by both `@higma-tools/fig-to-web` and
 * `@higma-tools/web-to-fig` to round-trip via a single contract.
 */
export type {
  AssetIR,
  AutoLayoutIR,
  AxisSizingIR,
  BlurEffectIR,
  BoxIR,
  ChildSizingIR,
  ColorIR,
  EffectIR,
  FrameNodeIR,
  GradientStopIR,
  ImagePaintIR,
  LengthIR,
  LinearGradientPaintIR,
  MultiViewportIR,
  NodeBaseIR,
  NodeIR,
  PaintIR,
  RectNodeIR,
  ShadowEffectIR,
  SolidPaintIR,
  StrokeAlignIR,
  StrokeIR,
  StyleIR,
  TextNodeIR,
  TextRunIR,
  TextStyleIR,
  TransformIR,
  VectorNodeIR,
  VectorPathIR,
  ViewportIR,
} from "./ir";

export {
  pxLength,
  percentLength,
  resolveLength,
  resolveCornerRadius,
  resolveBlockInset,
} from "./length/resolve";

export {
  figAutoLayoutToIR,
  figBlendModeToIR,
  figColorToIR,
  figEffectToIR,
  figPaintToIR,
  irAutoLayoutToFig,
  irBlendModeToFig,
  irColorToFig,
  irEffectToFig,
  irPaintToFig,
} from "./codecs";

export type { InferInput, InferenceResult } from "./layout";
export { inferAutoLayout } from "./layout";

export { clamp01, colorIRToCss, cssToColorIR, formatPx, round2, round3 } from "./style";

export type { ViewportFixtureJson } from "./viewport";
export { deserializeViewport, serializeViewport } from "./viewport";
