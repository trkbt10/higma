/**
 * @file Scene graph module
 *
 * Format-agnostic intermediate representation for Figma rendering.
 */

// Types
export type {
  SceneNodeId,
  Point,
  AffineMatrix,
  Color,
  GradientStop,
  Fill,
  SolidFill,
  LinearGradientFill,
  RadialGradientFill,
  AngularGradientFill,
  DiamondGradientFill,
  ImageFill,
  Stroke,
  StrokeLayer,
  Effect,
  DropShadowEffect,
  InnerShadowEffect,
  LayerBlurEffect,
  BackgroundBlurEffect,
  PathContour,
  CornerRadius,
  ArcData,
  ClipShape,
  RectClip,
  PathClip,
  MaskNode,
  TextLineLayout,
  TextLineBounds,
  SceneNodeBase,
  GroupNode,
  FrameNode,
  RectNode,
  EllipseNode,
  PathNode,
  TextNode,
  ImageNode,
  SceneNode,
  SceneGraph,
  BlendMode,
} from "./types";

export { createNodeId } from "./types";

export {
  createBooleanOperationEnum,
  evaluateBooleanPathResult,
  evaluateBooleanPaths,
  resolveBooleanOperationType,
  type BooleanEvaluationError,
  type BooleanEvaluationResult,
  type BooleanOperationType,
  type BooleanPathInput,
} from "./boolean-operation";

// Builder
export {
  buildSceneGraph,
  buildSceneGraphWithCache,
  type BuildSceneGraphOptions,
  type BuildSceneGraphResult,
  type SceneGraphBuildCache,
} from "./builder";

// Diff
export {
  diffSceneGraphs,
  hasDiffOps,
  type DiffOp,
  type AddOp,
  type RemoveOp,
  type UpdateOp,
  type ReorderOp,
  type SceneGraphDiff,
} from "./diff";

// Render — shared SoT for SceneGraph → SVG attribute resolution
// Both SVG string and React renderers MUST consume these exclusively.
export {
  colorToHex,
  uint8ArrayToBase64,
  matrixToSvgTransform,
  contourToSvgD,
  resolveFill,
  resolveTopFill,
  resolveStroke,
  resolveEffects,
  type ResolvedFill,
  type ResolvedFillAttrs,
  type ResolvedFillDef,
  type ResolvedGradientStop,
  type ResolvedLinearGradient,
  type ResolvedRadialGradient,
  type ResolvedImagePattern,
  type ResolvedStrokeAttrs,
  type ResolvedFilter,
  type ResolvedFilterPrimitive,
  type IdGenerator,
  type SceneGraphRenderOptions,
} from "./render";

// RenderTree — intermediate representation for SVG/React/WebGL backends
export {
  resolveRenderTree,
  resolveRenderTreeIncremental,
  type RenderTree,
  type RenderTreeResolutionCache,
  type RenderTreeResolutionResult,
  type RenderNode,
  type RenderNodeBase,
  type RenderGroupNode,
  type RenderFrameNode,
  type RenderFrameBackground,
  type RenderRectNode,
  type RenderEllipseNode,
  type RenderPathNode,
  type RenderPathContour,
  type RenderTextNode,
  type RenderTextGlyphs,
  type RenderTextLines,
  type RenderImageNode,
  type RenderDef,
  type RenderGradientDef,
  type RenderLinearGradientDef,
  type RenderRadialGradientDef,
  type RenderFilterDef,
  type RenderClipPathDef,
  type RenderPatternDef,
  type ClipPathShape,
  type ResolvedWrapperAttrs,
  type ResolvedFillResult,
} from "./render-tree";

// Converters
//
// `parseSvgPathD` and the primitive contour generators
// (`generateRectContour`, …, `generateLineContour`) live in
// `@higma-primitives/path`. The lint rule `no-cross-package-reexport`
// forbids republishing primitives via a renderer barrel, so consumers
// must import them directly from the primitive package.
export {
  figColorToSceneColor,
  convertPaintToFill,
  convertPaintsToFills,
  convertStrokeToSceneStroke,
  convertEffectsToScene,
  decodeGeometryToContours,
  convertVectorPathsToContours,
  convertTextNode,
  type TextConversionResult,
} from "./convert";
