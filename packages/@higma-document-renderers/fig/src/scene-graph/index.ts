/** @file Scene graph builder / diff / render barrel. */

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
