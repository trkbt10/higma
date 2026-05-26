/**
 * @file RenderTree module — intermediate representation between SceneGraph and backends
 */

// Types
export type {
  RenderTree,
  RenderNode,
  RenderNodeBase,
  RenderGroupNode,
  RenderFrameNode,
  RenderFrameBackground,
  RenderFrameSurfaceShape,
  RenderRectNode,
  RenderEllipseNode,
  RenderPathNode,
  RenderPathContour,
  RenderTextNode,
  RenderTextGlyphs,
  RenderTextGlyphRun,
  RenderTextLines,
  RenderImageNode,
  RenderDef,
  RenderGradientDef,
  RenderLinearGradientDef,
  RenderRadialGradientDef,
  RenderAngularGradientDef,
  RenderDiamondGradientDef,
  RenderFilterDef,
  RenderClipPathDef,
  RenderPatternDef,
  RenderMaskDef,
  RenderMaskContentRendering,
  RenderStrokeMaskDef,
  RenderMask,
  ClipPathShape,
  ResolvedWrapperAttrs,
  ResolvedFillResult,
  ResolvedFillLayer,
  RenderBackgroundBlur,
  StrokeRendering,
  StrokeShape,
} from "./types";

// Wrapper field registry (SoT for ResolvedWrapperAttrs exhaustiveness)
export { WRAPPER_ATTRS_FIELDS } from "./types";

// Resolver
export {
  resolveRenderTree,
  resolveRenderTreeWithReferenceReuse,
  type RenderTreeReferenceReuseState,
  type RenderTreeReferenceReuseResult,
} from "./resolve";

export {
  boundsIntersect,
  boundsUnion,
  canRenderContainerOpacityWithInheritedOpacity,
  canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary,
  getClipShapeLocalBounds,
  getRenderFrameLocalSurfaceFilterInputBounds,
  getRenderNodeLocalAuthoredBounds,
  getRenderNodeLocalBounds,
  getRenderNodeLocalFrameChildClipBounds,
  RENDER_NODE_SOURCE_TRANSFORMS,
  renderNodeIntersectsViewport,
  resolveRenderNodeLocalSourceEffectInputBounds,
  resolveRenderNodeLocalSubtreeVisualBounds,
  resolveRenderNodeOutputBoundsAffectedByTranslatedNode,
  transformBounds,
  type Bounds,
  type RenderNodeTranslatedOutputBounds,
  type RenderNodeVisualTransform,
  type ViewportIntersectionOptions,
  type ViewportRect,
} from "./render-node-visual-coverage";
