/**
 * @file WebGL Figma Renderer
 *
 * Renders a SceneGraph to a WebGL canvas via the RenderTree intermediate
 * representation. The RenderTree provides ALL rendering decisions (visibility,
 * fill/stroke resolution, effect resolution, clipping, composition).
 *
 * The WebGL renderer uses:
 * - RenderTree structure for traversal and composition decisions
 * - RenderNode geometry fields (width, height, cx, cy, etc.) for tessellation
 * - RenderNode source* fields (sourceFills, sourceStroke, sourceContours) for
 *   GPU-specific data (Fill objects contain gradient stops, image refs, etc.
 *   needed for shader uniforms)
 * - WebGLNodeEffectRenderPlan for effect rendering. The plan is derived once
 *   from node.source.effects and every WebGL effect path consumes it.
 * - node.source.transform for affine matrix math
 * - node.wrapper.opacity for resolved opacity (excludes invisible nodes)
 *
 * ## Architecture
 *
 * ```
 * SceneGraph
 *     ↓ resolveRenderTree()
 * RenderTree (fully resolved)
 *     ↓ WebGL renderer [this file]
 * GL draw calls (tessellation, shaders, stencil, framebuffer)
 * ```
 */

import type { SceneGraph, Fill, Color, Effect, PathContour, ClipShape, SceneGraphNodeTranslation } from "@higma-document-renderers/fig/scene-graph";
import { translateSceneNodeTransform } from "@higma-document-renderers/fig/scene-graph";
import { renderShapeEffectStack, resolveBrowserRenderedFigmaExportCssBlendMode, resolveFigmaRenderExportSettings, requireManagedImageColorProfile, type FigmaRenderExportSettings, type ResolvedEffectStack, type ResolvedFigmaRenderExportSettings, type ResolvedFillDef, } from "../../scene-graph";

import {
  type RenderNode, type RenderGroupNode, type RenderFrameNode, type RenderRectNode, type RenderEllipseNode, type RenderPathNode, type RenderTextNode, type RenderImageNode, type RenderDef, type StrokeRendering, type StrokeShape, type RenderClipPathDef, type RenderMaskDef, type RenderTree, } from "../../scene-graph";

import {
  tessellateContours, } from "../tessellation/tessellation";
import {
  drawSolidFill, drawLinearGradientFill, drawRadialGradientFill, drawAngularGradientFill, drawDiamondGradientFill, drawImageFill, type GLContext, } from "../fill/fill-renderer";
import { imageTextureResource, type TextureColorManagement } from "../resources/texture-resource";
import { IDENTITY_MATRIX, multiplyMatrices, createTranslationMatrix } from "@higma-document-models/fig/matrix";
import { rebuildStencilClipStack, type StencilClipEntry } from "../effects/clip-mask";
import { createGLStateCache } from "../state/gl-state-cache";
import { createEffectsRenderer } from "../effects/effects-renderer";
import { createWebGLEffectRendering } from "../effects/effect-rendering";
import { resolveEffectBackingScale } from "../effects/effect-scale";
import { shouldRenderWebGLBlurFramebufferPass } from "../effects/blur-framebuffer-pass-decision";
import {
  resolveWebGLLocalPaintBlendRegion,
  resolveWebGLRenderBackgroundBlurRegion,
  resolveWebGLRenderFrameSurfaceFilterRegion,
  resolveWebGLRenderFrameSurfaceRegion,
  resolveWebGLRenderNodeEffectStackOutputRegion,
  resolveWebGLRenderNodeSourceInputRegion,
  resolveWebGLRenderNodeSubtreeVisualOutputRegion,
  type WebGLEffectRenderRegion,
} from "../effects/effect-render-region";
import {
  canRenderContainerOpacityWithInheritedOpacity,
  canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary,
  getClipShapeLocalBounds,
  RENDER_NODE_SOURCE_TRANSFORMS,
  renderNodeIntersectsViewport,
  transformBounds,
  type Bounds,
  type RenderNodeVisualTransform,
  type ViewportIntersectionOptions,
  type ViewportRect,
} from "../../scene-graph";
import {
  areWebGLVisibleResourcePreparationKeysEqual,
  createWebGLVisibleResourcePreparationKey,
  type WebGLVisibleResourcePreparationKey,
} from "../scene/visible-resource-preparation-key";
import { createWebGLFigmaResourceContext, type WebGLFigmaResourceContext } from "../resources/resource-context";
import {
  prepareFanTriangles, CLIP_STENCIL_BIT, FILL_STENCIL_MASK, } from "../tessellation/stencil-fill";
import { pathContoursBoundingBox } from "@higma-primitives/path";
import { svgPathDToContours } from "../tessellation/path-contours";
import { syncWebGLCanvasRenderSurface } from "../scene/render-surface";
import type { WebGLPathFillRule } from "../fill/render-path-fill-plan";
import { hasVisibleLineText } from "../text/text-visibility";
import { createWebGLGeometryCache } from "../resources/geometry-cache";
import { createFramebuffer, deleteFramebuffer, type Framebuffer } from "../resources/framebuffer";
import { createWebGLRenderPaintCache } from "./render-paint-cache";
import type { AffineMatrix, CornerRadius } from "@higma-primitives/path";
import {
  resolveWebGLNodeEffectRenderPlan,
  type WebGLNodeEffectRenderPlan,
} from "./node-effect-render-plan";
import {
  resolveTransientNodeTranslationRedrawRegion,
  resolveTransientNodeTranslationRedrawViewport,
  type TransientNodeTranslationRedrawRegion,
} from "./transient-node-translation-redraw-region";
import {
  resolveViewportMotionRedrawRegion,
  type ViewportMotionRedrawRegion,
  type ViewportMotionSceneViewport,
} from "./viewport-motion-redraw-region";

// =============================================================================
// Types
// =============================================================================

export type WebGLRendererOptions = {
  /** WebGL canvas element or rendering context */
  readonly canvas: HTMLCanvasElement;
  /** Device pixel ratio resolved by the caller's runtime boundary. */
  readonly pixelRatio: number;
  /** Antialias (default: true) */
  readonly antialias?: boolean;
  /** Background color (default: white) */
  readonly backgroundColor?: Color;
  /** Central resource owner for caches and precompiled GPU programs. */
  readonly resourceContext?: WebGLFigmaResourceContext;
  readonly exportSettings?: FigmaRenderExportSettings;
  /** Preserve the back buffer for explicit readback/export contexts. Interactive viewports leave this disabled. */
  readonly preserveDrawingBuffer?: boolean;
};

export type WebGLFigmaRendererMetrics = {
  readonly prepareCount: number;
  readonly renderCount: number;
  readonly lastPrepareMs: number;
  readonly lastRenderMs: number;
  readonly lastRenderTreeResolveMs: number;
  readonly lastNodeTraversalMs: number;
  readonly lastSettledFrameCacheCaptureMs: number;
  readonly lastSettledFrameCacheRestoreMs: number;
  readonly lastSettledFrameCacheRegionCopyMs: number;
  readonly lastRenderFrameReason: WebGLRenderFrameReason;
  readonly lastRenderedNodeCount: number;
  readonly lastRenderedGroupCount: number;
  readonly lastRenderedFrameCount: number;
  readonly lastRenderedRectCount: number;
  readonly lastRenderedEllipseCount: number;
  readonly lastRenderedPathCount: number;
  readonly lastRenderedTextCount: number;
  readonly lastRenderedImageCount: number;
  readonly lastViewportSkippedNodeCount: number;
  readonly lastViewportSkippedSubtreeCount: number;
  readonly lastEffectNodeCount: number;
  readonly lastLayerBlurNodeCount: number;
  readonly lastGroupOpacityNodeCount: number;
  readonly lastInheritedGroupOpacityNodeCount: number;
  readonly lastImageDrawCount: number;
  readonly lastImageFillDrawCount: number;
  readonly lastImageNodeDrawCount: number;
  readonly lastTextGlyphRunDrawCount: number;
  readonly lastClipStencilFlushCount: number;
  readonly lastClipStencilFlushMs: number;
  readonly lastShapeRenderMs: number;
  readonly lastPathRenderMs: number;
  readonly lastTextRenderMs: number;
  readonly lastImageRenderMs: number;
  readonly lastEffectRenderMs: number;
  readonly lastBackgroundBlurRenderMs: number;
  readonly lastDropShadowRenderMs: number;
  readonly lastInnerShadowRenderMs: number;
  readonly lastEffectContentRenderMs: number;
  readonly lastEffectStrokeRenderMs: number;
  readonly lastGroupOpacityRenderMs: number;
  readonly lastLayerBlurRenderMs: number;
  readonly lastBackgroundBlurPassCount: number;
  readonly lastDropShadowPassCount: number;
  readonly lastInnerShadowPassCount: number;
  readonly lastInnerShadowBlurSourceCount: number;
  readonly lastEffectRegionCount: number;
  readonly lastEffectRegionPixelCount: number;
  readonly lastMaxEffectRegionPixelCount: number;
  readonly lastEffectCaptureRegionCount: number;
  readonly lastEffectCaptureRegionPixelCount: number;
  readonly lastMaxEffectCaptureRegionPixelCount: number;
  readonly lastBrowserBlendCaptureRegionPixelCount: number;
  readonly lastGroupOpacityCaptureRegionPixelCount: number;
  readonly lastLayerBlurCaptureRegionPixelCount: number;
  readonly lastPrepareStaticVertexBufferCreationCount: number;
  readonly lastPrepareStaticVertexBufferUploadByteLength: number;
  readonly lastPrepareStaticVertexBufferReleaseCount: number;
  readonly lastRenderDynamicVertexBufferBindCount: number;
  readonly lastRenderDynamicVertexBufferUploadCount: number;
  readonly lastRenderDynamicVertexBufferUploadByteLength: number;
  readonly lastRenderStaticVertexBufferBindCount: number;
  readonly lastRenderStaticVertexBufferCreationCount: number;
  readonly lastRenderStaticVertexBufferUploadByteLength: number;
  readonly lastRenderStaticVertexBufferReleaseCount: number;
  readonly lastRenderStaticVertexBufferCount: number;
  readonly lastVisibleTexturePreparationCount: number;
  readonly lastMissingVisibleTexturePreparationCount: number;
  readonly lastTextureUploadCount: number;
  readonly settledRenderCount: number;
  readonly lastSettledRenderMs: number;
  readonly viewportMotionRenderCount: number;
  readonly lastViewportMotionRenderMs: number;
  readonly lastViewportMotionRenderedNodeCount: number;
  readonly lastViewportMotionEffectNodeCount: number;
  readonly lastViewportMotionLayerBlurNodeCount: number;
  readonly lastViewportMotionGroupOpacityNodeCount: number;
  readonly lastViewportMotionInheritedGroupOpacityNodeCount: number;
  readonly lastViewportMotionClipStencilFlushCount: number;
  readonly lastViewportMotionClipStencilFlushMs: number;
  readonly sceneGraphInteractionRenderCount: number;
  readonly lastSceneGraphInteractionRenderMs: number;
  readonly lastSceneGraphInteractionRenderedNodeCount: number;
  readonly lastSceneGraphInteractionEffectNodeCount: number;
  readonly lastSceneGraphInteractionLayerBlurNodeCount: number;
  readonly lastSceneGraphInteractionGroupOpacityNodeCount: number;
  readonly lastSceneGraphInteractionInheritedGroupOpacityNodeCount: number;
  readonly lastSceneGraphInteractionClipStencilFlushCount: number;
  readonly lastSceneGraphInteractionClipStencilFlushMs: number;
};

export type WebGLRenderFrameReason = "settled" | "viewport-motion" | "scene-graph-interaction";

type BackgroundBlurSceneEffect = Extract<Effect, { readonly type: "background-blur" }>;

type WebGLRenderableNodeEffectPlan = {
  readonly stack: ResolvedEffectStack;
  readonly backgroundBlurMaskEffect: BackgroundBlurSceneEffect | null;
  readonly frameSurfaceFilterStack: ResolvedEffectStack;
};

export type WebGLRenderFrameOptions = {
  readonly frameReason: WebGLRenderFrameReason;
  readonly transientNodeTranslation?: SceneGraphNodeTranslation;
};

type WebGLSettledFrameCache = {
  readonly framebuffer: Framebuffer;
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
};

type WebGLDefaultFramebufferSettledFrame = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
};

type WebGLPreviousTransientNodeTranslationFrame = {
  readonly scene: SceneGraph;
  readonly pixelRatio: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly redrawRegion: TransientNodeTranslationRedrawRegion | null;
};

// =============================================================================
// WebGL Renderer
// =============================================================================

function configureWebGLColorProfile(
  gl: WebGLRenderingContext,
  exportSettings: ResolvedFigmaRenderExportSettings,
): void {
  if (exportSettings.imageColorManagement.kind === "unmanaged") {
    return;
  }
  const profile = requireManagedImageColorProfile(exportSettings.imageColorManagement);
  const colorManagedGl = gl as WebGLRenderingContext & {
    drawingBufferColorSpace?: "srgb" | "display-p3";
    unpackColorSpace?: "srgb" | "display-p3";
  };
  if (
    profile === "DISPLAY_P3_V4" &&
    (colorManagedGl.drawingBufferColorSpace === undefined || colorManagedGl.unpackColorSpace === undefined)
  ) {
    throw new Error("Display P3 WebGL rendering requires drawingBufferColorSpace and unpackColorSpace support");
  }
  if (profile === "DISPLAY_P3_V4") {
    colorManagedGl.drawingBufferColorSpace = "display-p3";
    colorManagedGl.unpackColorSpace = "display-p3";
    return;
  }
  if (colorManagedGl.drawingBufferColorSpace !== undefined) {
    colorManagedGl.drawingBufferColorSpace = "srgb";
  }
  if (colorManagedGl.unpackColorSpace !== undefined) {
    colorManagedGl.unpackColorSpace = "srgb";
  }
}

/** WebGL renderer instance for Figma scene graphs */
export type WebGLFigmaRendererInstance = {
  isScenePrepared(scene: SceneGraph): boolean;
  prepareScene(scene: SceneGraph): Promise<void>;
  precompileResources(): void;
  render(scene: SceneGraph, frameOptions?: WebGLRenderFrameOptions): void;
  setPixelRatio(pixelRatio: number): void;
  getMetrics(): WebGLFigmaRendererMetrics;
  dispose(): void;
};

/** Resolve WebGL context attributes for the renderer viewport. */
export function resolveWebGLRendererContextAttributes(options: WebGLRendererOptions): WebGLContextAttributes {
  return {
    antialias: options.antialias ?? true,
    alpha: true,
    premultipliedAlpha: true,
    stencil: true,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  };
}

function requireWebGLRendererPixelRatio(pixelRatio: number): number {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new Error(`WebGL renderer requires positive pixelRatio, got ${pixelRatio}`);
  }
  return pixelRatio;
}

/** Create a WebGL renderer for Figma scene graphs */
export function createWebGLFigmaRenderer(options: WebGLRendererOptions): WebGLFigmaRendererInstance {
  const glOrNull = options.canvas.getContext("webgl", resolveWebGLRendererContextAttributes(options));

  if (!glOrNull) {
    throw new Error("WebGL not supported");
  }

  // Reassign after null guard so TypeScript narrows correctly in closures
  const gl: WebGLRenderingContext = glOrNull;
  const exportSettings = resolveFigmaRenderExportSettings(options.exportSettings);
  configureWebGLColorProfile(gl, exportSettings);

  const pixelRatioRef = { value: requireWebGLRendererPixelRatio(options.pixelRatio) };
  const backgroundColor = options.backgroundColor ?? { r: 1, g: 1, b: 1, a: 1 };
  const resourceContext = options.resourceContext ?? createWebGLFigmaResourceContext(gl);
  const shaders = resourceContext.shaders;
  const textureCache = resourceContext.textures;
  const vertexBuffers = resourceContext.vertexBuffers;
  const effectsRenderer = createEffectsRenderer(gl);
  const currentEffectOutputFramebuffer = { value: null as WebGLFramebuffer | null };
  const currentEffectBackdropFramebuffer = { value: null as WebGLFramebuffer | null };
  const currentTransientNodeTranslation = { value: undefined as SceneGraphNodeTranslation | undefined };
  const currentRenderNodeVisualTransform = { value: RENDER_NODE_SOURCE_TRANSFORMS as RenderNodeVisualTransform };
  const settledFrameCache = { value: null as WebGLSettledFrameCache | null };
  const defaultFramebufferSettledFrame = { value: null as WebGLDefaultFramebufferSettledFrame | null };
  const previousTransientNodeTranslationFrame = { value: null as WebGLPreviousTransientNodeTranslationFrame | null };
  const width = { value: 0 };
  const height = { value: 0 };
  const clipActive = { value: false };
  const clipStencilValid = { value: false };
  const renderTreeCache = resourceContext.renderTrees;
  const preparedVisibleResourceKey = { value: null as WebGLVisibleResourcePreparationKey | null };
  const currentRenderFrameReason = { value: "settled" as WebGLRenderFrameReason };
  const metrics = {
    prepareCount: 0,
    renderCount: 0,
    lastPrepareMs: 0,
    lastRenderMs: 0,
    lastRenderTreeResolveMs: 0,
    lastNodeTraversalMs: 0,
    lastSettledFrameCacheCaptureMs: 0,
    lastSettledFrameCacheRestoreMs: 0,
    lastSettledFrameCacheRegionCopyMs: 0,
    lastRenderFrameReason: "settled" as WebGLRenderFrameReason,
    lastRenderedNodeCount: 0,
    lastRenderedGroupCount: 0,
    lastRenderedFrameCount: 0,
    lastRenderedRectCount: 0,
    lastRenderedEllipseCount: 0,
    lastRenderedPathCount: 0,
    lastRenderedTextCount: 0,
    lastRenderedImageCount: 0,
    lastViewportSkippedNodeCount: 0,
    lastViewportSkippedSubtreeCount: 0,
    lastEffectNodeCount: 0,
    lastLayerBlurNodeCount: 0,
    lastGroupOpacityNodeCount: 0,
    lastInheritedGroupOpacityNodeCount: 0,
    lastImageDrawCount: 0,
    lastImageFillDrawCount: 0,
    lastImageNodeDrawCount: 0,
    lastTextGlyphRunDrawCount: 0,
    lastClipStencilFlushCount: 0,
    lastClipStencilFlushMs: 0,
    lastShapeRenderMs: 0,
    lastPathRenderMs: 0,
    lastTextRenderMs: 0,
    lastImageRenderMs: 0,
    lastEffectRenderMs: 0,
    lastBackgroundBlurRenderMs: 0,
    lastDropShadowRenderMs: 0,
    lastInnerShadowRenderMs: 0,
    lastEffectContentRenderMs: 0,
    lastEffectStrokeRenderMs: 0,
    lastGroupOpacityRenderMs: 0,
    lastLayerBlurRenderMs: 0,
    lastBackgroundBlurPassCount: 0,
    lastDropShadowPassCount: 0,
    lastInnerShadowPassCount: 0,
    lastInnerShadowBlurSourceCount: 0,
    lastEffectRegionCount: 0,
    lastEffectRegionPixelCount: 0,
    lastMaxEffectRegionPixelCount: 0,
    lastEffectCaptureRegionCount: 0,
    lastEffectCaptureRegionPixelCount: 0,
    lastMaxEffectCaptureRegionPixelCount: 0,
    lastBrowserBlendCaptureRegionPixelCount: 0,
    lastGroupOpacityCaptureRegionPixelCount: 0,
    lastLayerBlurCaptureRegionPixelCount: 0,
    lastPrepareStaticVertexBufferCreationCount: 0,
    lastPrepareStaticVertexBufferUploadByteLength: 0,
    lastPrepareStaticVertexBufferReleaseCount: 0,
    lastRenderDynamicVertexBufferBindCount: 0,
    lastRenderDynamicVertexBufferUploadCount: 0,
    lastRenderDynamicVertexBufferUploadByteLength: 0,
    lastRenderStaticVertexBufferBindCount: 0,
    lastRenderStaticVertexBufferCreationCount: 0,
    lastRenderStaticVertexBufferUploadByteLength: 0,
    lastRenderStaticVertexBufferReleaseCount: 0,
    lastRenderStaticVertexBufferCount: 0,
    lastVisibleTexturePreparationCount: 0,
    lastMissingVisibleTexturePreparationCount: 0,
    lastTextureUploadCount: 0,
    settledRenderCount: 0,
    lastSettledRenderMs: 0,
    viewportMotionRenderCount: 0,
    lastViewportMotionRenderMs: 0,
    lastViewportMotionRenderedNodeCount: 0,
    lastViewportMotionEffectNodeCount: 0,
    lastViewportMotionLayerBlurNodeCount: 0,
    lastViewportMotionGroupOpacityNodeCount: 0,
    lastViewportMotionInheritedGroupOpacityNodeCount: 0,
    lastViewportMotionClipStencilFlushCount: 0,
    lastViewportMotionClipStencilFlushMs: 0,
    sceneGraphInteractionRenderCount: 0,
    lastSceneGraphInteractionRenderMs: 0,
    lastSceneGraphInteractionRenderedNodeCount: 0,
    lastSceneGraphInteractionEffectNodeCount: 0,
    lastSceneGraphInteractionLayerBlurNodeCount: 0,
    lastSceneGraphInteractionGroupOpacityNodeCount: 0,
    lastSceneGraphInteractionInheritedGroupOpacityNodeCount: 0,
    lastSceneGraphInteractionClipStencilFlushCount: 0,
    lastSceneGraphInteractionClipStencilFlushMs: 0,
  };
  const clipStack: WebGLRendererClipEntry[] = [];
  const activeScissorClipBox = { value: null as WebGLScissorClipBox | null };
  const activeStencilClipEntries = { value: null as readonly StencilClipEntry[] | null };

  /**
   * State cache for stencil / colorMask / enable / clearStencil
   * setters. Scrolling a scene with many clipped FRAMEs runs
   * `rebuildStencilClipStack` dozens of times per frame, each rebuild
   * fires ~10 state setters, and most are redundant against the
   * previous rebuild's tail. The cache short-circuits the GL call
   * when the value is unchanged. `gl.enable(BLEND)` below seeds the
   * cache with the matching value so the cache starts consistent
   * with reality.
   */
  const glState = createGLStateCache(gl);
  const geometryCache = createWebGLGeometryCache();
  const renderPaintCache = createWebGLRenderPaintCache();
  const activePreparedRenderTreeVertexArrays = { value: null as Set<Float32Array> | null };
  /**
   * Parsed contours for `clip-path` defs the render-tree resolver
   * stores on FRAME nodes. The shape objects are themselves cached on
   * the node (which is reused across viewport-only renders), so a
   * WeakMap keyed on the shape avoids re-running `parseSvgPathD` on
   * every pan/zoom frame for clipped frames.
   */
  const clipPathContoursCache = new WeakMap<object, ReturnType<typeof svgPathDToContours>>();
  function getCachedClipPathContours(shape: { readonly d: string }): ReturnType<typeof svgPathDToContours> {
    const cached = clipPathContoursCache.get(shape);
    if (cached) {
      return cached;
    }
    const contours = svgPathDToContours({ d: shape.d });
    clipPathContoursCache.set(shape, contours);
    return contours;
  }
  /**
   * Tessellated vertices for path-shaped clip-paths, keyed by the
   * parsed-contours array. `rebuildStencilClipStack` re-runs every
   * time a descendant frame pushes or pops its own clip — without
   * this cache, each rebuild would re-flatten Béziers and re-earcut
   * the ancestor clip. The contours array is itself cached by
   * `getCachedClipPathContours`, so the WeakMap key stays stable
   * across pan/zoom rerenders.
   */
  const clipPathVerticesCache = new WeakMap<readonly PathContour[], Float32Array>();
  function getCachedClipPathVertices(contours: readonly PathContour[]): Float32Array {
    const cached = clipPathVerticesCache.get(contours);
    if (cached) {
      return cached;
    }
    const vertices = tessellateContours(contours, 0.25, true);
    clipPathVerticesCache.set(contours, vertices);
    return vertices;
  }
  function resolveClipVertices(clip: ClipShape): Float32Array {
    if (clip.type === "rect") {
      return geometryCache.getRectVertices(clip.width, clip.height, clip.cornerRadius, clip.cornerSmoothing);
    }
    return getCachedClipPathVertices(clip.contours);
  }
  type StrokeGeometryRendering = Extract<StrokeRendering, { readonly mode: "geometry" }>;
  type StrokeGeometryCacheEntry = {
    readonly contours: readonly PathContour[];
    readonly vertices: Float32Array;
    readonly elementSize: { readonly width: number; readonly height: number };
  };
  const strokeGeometryCache = new WeakMap<StrokeGeometryRendering, StrokeGeometryCacheEntry>();
  function getStrokeGeometryCacheEntry(sr: StrokeGeometryRendering): StrokeGeometryCacheEntry {
    const cached = strokeGeometryCache.get(sr);
    if (cached) {
      return cached;
    }
    const contours = sr.paths.flatMap((p) => svgPathDToContours({
      d: p.d,
      windingRule: p.fillRule ?? "nonzero",
    }));
    const value: StrokeGeometryCacheEntry = {
      contours,
      vertices: tessellateContours(contours, 0.25, true),
      elementSize: pathContoursElementSize(contours),
    };
    strokeGeometryCache.set(sr, value);
    return value;
  }
  const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };
  const WHITE: Color = { r: 1, g: 1, b: 1, a: 1 };
  // Enable blending for transparency (route through the state cache
  // so subsequent `setEnabled(BLEND, true)` calls short-circuit).
  glState.setEnabled(gl.BLEND, true);
  gl.blendFuncSeparate(
    gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE, gl.ONE_MINUS_SRC_ALPHA
  );

  function getGlContext(): GLContext {
    return {
      gl,
      shaders,
      glState,
      vertexBuffers,
      width: width.value,
      height: height.value,
      pixelRatio: pixelRatioRef.value,
    };
  }

  function invalidateStateAfterRawEffectRendererCall(): void {
    glState.invalidate();
    vertexBuffers.invalidateArrayBufferBinding();
    invalidateClipStencilState();
  }

  type StencilFillRule = WebGLPathFillRule;

  function canvasBackingWidth(): number {
    return Math.ceil(width.value * pixelRatioRef.value);
  }

  function canvasBackingHeight(): number {
    return Math.ceil(height.value * pixelRatioRef.value);
  }

type StencilPreparedGeometry = NonNullable<ReturnType<typeof prepareFanTriangles>>;

type WebGLScissorClipBox = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type WebGLRendererClipEntry = StencilClipEntry & {
  readonly scissorBox?: WebGLScissorClipBox;
  readonly visibilityViewport?: ViewportRect;
};

type WebGLRendererVisibilityViewportCache = {
  clipStackRevision: number;
  width: number;
  height: number;
  rect: ViewportRect | null;
};

  // =========================================================================
  // Image preloading — walk RenderTree, use source* fields for image data
  // =========================================================================

  function currentViewportRect(): ViewportRect {
    return { x: 0, y: 0, width: width.value, height: height.value };
  }

  function intersectViewportRect(left: ViewportRect, right: ViewportRect): ViewportRect | null {
    const x = Math.max(left.x, right.x);
    const y = Math.max(left.y, right.y);
    const maxX = Math.min(left.x + left.width, right.x + right.width);
    const maxY = Math.min(left.y + left.height, right.y + right.height);
    if (maxX <= x || maxY <= y) {
      return null;
    }
    return {
      x,
      y,
      width: maxX - x,
      height: maxY - y,
    };
  }

  function computeCurrentVisibilityViewportRect(): ViewportRect | null {
    return clipStack.reduce<ViewportRect | null>((viewport, clip) => {
      if (viewport === null) {
        return null;
      }
      if (clip.visibilityViewport === undefined) {
        return viewport;
      }
      return intersectViewportRect(viewport, clip.visibilityViewport);
    }, currentViewportRect());
  }

  function currentVisibilityViewportRect(): ViewportRect | null {
    const cached = visibilityViewportCache.value;
    if (
      cached.clipStackRevision === clipStackRevision.value &&
      cached.width === width.value &&
      cached.height === height.value
    ) {
      return cached.rect;
    }
    const rect = computeCurrentVisibilityViewportRect();
    visibilityViewportCache.value = {
      clipStackRevision: clipStackRevision.value,
      width: width.value,
      height: height.value,
      rect,
    };
    return rect;
  }

  function viewportToSurfaceTransform(
    renderTree: { readonly width: number; readonly height: number; readonly viewport: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } },
  ): AffineMatrix {
    if (renderTree.viewport.width <= 0 || renderTree.viewport.height <= 0) {
      throw new Error("WebGL renderer requires a positive viewport size");
    }
    const scaleX = renderTree.width / renderTree.viewport.width;
    const scaleY = renderTree.height / renderTree.viewport.height;
    return {
      ...IDENTITY_MATRIX,
      m00: scaleX,
      m11: scaleY,
      m02: -renderTree.viewport.x * scaleX,
      m12: -renderTree.viewport.y * scaleY,
    };
  }

  function isVisualNodeInViewport(node: RenderNode, transform: AffineMatrix): boolean {
    const viewport = currentVisibilityViewportRect();
    if (viewport === null) {
      return false;
    }
    return renderNodeIntersectsViewport({
      node,
      transform,
      viewport,
      visualTransform: currentRenderNodeVisualTransform.value,
      options: currentVisualNodeViewportIntersectionOptions(),
    });
  }

  function isVisualNodeInSettledViewport(node: RenderNode, transform: AffineMatrix): boolean {
    return renderNodeIntersectsViewport({
      node,
      transform,
      viewport: currentViewportRect(),
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: undefined,
    });
  }

  function isContainerSubtreeInSettledViewport(node: RenderGroupNode | RenderFrameNode, transform: AffineMatrix): boolean {
    return renderNodeIntersectsViewport({
      node,
      transform,
      viewport: currentViewportRect(),
      visualTransform: RENDER_NODE_SOURCE_TRANSFORMS,
      options: undefined,
    });
  }

  function currentVisualNodeViewportIntersectionOptions(): ViewportIntersectionOptions | undefined {
    return undefined;
  }

  function currentContainerSubtreeViewportIntersectionOptions(): ViewportIntersectionOptions | undefined {
    return undefined;
  }

  function canRenderNodeInCurrentViewport(node: RenderNode, parentTransform: AffineMatrix): boolean {
    const worldTransform = multiplyMatrices(parentTransform, resolveCurrentRenderNodeTransform(node));
    const viewport = currentVisibilityViewportRect();
    if (viewport === null) {
      return false;
    }
    if (node.type === "group" || node.type === "frame") {
      return renderNodeIntersectsViewport({
        node,
        transform: worldTransform,
        viewport,
        visualTransform: currentRenderNodeVisualTransform.value,
        options: currentContainerSubtreeViewportIntersectionOptions(),
      });
    }
    return renderNodeIntersectsViewport({
      node,
      transform: worldTransform,
      viewport,
      visualTransform: currentRenderNodeVisualTransform.value,
      options: currentVisualNodeViewportIntersectionOptions(),
    });
  }

  function hasFrameChildThatCanRenderInCurrentViewport(node: RenderFrameNode, transform: AffineMatrix): boolean {
    return node.children.some((child) => canRenderNodeInCurrentViewport(child, transform));
  }

  function resolveFrameChildClipIdForCurrentViewport(
    node: RenderFrameNode,
    transform: AffineMatrix,
  ): RenderFrameNode["childClipId"] {
    if (node.omitChildClip) {
      return undefined;
    }
    if (!hasFrameChildThatCanRenderInCurrentViewport(node, transform)) {
      return undefined;
    }
    if (canSkipFrameChildClipBecauseChildVisualSubtreesCannotReachClipBoundary({
      node,
      visualTransform: currentRenderNodeVisualTransform.value,
    })) {
      return undefined;
    }
    return node.childClipId;
  }

  /**
   * Defer stencil rebuilds until a draw actually needs the current
   * clip state. Sibling clipped frames push and immediately pop their
   * own clips during traversal — without deferral, each push/pop pair
   * fires two `rebuildStencilClipStack` calls even though the net
   * stencil state at the sibling boundary is identical to where it
   * started. The hot scroll path is dominated by exactly this pattern
   * (Figma auto-layout frames all clip), so collapsing back-to-back
   * pop+push into a single rebuild at the next draw cuts the GL
   * traffic roughly in half.
   *
   * Push / pop mutate `clipStack` and mark the stencil state for rebuild. Every
   * drawing entry point (`renderRectFromTree`, `renderEllipseFromTree`,
   * `renderPathFromTree`, `renderTextFromTree`, `renderImageFromTree`,
   * frame-background draws inside `renderFrameFromTree`) calls
   * `flushClipStencilIfRebuildNeeded` before painting so the GPU stencil
   * matches what the renderer believes the clip stack to be.
   */
  const clipStencilNeedsRebuild = { value: true };
  const clipStackRevision = { value: 0 };
  const visibilityViewportCache = {
    value: {
      clipStackRevision: -1,
      width: 0,
      height: 0,
      rect: null,
    } as WebGLRendererVisibilityViewportCache,
  };

  function markClipStencilNeedsRebuild(): void {
    clipStencilNeedsRebuild.value = true;
    activeScissorClipBox.value = null;
    clipStackRevision.value += 1;
  }

  function invalidateClipStencilState(): void {
    clipStencilValid.value = false;
    activeStencilClipEntries.value = null;
    markClipStencilNeedsRebuild();
  }

  function sameStencilClipEntries(
    left: readonly StencilClipEntry[] | null,
    right: readonly StencilClipEntry[],
  ): boolean {
    return left !== null &&
      left.length === right.length &&
      left.every((entry, index) => entry === right[index]);
  }

  function sameScissorClipBox(left: WebGLScissorClipBox | null, right: WebGLScissorClipBox): boolean {
    return left !== null &&
      left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height;
  }

  function intersectScissorClipBoxes(boxes: readonly WebGLScissorClipBox[]): WebGLScissorClipBox {
    if (boxes.length === 0) {
      throw new Error("WebGL scissor clip intersection requires at least one box");
    }
    const intersection = boxes.slice(1).reduce(
      (current, box) => ({
        left: Math.max(current.left, box.x),
        bottom: Math.max(current.bottom, box.y),
        right: Math.min(current.right, box.x + box.width),
        top: Math.min(current.top, box.y + box.height),
      }),
      {
        left: boxes[0].x,
        bottom: boxes[0].y,
        right: boxes[0].x + boxes[0].width,
        top: boxes[0].y + boxes[0].height,
      },
    );
    return {
      x: intersection.left,
      y: intersection.bottom,
      width: Math.max(0, intersection.right - intersection.left),
      height: Math.max(0, intersection.top - intersection.bottom),
    };
  }

  function applyScissorClipBoxes(boxes: readonly WebGLScissorClipBox[]): void {
    if (boxes.length === 0) {
      disableScissorClip();
      return;
    }
    const next = intersectScissorClipBoxes(boxes);
    glState.setEnabled(gl.SCISSOR_TEST, true);
    if (!sameScissorClipBox(activeScissorClipBox.value, next)) {
      gl.scissor(next.x, next.y, next.width, next.height);
      activeScissorClipBox.value = next;
    }
  }

  function disableScissorClip(): void {
    glState.setEnabled(gl.SCISSOR_TEST, false);
    activeScissorClipBox.value = null;
  }

  function flushClipStencilIfRebuildNeeded(): void {
    if (!clipStencilNeedsRebuild.value) {
      return;
    }
    if (clipStack.length === 0) {
      disableScissorClip();
      glState.setEnabled(gl.STENCIL_TEST, false);
      clipActive.value = false;
      clipStencilValid.value = false;
      activeStencilClipEntries.value = null;
      clipStencilNeedsRebuild.value = false;
      return;
    }
    const stencilClipEntries: StencilClipEntry[] = [];
    const scissorClipBoxes: WebGLScissorClipBox[] = [];
    for (const entry of clipStack) {
      if (entry.scissorBox === undefined) {
        stencilClipEntries.push(entry);
        continue;
      }
      scissorClipBoxes.push(entry.scissorBox);
    }
    applyScissorClipBoxes(scissorClipBoxes);
    if (stencilClipEntries.length === 0) {
      glState.setEnabled(gl.STENCIL_TEST, false);
      clipActive.value = false;
      clipStencilValid.value = false;
      activeStencilClipEntries.value = null;
      clipStencilNeedsRebuild.value = false;
      return;
    }
    if (clipStencilValid.value && sameStencilClipEntries(activeStencilClipEntries.value, stencilClipEntries)) {
      glState.setEnabled(gl.STENCIL_TEST, true);
      glState.setColorMask(true, true, true, true);
      glState.setStencilMask(0xff);
      glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      clipActive.value = true;
      clipStencilNeedsRebuild.value = false;
      return;
    }
    const flushStart = performance.now();
    rebuildStencilClipStack({ ops: { gl, glState }, clips: stencilClipEntries });
    clipActive.value = true;
    clipStencilValid.value = true;
    activeStencilClipEntries.value = stencilClipEntries;
    clipStencilNeedsRebuild.value = false;
    metrics.lastClipStencilFlushCount += 1;
    metrics.lastClipStencilFlushMs += performance.now() - flushStart;
  }

  function colorManagementForImagePaint(fill: Fill & { readonly type: "image" }): TextureColorManagement {
    if (fill.imageShouldColorManage === true) {
      return {
        kind: "managed",
        targetColorProfile: requireManagedImageColorProfile(exportSettings.imageColorManagement),
      };
    }
    return { kind: "unmanaged" };
  }

  function colorManagementForImageNode(node: RenderImageNode): TextureColorManagement {
    if (node.sourceImageShouldColorManage === undefined) {
      throw new Error(`WebGL image node ${node.id} requires explicit imageShouldColorManage`);
    }
    if (node.sourceImageShouldColorManage) {
      return {
        kind: "managed",
        targetColorProfile: requireManagedImageColorProfile(exportSettings.imageColorManagement),
      };
    }
    return { kind: "unmanaged" };
  }

  type VisibleTexturePreparation = {
    readonly resource: ReturnType<typeof imageTextureResource>;
    readonly data: Uint8Array;
    readonly mimeType: string;
    readonly options: { readonly colorManagement: TextureColorManagement };
  };

  function addVisibleTexturePreparation(
    preparations: Map<string, VisibleTexturePreparation>,
    preparation: VisibleTexturePreparation,
  ): void {
    const existing = preparations.get(preparation.resource.id);
    if (existing === undefined) {
      preparations.set(preparation.resource.id, preparation);
      return;
    }
    if (existing.mimeType !== preparation.mimeType) {
      throw new Error(`WebGL texture resource ${preparation.resource.id} has conflicting mime types`);
    }
  }

  function collectVisibleTexturePreparations(
    node: RenderNode,
    parentTransform: AffineMatrix,
    preparations: Map<string, VisibleTexturePreparation>,
  ): void {
    const worldTransform = multiplyMatrices(parentTransform, node.source.transform);
    const visible = isVisualNodeInSettledViewport(node, worldTransform);

    // Image nodes carry source data for texture creation
    if (node.type === "image" && visible) {
      const colorManagement = colorManagementForImageNode(node);
      const resource = imageTextureResource(node.sourceImageHash, colorManagement);
      addVisibleTexturePreparation(preparations, {
        resource,
        data: node.sourceData,
        mimeType: node.sourceMimeType,
        options: { colorManagement },
      });
    }

    // Shape and frame nodes share `sourceFills`. Walk all variants that
    // expose that field uniformly so any image fill is registered.
    if (visible && (
      node.type === "rect" ||
      node.type === "ellipse" ||
      node.type === "path" ||
      node.type === "frame"
    )) {
      for (const fill of node.sourceFills) {
        if (fill.type === "image") {
          const colorManagement = colorManagementForImagePaint(fill);
          const resource = imageTextureResource(fill.imageHash, colorManagement);
          addVisibleTexturePreparation(preparations, {
            resource,
            data: fill.data,
            mimeType: fill.mimeType,
            options: { colorManagement },
          });
        }
      }
    }

    // Recurse into children (group / frame are the only container variants).
    if (
      (node.type === "group" || node.type === "frame") &&
      isContainerSubtreeInSettledViewport(node, worldTransform)
    ) {
      for (const child of node.children) {
        collectVisibleTexturePreparations(child, worldTransform, preparations);
      }
    }
  }

  function visibleTexturePreparations(renderTree: RenderTree): readonly VisibleTexturePreparation[] {
    const preparations = new Map<string, VisibleTexturePreparation>();
    const viewportTransform = viewportToSurfaceTransform(renderTree);
    for (const child of renderTree.children) {
      collectVisibleTexturePreparations(child, viewportTransform, preparations);
    }
    return Array.from(preparations.values());
  }

  function visibleTextureResourceIds(preparations: readonly VisibleTexturePreparation[]): readonly string[] {
    return preparations.map((preparation) => preparation.resource.id);
  }

  function prepareStaticVertexBuffer(vertices: Float32Array): void {
    if (vertices.length === 0) {
      return;
    }
    const preparedRenderTreeVertexArrays = activePreparedRenderTreeVertexArrays.value;
    if (preparedRenderTreeVertexArrays === null) {
      throw new Error("WebGL static vertex buffer preparation requires an active RenderTree preparation set");
    }
    preparedRenderTreeVertexArrays.add(vertices);
    vertexBuffers.prepareStaticVertices(vertices);
  }

  function prepareStencilGeometryVertices(prepared: StencilPreparedGeometry | null): void {
    if (prepared === null) {
      return;
    }
    prepareStaticVertexBuffer(prepared.fanVertices);
  }

  function prepareIndividualStrokeVertexBuffers(sr: Extract<StrokeRendering, { readonly mode: "individual" }>): void {
    const { top, right, bottom, left } = sr.sides;
    if (top > 0) {
      prepareStaticVertexBuffer(geometryCache.getRectVertices(sr.width, top));
    }
    if (bottom > 0) {
      prepareStaticVertexBuffer(geometryCache.getRectVertices(sr.width, bottom));
    }
    if (left > 0) {
      prepareStaticVertexBuffer(geometryCache.getRectVertices(left, sr.height));
    }
    if (right > 0) {
      prepareStaticVertexBuffer(geometryCache.getRectVertices(right, sr.height));
    }
    if (requiresIndividualStrokeInteriorClip(sr.cornerRadius, sr.strokeAlign)) {
      prepareStaticVertexBuffer(geometryCache.getRectVertices(sr.width, sr.height, sr.cornerRadius));
    }
  }

  function prepareClipPathDefVertexBuffer(
    { defs, clipId, nodeId, transform }: {
      readonly defs: readonly RenderDef[];
      readonly clipId: string;
      readonly nodeId: string;
      readonly transform: AffineMatrix;
    },
  ): void {
    const clipDef = findRequiredClipPathDef(defs, clipId, nodeId);
    const clipData = resolveClipPathDefData({ clipDef, transform });
    prepareStaticVertexBuffer(resolveClipVertices(clipData.clip));
  }

  function prepareStrokeRenderingVertexBuffers(sr: StrokeRendering): void {
    switch (sr.mode) {
      case "uniform":
        return;
      case "masked": {
        const strokeWidth = sr.attrs.strokeWidth ?? 1;
        if (strokeWidth <= 0) {
          return;
        }
        if (sr.shape.kind === "rect") {
          prepareStaticVertexBuffer(geometryCache.getRectAlignedStrokeVertices({
            width: sr.shape.width,
            height: sr.shape.height,
            cornerRadius: sr.shape.cornerRadius,
            strokeWidth: strokeWidth / 2,
            align: sr.attrs.strokeAlign === "INSIDE" ? "INSIDE" : "OUTSIDE",
          }));
          return;
        }
        prepareStaticVertexBuffer(geometryCache.getStrokeShapeStrokeVertices({
          shape: sr.shape,
          strokeWidth,
          dashPattern: renderPaintCache.strokeDashPattern(sr.attrs.strokeDasharray),
        }));
        prepareStaticVertexBuffer(geometryCache.getStrokeShapeStencilVertices(sr.shape));
        return;
      }
      case "layers":
        for (const layer of sr.layers) {
          prepareStaticVertexBuffer(geometryCache.getStrokeShapeStrokeVertices({
            shape: sr.shape,
            strokeWidth: layer.attrs.strokeWidth ?? 1,
            dashPattern: renderPaintCache.strokeDashPattern(layer.attrs.strokeDasharray),
          }));
        }
        return;
      case "geometry":
        prepareStaticVertexBuffer(getStrokeGeometryCacheEntry(sr).vertices);
        return;
      case "individual":
        prepareIndividualStrokeVertexBuffers(sr);
        return;
    }
  }

  function preparePathStrokeVertices(
    { node, contours, strokeWidth, dashPattern }: {
      readonly node: RenderPathNode;
      readonly contours: readonly PathContour[];
      readonly strokeWidth: number;
      readonly dashPattern?: readonly number[];
    },
  ): void {
    if (strokeWidth <= 0) {
      return;
    }
    prepareStaticVertexBuffer(geometryCache.getPathStrokeVertices({
      node,
      contours,
      strokeWidth,
      dashPattern,
    }));
  }

  function preparePathUniformStrokeVertexBuffers(node: RenderPathNode, contours: readonly PathContour[]): void {
    const sourceStroke = node.sourceStroke;
    if (!sourceStroke || sourceStroke.width <= 0) {
      return;
    }
    preparePathStrokeVertices({
      node,
      contours,
      strokeWidth: sourceStroke.width,
      dashPattern: sourceStroke.dashPattern,
    });
  }

  function preparePathStrokeLayerVertexBuffer(
    node: RenderPathNode,
    contours: readonly PathContour[],
    layer: Extract<StrokeRendering, { readonly mode: "layers" }>["layers"][number],
  ): void {
    preparePathStrokeVertices({
      node,
      contours,
      strokeWidth: layer.attrs.strokeWidth ?? 1,
      dashPattern: renderPaintCache.strokeDashPattern(layer.attrs.strokeDasharray),
    });
  }

  function preparePathStrokeVertexBuffers(node: RenderPathNode, contours: readonly PathContour[]): void {
    const sr = node.strokeRendering;
    if (!sr) {
      return;
    }
    if (sr.mode === "uniform") {
      preparePathUniformStrokeVertexBuffers(node, contours);
      return;
    }
    if (sr.mode === "layers") {
      for (const layer of sr.layers) {
        preparePathStrokeLayerVertexBuffer(node, contours, layer);
      }
      return;
    }
    if (sr.mode === "masked") {
      preparePathStrokeVertices({
        node,
        contours,
        strokeWidth: sr.attrs.strokeWidth ?? 1,
        dashPattern: renderPaintCache.strokeDashPattern(sr.attrs.strokeDasharray),
      });
      return;
    }
    prepareStrokeRenderingVertexBuffers(sr);
  }

  function preparePathNodeVertexBuffers(node: RenderPathNode): void {
    const pathGeometry = geometryCache.getPathGeometry(node);
    prepareStencilGeometryVertices(pathGeometry.prepared);
    if (pathGeometry.coverQuad !== null) {
      prepareStaticVertexBuffer(pathGeometry.coverQuad);
    }
    prepareStaticVertexBuffer(pathGeometry.backgroundMaskVertices);
    prepareStaticVertexBuffer(pathGeometry.dropShadowSilhouetteVertices);
    const fillPlan = geometryCache.getPathFillPlanGeometry(node);
    for (const instruction of fillPlan.instructions) {
      prepareStaticVertexBuffer(instruction.prepared.fanVertices);
      prepareStaticVertexBuffer(instruction.coverQuad);
    }
    preparePathStrokeVertexBuffers(node, pathGeometry.parsedContours);
  }

  function prepareTextNodeVertexBuffers(node: RenderTextNode): void {
    if (node.content.mode === "glyphs") {
      const { runs } = geometryCache.getTextGlyphGeometry(node);
      for (const run of runs) {
        prepareStaticVertexBuffer(run.vertices);
      }
      return;
    }
    if (!hasVisibleLineText(node.content)) {
      return;
    }
    throw new Error(`WebGL vertex buffer preparation requires glyph contours for text node ${node.id}`);
  }

  function prepareRectUniformStrokeVertexBuffer(
    node: RenderRectNode,
    strokeRendering: Extract<StrokeRendering, { readonly mode: "uniform" }>,
  ): void {
    if (node.sourceStroke === undefined) {
      return;
    }
    prepareStaticVertexBuffer(geometryCache.getRectStrokeVertices({
      width: node.width,
      height: node.height,
      cornerRadius: node.cornerRadius,
      strokeWidth: node.sourceStroke.width,
      dashPattern: node.sourceStroke.dashPattern ?? renderPaintCache.strokeDashPattern(strokeRendering.attrs.strokeDasharray),
    }));
  }

  function prepareRectNodeVertexBuffers(node: RenderRectNode): void {
    prepareStaticVertexBuffer(geometryCache.getRectVertices(node.width, node.height, node.cornerRadius, node.cornerSmoothing));
    if (node.strokeRendering === undefined) {
      return;
    }
    if (node.strokeRendering.mode === "uniform") {
      prepareRectUniformStrokeVertexBuffer(node, node.strokeRendering);
      return;
    }
    prepareStrokeRenderingVertexBuffers(node.strokeRendering);
  }

  function prepareEllipseUniformStrokeVertexBuffer(
    node: RenderEllipseNode,
    strokeRendering: Extract<StrokeRendering, { readonly mode: "uniform" }>,
  ): void {
    if (node.sourceStroke === undefined) {
      return;
    }
    prepareStaticVertexBuffer(geometryCache.getEllipseStrokeVertices({
      cx: node.cx,
      cy: node.cy,
      rx: node.rx,
      ry: node.ry,
      strokeWidth: node.sourceStroke.width,
      dashPattern: node.sourceStroke.dashPattern ?? renderPaintCache.strokeDashPattern(strokeRendering.attrs.strokeDasharray),
    }));
  }

  function prepareEllipseNodeVertexBuffers(node: RenderEllipseNode): void {
    prepareStaticVertexBuffer(geometryCache.getEllipseVertices({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry }));
    if (node.strokeRendering === undefined) {
      return;
    }
    if (node.strokeRendering.mode === "uniform") {
      prepareEllipseUniformStrokeVertexBuffer(node, node.strokeRendering);
      return;
    }
    prepareStrokeRenderingVertexBuffers(node.strokeRendering);
  }

  function prepareVisualNodeVertexBuffers(node: RenderNode): void {
    switch (node.type) {
      case "rect":
        prepareRectNodeVertexBuffers(node);
        return;
      case "ellipse":
        prepareEllipseNodeVertexBuffers(node);
        return;
      case "path":
        preparePathNodeVertexBuffers(node);
        return;
      case "text":
        prepareTextNodeVertexBuffers(node);
        return;
      case "image":
        prepareStaticVertexBuffer(geometryCache.getRectVertices(node.width, node.height));
        return;
      case "group":
      case "frame":
        return;
    }
  }

  function prepareContainerChildrenVertexBuffers(node: RenderGroupNode | RenderFrameNode, worldTransform: AffineMatrix): void {
    for (const child of node.children) {
      prepareRenderNodeVertexBuffers(child, worldTransform);
    }
  }

  function prepareGroupNodeVertexBuffers(node: RenderGroupNode, worldTransform: AffineMatrix): void {
    if (!isContainerSubtreeInSettledViewport(node, worldTransform)) {
      return;
    }
    if (node.childClipId !== undefined) {
      prepareClipPathDefVertexBuffer({ defs: node.defs, clipId: node.childClipId, nodeId: node.id, transform: worldTransform });
    }
    prepareContainerChildrenVertexBuffers(node, worldTransform);
  }

  function prepareFrameSurfaceUniformStrokeVertexBuffer(node: RenderFrameNode): void {
    if (node.sourceStroke === undefined || node.background?.strokeRendering?.mode !== "uniform") {
      return;
    }
    prepareStaticVertexBuffer(resolveFrameUniformStrokeVertices(
      node.sourceSurfaceShape,
      node.sourceStroke.width,
      node.sourceStroke.dashPattern ?? renderPaintCache.strokeDashPattern(node.background.strokeRendering.attrs.strokeDasharray),
    ));
  }

  function prepareFrameSurfaceVertexBuffers(node: RenderFrameNode, worldTransform: AffineMatrix): void {
    if (!isVisualNodeInSettledViewport(node, worldTransform)) {
      return;
    }
    prepareStaticVertexBuffer(resolveClipVertices(node.sourceSurfaceShape));
    if (node.background?.strokeRendering === undefined) {
      return;
    }
    if (node.background.strokeRendering.mode === "uniform") {
      prepareFrameSurfaceUniformStrokeVertexBuffer(node);
      return;
    }
    prepareStrokeRenderingVertexBuffers(node.background.strokeRendering);
  }

  function prepareFrameChildClipVertexBuffer(node: RenderFrameNode, worldTransform: AffineMatrix): void {
    const childClipId = node.omitChildClip ? undefined : node.childClipId;
    if (childClipId === undefined) {
      return;
    }
    prepareClipPathDefVertexBuffer({ defs: node.defs, clipId: childClipId, nodeId: node.id, transform: worldTransform });
  }

  function prepareFrameNodeVertexBuffers(node: RenderFrameNode, worldTransform: AffineMatrix): void {
    if (!isContainerSubtreeInSettledViewport(node, worldTransform)) {
      return;
    }
    prepareFrameSurfaceVertexBuffers(node, worldTransform);
    prepareFrameChildClipVertexBuffer(node, worldTransform);
    prepareContainerChildrenVertexBuffers(node, worldTransform);
  }

  function prepareRenderNodeVertexBuffers(node: RenderNode, parentTransform: AffineMatrix): void {
    const worldTransform = multiplyMatrices(parentTransform, node.source.transform);
    if (node.type === "group") {
      prepareGroupNodeVertexBuffers(node, worldTransform);
      return;
    }
    if (node.type === "frame") {
      prepareFrameNodeVertexBuffers(node, worldTransform);
      return;
    }
    if (!isVisualNodeInSettledViewport(node, worldTransform)) {
      return;
    }
    prepareVisualNodeVertexBuffers(node);
  }

  function prepareVisibleVertexBuffers(renderTree: RenderTree): void {
    if (activePreparedRenderTreeVertexArrays.value !== null) {
      throw new Error("WebGL static vertex buffer preparation is already active");
    }
    const preparedRenderTreeVertexArrays = new Set<Float32Array>();
    activePreparedRenderTreeVertexArrays.value = preparedRenderTreeVertexArrays;
    const viewportTransform = viewportToSurfaceTransform(renderTree);
    try {
      for (const child of renderTree.children) {
        prepareRenderNodeVertexBuffers(child, viewportTransform);
      }
    } finally {
      activePreparedRenderTreeVertexArrays.value = null;
    }
    vertexBuffers.synchronizePreparedRenderTreeVertexArrays(preparedRenderTreeVertexArrays);
  }

  function allVisibleTexturePreparationsReady(preparations: readonly VisibleTexturePreparation[]): boolean {
    return preparations.every((preparation) => textureCache.getIfCached(preparation.resource) !== null);
  }

  function missingVisibleTexturePreparations(preparations: readonly VisibleTexturePreparation[]): readonly VisibleTexturePreparation[] {
    return preparations.filter((preparation) => textureCache.getIfCached(preparation.resource) === null);
  }

  async function prepareMissingVisibleTextures(preparations: readonly VisibleTexturePreparation[]): Promise<void> {
    const missing = missingVisibleTexturePreparations(preparations);
    metrics.lastVisibleTexturePreparationCount = preparations.length;
    metrics.lastMissingVisibleTexturePreparationCount = missing.length;
    metrics.lastTextureUploadCount = missing.length;
    await Promise.all(missing.map((preparation) => (
      textureCache.prepare(
        preparation.resource,
        preparation.data,
        preparation.mimeType,
        preparation.options,
      ).then(() => undefined)
    )));
  }

  function recordViewportMotionRenderMetrics(renderMs: number): void {
    metrics.viewportMotionRenderCount += 1;
    metrics.lastViewportMotionRenderMs = renderMs;
    metrics.lastViewportMotionRenderedNodeCount = metrics.lastRenderedNodeCount;
    metrics.lastViewportMotionEffectNodeCount = metrics.lastEffectNodeCount;
    metrics.lastViewportMotionLayerBlurNodeCount = metrics.lastLayerBlurNodeCount;
    metrics.lastViewportMotionGroupOpacityNodeCount = metrics.lastGroupOpacityNodeCount;
    metrics.lastViewportMotionInheritedGroupOpacityNodeCount = metrics.lastInheritedGroupOpacityNodeCount;
    metrics.lastViewportMotionClipStencilFlushCount = metrics.lastClipStencilFlushCount;
    metrics.lastViewportMotionClipStencilFlushMs = metrics.lastClipStencilFlushMs;
  }

  function recordSceneGraphInteractionRenderMetrics(renderMs: number): void {
    metrics.sceneGraphInteractionRenderCount += 1;
    metrics.lastSceneGraphInteractionRenderMs = renderMs;
    metrics.lastSceneGraphInteractionRenderedNodeCount = metrics.lastRenderedNodeCount;
    metrics.lastSceneGraphInteractionEffectNodeCount = metrics.lastEffectNodeCount;
    metrics.lastSceneGraphInteractionLayerBlurNodeCount = metrics.lastLayerBlurNodeCount;
    metrics.lastSceneGraphInteractionGroupOpacityNodeCount = metrics.lastGroupOpacityNodeCount;
    metrics.lastSceneGraphInteractionInheritedGroupOpacityNodeCount = metrics.lastInheritedGroupOpacityNodeCount;
    metrics.lastSceneGraphInteractionClipStencilFlushCount = metrics.lastClipStencilFlushCount;
    metrics.lastSceneGraphInteractionClipStencilFlushMs = metrics.lastClipStencilFlushMs;
  }

  function recordSettledRenderMetrics(renderMs: number): void {
    metrics.settledRenderCount += 1;
    metrics.lastSettledRenderMs = renderMs;
  }

  function recordCompletedRenderMetrics(renderMs: number): void {
    metrics.lastRenderMs = renderMs;
    switch (currentRenderFrameReason.value) {
      case "viewport-motion":
        recordViewportMotionRenderMetrics(renderMs);
        return;
      case "scene-graph-interaction":
        recordSceneGraphInteractionRenderMetrics(renderMs);
        return;
      case "settled":
        recordSettledRenderMetrics(renderMs);
        return;
    }
  }

  function deleteSettledFrameCache(): void {
    const cache = settledFrameCache.value;
    if (cache === null) {
      return;
    }
    deleteFramebuffer(gl, cache.framebuffer);
    settledFrameCache.value = null;
    forgetPreviousTransientNodeTranslationFrame();
  }

  function rememberDefaultFramebufferSettledFrame(scene: SceneGraph): void {
    defaultFramebufferSettledFrame.value = {
      scene,
      pixelRatio: pixelRatioRef.value,
      canvasWidth: canvasBackingWidth(),
      canvasHeight: canvasBackingHeight(),
    };
  }

  function forgetDefaultFramebufferSettledFrame(): void {
    defaultFramebufferSettledFrame.value = null;
  }

  function forgetPreviousTransientNodeTranslationFrame(): void {
    previousTransientNodeTranslationFrame.value = null;
  }

  function rememberPreviousTransientNodeTranslationFrame(
    scene: SceneGraph,
    redrawRegion: TransientNodeTranslationRedrawRegion | null,
  ): void {
    previousTransientNodeTranslationFrame.value = {
      scene,
      pixelRatio: pixelRatioRef.value,
      canvasWidth: canvasBackingWidth(),
      canvasHeight: canvasBackingHeight(),
      redrawRegion,
    };
  }

  function previousTransientNodeTranslationFrameForCurrentSurface(
    scene: SceneGraph,
  ): WebGLPreviousTransientNodeTranslationFrame | null {
    const frame = previousTransientNodeTranslationFrame.value;
    if (frame === null) {
      return null;
    }
    if (
      frame.scene === scene &&
      frame.pixelRatio === pixelRatioRef.value &&
      frame.canvasWidth === canvasBackingWidth() &&
      frame.canvasHeight === canvasBackingHeight()
    ) {
      return frame;
    }
    forgetPreviousTransientNodeTranslationFrame();
    return null;
  }

  function settledFrameCacheMatchesCurrentSurface(cache: WebGLSettledFrameCache, scene: SceneGraph): boolean {
    return cache.scene === scene &&
      cache.pixelRatio === pixelRatioRef.value &&
      cache.canvasWidth === canvasBackingWidth() &&
      cache.canvasHeight === canvasBackingHeight();
  }

  function defaultFramebufferSettledFrameMatchesCurrentSurface(
    frame: WebGLDefaultFramebufferSettledFrame,
    scene: SceneGraph,
  ): boolean {
    return frame.scene === scene &&
      frame.pixelRatio === pixelRatioRef.value &&
      frame.canvasWidth === canvasBackingWidth() &&
      frame.canvasHeight === canvasBackingHeight();
  }

  function settledFrameCacheMatchesCurrentSource(cache: WebGLSettledFrameCache, scene: SceneGraph): boolean {
    return cache.scene.sourceDocumentReference === scene.sourceDocumentReference &&
      cache.scene.root === scene.root &&
      cache.scene.version === scene.version &&
      cache.pixelRatio === pixelRatioRef.value &&
      cache.canvasWidth === canvasBackingWidth() &&
      cache.canvasHeight === canvasBackingHeight();
  }

  function defaultFramebufferSettledFrameMatchesCurrentSource(
    frame: WebGLDefaultFramebufferSettledFrame,
    scene: SceneGraph,
  ): boolean {
    return frame.scene.sourceDocumentReference === scene.sourceDocumentReference &&
      frame.scene.root === scene.root &&
      frame.scene.version === scene.version &&
      frame.pixelRatio === pixelRatioRef.value &&
      frame.canvasWidth === canvasBackingWidth() &&
      frame.canvasHeight === canvasBackingHeight();
  }

  function sameSceneViewport(
    left: ViewportMotionSceneViewport,
    right: ViewportMotionSceneViewport,
  ): boolean {
    return left.x === right.x &&
      left.y === right.y &&
      left.width === right.width &&
      left.height === right.height;
  }

  function settledFrameCacheMatchesCurrentViewport(cache: WebGLSettledFrameCache, scene: SceneGraph): boolean {
    return settledFrameCacheMatchesCurrentSource(cache, scene) &&
      sameSceneViewport(sceneViewport(cache.scene), sceneViewport(scene));
  }

  function currentSettledFrameCache(scene: SceneGraph): WebGLSettledFrameCache | null {
    const cache = settledFrameCache.value;
    if (cache !== null && settledFrameCacheMatchesCurrentSurface(cache, scene)) {
      return cache;
    }
    const frame = defaultFramebufferSettledFrame.value;
    if (frame !== null && defaultFramebufferSettledFrameMatchesCurrentSurface(frame, scene)) {
      return captureSettledFrameCache(frame.scene);
    }
    return null;
  }

  function currentSettledFrameCacheForSource(scene: SceneGraph): WebGLSettledFrameCache | null {
    const cache = settledFrameCache.value;
    if (cache !== null && settledFrameCacheMatchesCurrentSource(cache, scene)) {
      return cache;
    }
    const frame = defaultFramebufferSettledFrame.value;
    if (frame !== null && defaultFramebufferSettledFrameMatchesCurrentSource(frame, scene)) {
      return captureSettledFrameCache(frame.scene);
    }
    return null;
  }

  function currentSettledFrameCacheForViewport(scene: SceneGraph): WebGLSettledFrameCache | null {
    const cache = settledFrameCache.value;
    if (cache === null) {
      return null;
    }
    if (settledFrameCacheMatchesCurrentViewport(cache, scene)) {
      return cache;
    }
    return null;
  }

  function createSettledFrameCacheForCurrentSurface(scene: SceneGraph): WebGLSettledFrameCache {
    const cache = settledFrameCache.value;
    const canvasWidth = canvasBackingWidth();
    const canvasHeight = canvasBackingHeight();
    if (cache !== null && cache.canvasWidth === canvasWidth && cache.canvasHeight === canvasHeight) {
      return {
        ...cache,
        scene,
        pixelRatio: pixelRatioRef.value,
      };
    }
    deleteSettledFrameCache();
    return {
      framebuffer: createFramebuffer(gl, canvasWidth, canvasHeight),
      scene,
      pixelRatio: pixelRatioRef.value,
      canvasWidth,
      canvasHeight,
    };
  }

  function captureSettledFrameCache(scene: SceneGraph): WebGLSettledFrameCache {
    const start = performance.now();
    const cache = createSettledFrameCacheForCurrentSurface(scene);
    settledFrameCache.value = cache;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, cache.framebuffer.texture);
    gl.copyTexSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      0,
      0,
      cache.canvasWidth,
      cache.canvasHeight,
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    vertexBuffers.invalidateArrayBufferBinding();
    metrics.lastSettledFrameCacheCaptureMs += performance.now() - start;
    return cache;
  }

  function fullCanvasEffectRenderRegion(): WebGLEffectRenderRegion {
    return {
      x: 0,
      y: 0,
      width: canvasBackingWidth(),
      height: canvasBackingHeight(),
    };
  }

  function clearDefaultFramebuffer(): void {
    gl.disable(gl.SCISSOR_TEST);
    activeScissorClipBox.value = null;
    const bg = backgroundColor;
    gl.clearColor(bg.r, bg.g, bg.b, bg.a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  function clearDefaultFramebufferScissorBox(scissorBox: WebGLScissorClipBox): void {
    glState.setEnabled(gl.SCISSOR_TEST, true);
    if (!sameScissorClipBox(activeScissorClipBox.value, scissorBox)) {
      gl.scissor(scissorBox.x, scissorBox.y, scissorBox.width, scissorBox.height);
      activeScissorClipBox.value = scissorBox;
    }
    glState.setEnabled(gl.STENCIL_TEST, false);
    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);
    gl.clearStencil(0);
    const bg = backgroundColor;
    gl.clearColor(bg.r, bg.g, bg.b, bg.a);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  }

  function clearDefaultFramebufferStencilScissorBox(scissorBox: WebGLScissorClipBox): void {
    glState.setEnabled(gl.SCISSOR_TEST, true);
    if (!sameScissorClipBox(activeScissorClipBox.value, scissorBox)) {
      gl.scissor(scissorBox.x, scissorBox.y, scissorBox.width, scissorBox.height);
      activeScissorClipBox.value = scissorBox;
    }
    glState.setEnabled(gl.STENCIL_TEST, false);
    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(0xff);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    glState.setColorMask(true, true, true, true);
  }

  function restoreSettledFrameCacheToDefaultFramebuffer(cache: WebGLSettledFrameCache): void {
    const start = performance.now();
    clearDefaultFramebuffer();
    effectsRenderer.copyFramebufferRegionToRegion({
      canvasWidth: cache.canvasWidth,
      canvasHeight: cache.canvasHeight,
      sourceRegion: fullCanvasEffectRenderRegion(),
      targetRegion: fullCanvasEffectRenderRegion(),
      sourceFramebuffer: cache.framebuffer,
      outputFramebuffer: null,
    });
    invalidateStateAfterRawEffectRendererCall();
    metrics.lastSettledFrameCacheRestoreMs += performance.now() - start;
  }

  function copySettledFrameCacheRegionToDefaultFramebuffer(
    cache: WebGLSettledFrameCache,
    redrawRegion: ViewportMotionRedrawRegion,
  ): void {
    const start = performance.now();
    effectsRenderer.copyFramebufferRegionToRegion({
      canvasWidth: cache.canvasWidth,
      canvasHeight: cache.canvasHeight,
      sourceRegion: redrawRegion.sourceRegion,
      targetRegion: redrawRegion.targetRegion,
      sourceFramebuffer: cache.framebuffer,
      outputFramebuffer: null,
    });
    invalidateStateAfterRawEffectRendererCall();
    metrics.lastSettledFrameCacheRegionCopyMs += performance.now() - start;
  }

  function copySettledFrameCacheViewportToDefaultFramebuffer(
    cache: WebGLSettledFrameCache,
    viewport: ViewportRect,
  ): WebGLScissorClipBox | null {
    const scissorBox = resolveViewportRectScissorClipBox(viewport);
    if (scissorBox.width === 0 || scissorBox.height === 0) {
      return null;
    }
    const start = performance.now();
    const region = scissorClipBoxToEffectRenderRegion(scissorBox);
    effectsRenderer.copyFramebufferRegionToRegion({
      canvasWidth: cache.canvasWidth,
      canvasHeight: cache.canvasHeight,
      sourceRegion: region,
      targetRegion: region,
      sourceFramebuffer: cache.framebuffer,
      outputFramebuffer: null,
    });
    invalidateStateAfterRawEffectRendererCall();
    metrics.lastSettledFrameCacheRegionCopyMs += performance.now() - start;
    return scissorBox;
  }

  function sceneViewport(scene: SceneGraph): ViewportMotionSceneViewport {
    if (scene.viewport !== undefined) {
      return scene.viewport;
    }
    return {
      x: 0,
      y: 0,
      width: scene.width,
      height: scene.height,
    };
  }

  function rendererOutputScissorClipShape(): never {
    throw new Error("WebGL renderer output scissor clip has no stencil shape");
  }

  function pushRendererOutputClip(viewport: ViewportRect, scissorBox: WebGLScissorClipBox): void {
    clipStack.push({
      scissorBox,
      visibilityViewport: viewport,
      drawClipShape: rendererOutputScissorClipShape,
    });
    markClipStencilNeedsRebuild();
  }

  function popRendererOutputClip(): void {
    clipStack.pop();
    markClipStencilNeedsRebuild();
  }

  function renderRenderTreeChildren(renderTree: RenderTree, viewportTransform: AffineMatrix): void {
    for (const child of renderTree.children) {
      renderRenderNode(child, viewportTransform, 1);
    }
  }

  function renderRenderTreeChildrenWithTransientTranslation(
    renderTree: RenderTree,
    viewportTransform: AffineMatrix,
    transientNodeTranslation: SceneGraphNodeTranslation | undefined,
  ): void {
    const previousVisualTransform = currentRenderNodeVisualTransform.value;
    currentTransientNodeTranslation.value = transientNodeTranslation;
    currentRenderNodeVisualTransform.value = transientNodeTranslation === undefined
      ? RENDER_NODE_SOURCE_TRANSFORMS
      : { type: "scene-graph-node-translation", translation: transientNodeTranslation };
    try {
      renderRenderTreeChildren(renderTree, viewportTransform);
    } finally {
      currentTransientNodeTranslation.value = undefined;
      currentRenderNodeVisualTransform.value = previousVisualTransform;
    }
  }

  function renderTransientNodeTranslationRedrawViewport(
    renderTree: RenderTree,
    viewportTransform: AffineMatrix,
    translation: SceneGraphNodeTranslation,
    redrawViewport: ViewportRect,
    scissorBox: WebGLScissorClipBox,
  ): void {
    pushRendererOutputClip(redrawViewport, scissorBox);
    effectsRenderer.setRendererOutputRegion(scissorClipBoxToEffectRenderRegion(scissorBox));
    try {
      renderRenderTreeChildrenWithTransientTranslation(renderTree, viewportTransform, translation);
    } finally {
      effectsRenderer.setRendererOutputRegion(null);
      popRendererOutputClip();
    }
  }

  function renderTransientNodeTranslationFrameFromSettledCache({
    scene,
    renderTree,
    viewportTransform,
    translation,
  }: {
    readonly scene: SceneGraph;
    readonly renderTree: RenderTree;
    readonly viewportTransform: AffineMatrix;
    readonly translation: SceneGraphNodeTranslation;
  }): boolean {
    const cache = currentSettledFrameCache(scene);
    if (cache === null) {
      forgetPreviousTransientNodeTranslationFrame();
      return false;
    }
    const currentRedrawRegion = resolveTransientNodeTranslationRedrawRegion({
      children: renderTree.children,
      viewportTransform,
      viewport: currentViewportRect(),
      translation,
    });
    const previousRedrawRegion = previousTransientNodeTranslationFrameForCurrentSurface(scene)?.redrawRegion ?? null;
    const redrawViewport = resolveTransientNodeTranslationRedrawViewport({
      current: currentRedrawRegion,
      previous: previousRedrawRegion,
    });
    if (redrawViewport === null) {
      rememberPreviousTransientNodeTranslationFrame(scene, currentRedrawRegion);
      return true;
    }
    const scissorBox = copySettledFrameCacheViewportToDefaultFramebuffer(cache, redrawViewport);
    if (scissorBox === null) {
      rememberPreviousTransientNodeTranslationFrame(scene, currentRedrawRegion);
      return true;
    }
    clearDefaultFramebufferStencilScissorBox(scissorBox);
    if (currentRedrawRegion !== null) {
      renderTransientNodeTranslationRedrawViewport(renderTree, viewportTransform, translation, redrawViewport, scissorBox);
    }
    rememberPreviousTransientNodeTranslationFrame(scene, currentRedrawRegion);
    return true;
  }

  function renderViewportMotionRedrawRegion(
    renderTree: RenderTree,
    viewportTransform: AffineMatrix,
    viewport: ViewportRect,
  ): void {
    const scissorBox = resolveViewportRectScissorClipBox(viewport);
    if (scissorBox.width === 0 || scissorBox.height === 0) {
      return;
    }
    clearDefaultFramebufferScissorBox(scissorBox);
    pushRendererOutputClip(viewport, scissorBox);
    effectsRenderer.setRendererOutputRegion(scissorClipBoxToEffectRenderRegion(scissorBox));
    try {
      renderRenderTreeChildrenWithTransientTranslation(renderTree, viewportTransform, undefined);
    } finally {
      effectsRenderer.setRendererOutputRegion(null);
      popRendererOutputClip();
    }
  }

  function renderViewportMotionFrameFromSettledCache({
    scene,
    renderTree,
    viewportTransform,
  }: {
    readonly scene: SceneGraph;
    readonly renderTree: RenderTree;
    readonly viewportTransform: AffineMatrix;
  }): boolean {
    const cache = currentSettledFrameCacheForSource(scene);
    if (cache === null) {
      return false;
    }
    const redrawRegion = resolveViewportMotionRedrawRegion({
      previousViewport: sceneViewport(cache.scene),
      currentViewport: sceneViewport(scene),
      surfaceWidth: width.value,
      surfaceHeight: height.value,
      pixelRatio: pixelRatioRef.value,
    });
    if (redrawRegion === null) {
      return false;
    }
    copySettledFrameCacheRegionToDefaultFramebuffer(cache, redrawRegion);
    for (const viewport of redrawRegion.exposedViewportRegions) {
      renderViewportMotionRedrawRegion(renderTree, viewportTransform, viewport);
    }
    captureSettledFrameCache(scene);
    return true;
  }

  function renderSettledFrameFromSettledCache(scene: SceneGraph): boolean {
    const frame = defaultFramebufferSettledFrame.value;
    if (frame !== null && defaultFramebufferSettledFrameMatchesCurrentSource(frame, scene)) {
      return sameSceneViewport(sceneViewport(frame.scene), sceneViewport(scene));
    }
    const cache = currentSettledFrameCacheForViewport(scene);
    if (cache === null) {
      return false;
    }
    restoreSettledFrameCacheToDefaultFramebuffer(cache);
    return true;
  }

  function renderFrameFromRenderTree({
    scene,
    renderTree,
    viewportTransform,
    frameOptions,
  }: {
    readonly scene: SceneGraph;
    readonly renderTree: RenderTree;
    readonly viewportTransform: AffineMatrix;
    readonly frameOptions: WebGLRenderFrameOptions | undefined;
  }): void {
    const translation = frameOptions?.transientNodeTranslation;
    if (currentRenderFrameReason.value !== "scene-graph-interaction" || translation === undefined) {
      forgetPreviousTransientNodeTranslationFrame();
    }
    if (
      currentRenderFrameReason.value === "viewport-motion" &&
      translation === undefined &&
      renderViewportMotionFrameFromSettledCache({ scene, renderTree, viewportTransform })
    ) {
      rememberDefaultFramebufferSettledFrame(scene);
      return;
    }
    if (
      currentRenderFrameReason.value === "settled" &&
      translation === undefined &&
      renderSettledFrameFromSettledCache(scene)
    ) {
      rememberDefaultFramebufferSettledFrame(scene);
      return;
    }
    if (
      currentRenderFrameReason.value === "scene-graph-interaction" &&
      translation !== undefined &&
      renderTransientNodeTranslationFrameFromSettledCache({ scene, renderTree, viewportTransform, translation })
    ) {
      forgetDefaultFramebufferSettledFrame();
      return;
    }
    clearDefaultFramebuffer();
    renderRenderTreeChildrenWithTransientTranslation(renderTree, viewportTransform, translation);
    if (currentRenderFrameReason.value === "settled" && translation === undefined) {
      rememberDefaultFramebufferSettledFrame(scene);
      return;
    }
    forgetDefaultFramebufferSettledFrame();
  }

  // =========================================================================
  // Effect routines — use source effects for GPU-native rendering
  // =========================================================================

  function drawFillWithoutPaintBlend(
    { vertices, fill, transform, opacity, elementSize }: {
      vertices: Float32Array; fill: Fill; transform: AffineMatrix;
      opacity: number; elementSize: { width: number; height: number };
    }
  ): void {
    const ctx = getGlContext();

    switch (fill.type) {
      case "solid":
        drawSolidFill({ ctx, vertices, color: fill.color, transform, opacity: opacity * fill.opacity });
        break;

      case "linear-gradient":
        drawLinearGradientFill({ ctx, vertices, fill, transform, opacity, elementSize });
        break;

      case "radial-gradient":
        drawRadialGradientFill({ ctx, vertices, fill, transform, opacity, elementSize });
        break;

      case "image": {
        const effectiveOpacity = opacity * fill.opacity;
        if (vertices.length === 0 || effectiveOpacity <= 0) {
          break;
        }
        const resource = imageTextureResource(fill.imageHash, colorManagementForImagePaint(fill));
        const entry = textureCache.getIfCached(resource);
        if (entry === null) {
          throw new Error(`WebGL image fill ${fill.imageHash} requires prepared texture ${resource.id}`);
        }
        metrics.lastImageDrawCount += 1;
        metrics.lastImageFillDrawCount += 1;
        drawImageFill({
          ctx, vertices, texture: entry.texture, transform,
          opacity: effectiveOpacity, elementSize,
          options: {
            imageWidth: entry.width,
            imageHeight: entry.height,
            scaleMode: fill.scaleMode,
            scalingFactor: fill.scalingFactor,
            imageTransform: fill.imageTransform,
            paintFilter: fill.paintFilter,
          },
        });
        break;
      }

      case "angular-gradient":
        drawAngularGradientFill({ ctx, vertices, fill, transform, opacity, elementSize });
        break;

      case "diamond-gradient":
        drawDiamondGradientFill({ ctx, vertices, fill, transform, opacity, elementSize });
        break;
    }
  }

  function drawFill(
    { vertices, fill, transform, opacity, elementSize, blendRegion }: {
      vertices: Float32Array; fill: Fill; transform: AffineMatrix;
      opacity: number; elementSize: { width: number; height: number };
      blendRegion?: WebGLEffectRenderRegion;
    }
  ): void {
    const browserBlendMode = resolveBrowserRenderedFigmaExportCssBlendMode(fill.blendMode);
    if (browserBlendMode === undefined) {
      drawFillWithoutPaintBlend({ vertices, fill, transform, opacity, elementSize });
      return;
    }
    if (blendRegion === undefined) {
      throw new Error(`WebGL renderer requires an explicit paint blend region for ${fill.type} fill blendMode ${fill.blendMode}`);
    }
    effectRendering.renderBlendedShapeContent({
      blendMode: browserBlendMode,
      region: blendRegion,
      renderContent: () => {
        drawFillWithoutPaintBlend({ vertices, fill, transform, opacity, elementSize });
      },
    });
  }

  /**
   * Draw all fills for a shape node using source fill data.
   * Always draws ALL fills (multi-paint), not just the top fill.
   */
  function drawAllFills(
    { vertices, fills, transform, opacity, elementSize, blendRegion }: {
      vertices: Float32Array; fills: readonly Fill[]; transform: AffineMatrix;
      opacity: number; elementSize: { width: number; height: number };
      blendRegion?: WebGLEffectRenderRegion;
    }
  ): void {
    for (const fill of fills) {
      drawFill({ vertices, fill, transform, opacity, elementSize, blendRegion });
    }
  }

  type StencilFillPaintParams = {
    readonly fanVertices: Float32Array;
    readonly coverQuad: Float32Array;
    readonly transform: AffineMatrix;
    readonly opacity: number;
    readonly elementSize: { readonly width: number; readonly height: number };
    readonly fill: Fill;
    readonly fillRule: StencilFillRule;
    readonly useClipAwareMode: boolean;
  };

  type StencilCoverageParams = {
    readonly fanVertices: Float32Array;
    readonly coverQuad: Float32Array;
    readonly transform: AffineMatrix;
    readonly fillRule: StencilFillRule;
    readonly useClipAwareMode: boolean;
    readonly renderCoveredRegion: () => void;
  };

  function drawStencilCoverage({
    fanVertices,
    coverQuad,
    transform,
    fillRule,
    useClipAwareMode,
    renderCoveredRegion,
  }: StencilCoverageParams): void {
    glState.setEnabled(gl.STENCIL_TEST, true);
    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);

    if (!useClipAwareMode) {
      glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
    }

    if (fillRule === "nonzero") {
      glState.setStencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      glState.setStencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    } else {
      glState.setStencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    }

    drawSolidFill({ ctx: getGlContext(), vertices: fanVertices, color: WHITE, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    if (useClipAwareMode) {
      glState.setStencilFunc(gl.LESS, CLIP_STENCIL_BIT, 0xff);
    } else {
      glState.setStencilFunc(gl.NOTEQUAL, 0, FILL_STENCIL_MASK);
    }

    renderCoveredRegion();

    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.ZERO);

    drawSolidFill({ ctx: getGlContext(), vertices: coverQuad, color: WHITE, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);

    if (useClipAwareMode) {
      glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    } else {
      glState.setEnabled(gl.STENCIL_TEST, false);
    }
  }

  function drawOneStencilFillPaint({
    fanVertices,
    coverQuad,
    transform,
    opacity,
    elementSize,
    fill,
    fillRule,
    useClipAwareMode,
  }: StencilFillPaintParams): void {
    drawStencilCoverage({
      fanVertices,
      coverQuad,
      transform,
      fillRule,
      useClipAwareMode,
      renderCoveredRegion: () => {
        drawFillWithoutPaintBlend({ vertices: coverQuad, fill, transform, opacity, elementSize });
      },
    });
  }

  function drawStencilFill(
    { prepared, fanVertices: providedFanVertices, coverQuad, transform, opacity, elementSize, fills, fillRule }: {
      prepared?: StencilPreparedGeometry;
      fanVertices?: Float32Array;
      coverQuad: Float32Array; transform: AffineMatrix;
      opacity: number; elementSize: { width: number; height: number }; fills: readonly Fill[];
      fillRule?: StencilFillRule;
    }
  ): void {
    const fanVertices = prepared?.fanVertices ?? providedFanVertices;
    if (!fanVertices) { return; }
    const bounds = prepared?.bounds;
    const resolvedFillRule = fillRule ?? "evenodd";
    const useClipAwareMode = clipActive.value && clipStencilValid.value;

    for (const fill of fills) {
      const browserBlendMode = resolveBrowserRenderedFigmaExportCssBlendMode(fill.blendMode);
      if (browserBlendMode === undefined) {
        drawOneStencilFillPaint({
          fanVertices,
          coverQuad,
          transform,
          opacity,
          elementSize,
          fill,
          fillRule: resolvedFillRule,
          useClipAwareMode,
        });
        continue;
      }
      if (bounds === undefined) {
        throw new Error(`WebGL stencil fill blendMode ${fill.blendMode} requires prepared stencil bounds`);
      }
      const region = resolveLocalPaintBlendRegion({
        x: bounds.minX,
        y: bounds.minY,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
      }, transform);
      effectRendering.renderBlendedShapeContent({
        blendMode: browserBlendMode,
        region,
        renderContent: () => {
          drawOneStencilFillPaint({
            fanVertices,
            coverQuad,
            transform,
            opacity,
            elementSize,
            fill,
            fillRule: resolvedFillRule,
            useClipAwareMode: false,
          });
        },
      });
    }
  }

  const effectRendering = createWebGLEffectRendering({
    getGlContext,
    effectsRenderer,
    pixelRatio: () => pixelRatioRef.value,
    canvasWidth: canvasBackingWidth,
    canvasHeight: canvasBackingHeight,
    outputFramebuffer: () => currentEffectOutputFramebuffer.value,
    backdropFramebuffer: () => currentEffectBackdropFramebuffer.value,
    isClipStencilRequired: () => clipActive.value && clipStencilValid.value,
    recordEffectPass: (pass, elapsedMs) => {
      switch (pass) {
        case "background-blur":
          metrics.lastBackgroundBlurPassCount += 1;
          metrics.lastBackgroundBlurRenderMs += elapsedMs;
          return;
        case "drop-shadow":
          metrics.lastDropShadowPassCount += 1;
          metrics.lastDropShadowRenderMs += elapsedMs;
          return;
        case "inner-shadow":
          metrics.lastInnerShadowPassCount += 1;
          metrics.lastInnerShadowRenderMs += elapsedMs;
          return;
      }
    },
    recordInnerShadowBlurSourceCount: (count) => {
      metrics.lastInnerShadowBlurSourceCount += count;
    },
  });

  function recordEffectRegion(region: WebGLEffectRenderRegion): void {
    const pixelCount = region.width * region.height;
    metrics.lastEffectRegionCount += 1;
    metrics.lastEffectRegionPixelCount += pixelCount;
    metrics.lastMaxEffectRegionPixelCount = Math.max(metrics.lastMaxEffectRegionPixelCount, pixelCount);
  }

  function recordEffectCaptureRegion(
    kind: "browser-blend" | "group-opacity" | "layer-blur",
    region: WebGLEffectRenderRegion,
  ): void {
    const pixelCount = region.width * region.height;
    metrics.lastEffectCaptureRegionCount += 1;
    metrics.lastEffectCaptureRegionPixelCount += pixelCount;
    metrics.lastMaxEffectCaptureRegionPixelCount = Math.max(
      metrics.lastMaxEffectCaptureRegionPixelCount,
      pixelCount,
    );
    switch (kind) {
      case "browser-blend":
        metrics.lastBrowserBlendCaptureRegionPixelCount += pixelCount;
        return;
      case "group-opacity":
        metrics.lastGroupOpacityCaptureRegionPixelCount += pixelCount;
        return;
      case "layer-blur":
        metrics.lastLayerBlurCaptureRegionPixelCount += pixelCount;
        return;
    }
  }

  function resolveRenderNodeEffectStackOutputRegion(
    node: RenderNode,
    transform: AffineMatrix,
    effectStack: ResolvedEffectStack,
  ): WebGLEffectRenderRegion {
    const region = resolveWebGLRenderNodeEffectStackOutputRegion({
      node,
      effectStack,
      transform,
      visualTransform: currentRenderNodeVisualTransform.value,
      canvasWidth: canvasBackingWidth(),
      canvasHeight: canvasBackingHeight(),
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectRegion(region);
    return region;
  }

  function fillsRequirePaintBlend(fills: readonly Fill[]): boolean {
    return fills.some((fill) => resolveBrowserRenderedFigmaExportCssBlendMode(fill.blendMode) !== undefined);
  }

  function resolveLocalPaintBlendRegion(
    localBounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
    transform: AffineMatrix,
  ): WebGLEffectRenderRegion {
    const region = resolveWebGLLocalPaintBlendRegion({
      localBounds,
      transform,
      canvasWidth: canvasBackingWidth(),
      canvasHeight: canvasBackingHeight(),
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectRegion(region);
    return region;
  }

  function resolvePaintBlendRegionForLocalBoundsFills(
    fills: readonly Fill[],
    node: RenderFrameNode,
    transform: AffineMatrix,
  ): WebGLEffectRenderRegion | undefined {
    if (!fillsRequirePaintBlend(fills)) {
      return undefined;
    }
    const region = resolveWebGLRenderFrameSurfaceRegion({
      node,
      transform,
      visualTransform: currentRenderNodeVisualTransform.value,
      canvasWidth: canvasBackingWidth(),
      canvasHeight: canvasBackingHeight(),
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectRegion(region);
    return region;
  }

  function resolvePaintBlendRegionForRenderNodeFills(
    fills: readonly Fill[],
    node: RenderNode,
    transform: AffineMatrix,
  ): WebGLEffectRenderRegion | undefined {
    if (!fillsRequirePaintBlend(fills)) {
      return undefined;
    }
    const region = resolveWebGLRenderNodeSourceInputRegion({
      node,
      transform,
      visualTransform: currentRenderNodeVisualTransform.value,
      canvasWidth: canvasBackingWidth(),
      canvasHeight: canvasBackingHeight(),
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectRegion(region);
    return region;
  }

  function recordEffectContentRender(operation: () => void): void {
    const start = performance.now();
    operation();
    metrics.lastEffectContentRenderMs += performance.now() - start;
  }

  function recordEffectStrokeRender(operation: () => void): void {
    const start = performance.now();
    operation();
    metrics.lastEffectStrokeRenderMs += performance.now() - start;
  }

  function resolveFrameSurfaceEffectRegion(
    node: RenderFrameNode,
    transform: AffineMatrix,
    frameSurfaceFilterStack: ResolvedEffectStack,
  ): WebGLEffectRenderRegion {
    const region = resolveWebGLRenderFrameSurfaceFilterRegion({
      node,
      frameSurfaceFilterStack,
      transform,
      canvasWidth: canvasBackingWidth(),
      canvasHeight: canvasBackingHeight(),
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectRegion(region);
    return region;
  }

  function resolveBackgroundBlurRegion(
    node: RenderNode,
    transform: AffineMatrix,
  ): WebGLEffectRenderRegion {
    const backgroundBlur = node.backgroundBlur;
    if (backgroundBlur === undefined) {
      throw new Error(`WebGL background blur region requires RenderTree backgroundBlur for node ${node.id}`);
    }
    const region = resolveWebGLRenderBackgroundBlurRegion({
      backgroundBlur,
      transform,
      canvasWidth: canvasBackingWidth(),
      canvasHeight: canvasBackingHeight(),
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectRegion(region);
    return region;
  }

  // =========================================================================
  // Stroke rendering — uses StrokeRendering discriminated union from RenderTree
  // =========================================================================

  function pathContoursElementSize(contours: readonly PathContour[]): { readonly width: number; readonly height: number } {
    // Control-hull bbox is sufficient here: the result is only used to
    // size gradient stops on stroke paint layers, where the gradient
    // can extend a few pixels past a curve's tight extrema without any
    // visible difference. The flatten-based variant this replaces ran
    // every stroke render and burned per-frame CPU on Bézier
    // subdivision purely to compute width / height.
    const bbox = pathContoursBoundingBox(contours);
    if (!bbox) {
      return { width: 1, height: 1 };
    }
    return { width: Math.max(1, bbox.w), height: Math.max(1, bbox.h) };
  }

  function strokeShapeElementSize(shape: StrokeShape): { readonly width: number; readonly height: number } {
    switch (shape.kind) {
      case "rect":
        return { width: shape.width, height: shape.height };
      case "ellipse":
        return { width: shape.rx * 2, height: shape.ry * 2 };
      case "path": {
        const contours = shape.paths.flatMap((path) => svgPathDToContours({
          d: path.d,
          windingRule: path.fillRule ?? "nonzero",
        }));
        return pathContoursElementSize(contours);
      }
    }
  }

  function drawStrokePaintLayer({
    vertices,
    layer,
    attrs,
    transform,
    opacity,
    elementSize,
  }: {
    readonly vertices: Float32Array;
    readonly layer?: { readonly gradientDef?: ResolvedFillDef; readonly attrs?: { readonly strokeOpacity?: number } };
    readonly attrs: { readonly stroke: string; readonly strokeOpacity?: number };
    readonly transform: AffineMatrix;
    readonly opacity: number;
    readonly elementSize: { readonly width: number; readonly height: number };
  }): void {
    const strokeOpacity = attrs.strokeOpacity ?? layer?.attrs?.strokeOpacity ?? 1;
    const gradientFill = renderPaintCache.fillForResolvedGradientDef(layer?.gradientDef);
    if (gradientFill) {
      drawFill({ vertices, fill: gradientFill, transform, opacity: opacity * strokeOpacity, elementSize });
      return;
    }
    drawSolidFill({
      ctx: getGlContext(),
      vertices,
      color: renderPaintCache.colorForHex(attrs.stroke),
      transform,
      opacity: opacity * strokeOpacity,
    });
  }

  /**
   * Render strokes from the StrokeRendering discriminated union.
   * This is the single stroke rendering path for all node types.
   */
  function renderStrokeRendering(
    sr: StrokeRendering,
    transform: AffineMatrix,
    opacity: number,
  ): void {
    switch (sr.mode) {
      case "uniform":
        // Uniform strokes are rendered inline by each node renderer (which knows
        // the shape geometry for tessellation). This function is not called for
        // uniform mode — callers handle it directly with renderUniformStroke().
        break;

      case "masked": {
        // Stroke with INSIDE/OUTSIDE alignment.
        // SVG renders this as: stroke-width=2× + mask clips to the correct half.
        // WebGL uses stencil: draw fill shape to stencil, then draw 2× stroke
        // with stencil test (INSIDE=inside only, OUTSIDE=outside only).
        const doubledWidth = sr.attrs.strokeWidth ?? 1;
        if (doubledWidth <= 0) { return; }

        const isInside = sr.attrs.strokeAlign === "INSIDE";
        if (sr.shape.kind === "rect") {
          const alignedStrokeVerts = geometryCache.getRectAlignedStrokeVertices({
            width: sr.shape.width,
            height: sr.shape.height,
            cornerRadius: sr.shape.cornerRadius,
            strokeWidth: doubledWidth / 2,
            align: isInside ? "INSIDE" : "OUTSIDE",
          });
          drawStrokePaintLayer({
            vertices: alignedStrokeVerts,
            layer: sr.layer,
            attrs: sr.attrs,
            transform,
            opacity,
            elementSize: { width: sr.shape.width, height: sr.shape.height },
          });
          break;
        }

        // Tessellate the doubled-width stroke
        const strokeVerts = tessellateStrokeShapeFromSR(
          sr.shape,
          doubledWidth,
          renderPaintCache.strokeDashPattern(sr.attrs.strokeDasharray),
        );
        if (strokeVerts.length === 0) { break; }

        // Tessellate the fill shape for stencil mask
        const fillVerts = tessellateShapeForStencil(sr.shape);
        if (fillVerts.length === 0) {
          // No fill shape — draw stroke without masking
          drawStrokePaintLayer({
            vertices: strokeVerts,
            layer: sr.layer,
            attrs: sr.attrs,
            transform,
            opacity,
            elementSize: strokeShapeElementSize(sr.shape),
          });
          break;
        }

        const white: Color = { r: 1, g: 1, b: 1, a: 1 };

        // Save current stencil state (cached, so no sync round-trip).
        const wasStencilEnabled = glState.isStencilTestEnabled();

        // Step 1: Write fill shape to stencil (use FILL_STENCIL_MASK bits)
        glState.setEnabled(gl.STENCIL_TEST, true);
        glState.setColorMask(false, false, false, false);
        glState.setStencilMask(FILL_STENCIL_MASK);
        glState.setStencilFunc(gl.ALWAYS, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
        glState.setStencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        drawSolidFill({ ctx: getGlContext(), vertices: fillVerts, color: white, transform, opacity: 1 });

        // Step 2: Draw doubled stroke, stencil-tested
        // Must respect both fill mask (FILL_STENCIL_MASK) and clip stencil (CLIP_STENCIL_BIT)
        glState.setColorMask(true, true, true, true);
        glState.setStencilMask(0x00);
        if (isInside) {
          // INSIDE: draw where fill stencil is set (inside shape)
          // If clip is active, also require CLIP_STENCIL_BIT
          const ref = clipActive.value ? (CLIP_STENCIL_BIT | FILL_STENCIL_MASK) : FILL_STENCIL_MASK;
          const mask = clipActive.value ? 0xff : FILL_STENCIL_MASK;
          glState.setStencilFunc(gl.EQUAL, ref, mask);
        } else {
          // OUTSIDE: draw where fill stencil is NOT set (outside shape)
          // If clip is active, require CLIP_STENCIL_BIT but NOT FILL_STENCIL_MASK
          const ref = clipActive.value ? CLIP_STENCIL_BIT : 0;
          const mask = clipActive.value ? 0xff : FILL_STENCIL_MASK;
          glState.setStencilFunc(gl.EQUAL, ref, mask);
        }
        glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        drawStrokePaintLayer({
          vertices: strokeVerts,
          layer: sr.layer,
          attrs: sr.attrs,
          transform,
          opacity,
          elementSize: strokeShapeElementSize(sr.shape),
        });

        // Step 3: Clear stencil bits
        glState.setColorMask(false, false, false, false);
        glState.setStencilMask(FILL_STENCIL_MASK);
        glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
        glState.setStencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
        drawSolidFill({ ctx: getGlContext(), vertices: fillVerts, color: white, transform, opacity: 1 });

        // Restore stencil state
        glState.setColorMask(true, true, true, true);
        glState.setStencilMask(0xff);
        if (!wasStencilEnabled) {
          glState.setEnabled(gl.STENCIL_TEST, false);
        } else {
          // Restore clip stencil if active
          glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
          glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        }
        break;
      }

      case "layers": {
        // Multi-paint stroke layers: draw each layer's stroke
        for (const layer of sr.layers) {
          const strokeWidth = layer.attrs.strokeWidth ?? 1;
          if (strokeWidth <= 0) { continue; }

          const strokeVerts = tessellateStrokeShapeFromSR(
            sr.shape,
            strokeWidth,
            renderPaintCache.strokeDashPattern(layer.attrs.strokeDasharray),
          );
          if (strokeVerts.length > 0) {
            drawStrokePaintLayer({
              vertices: strokeVerts,
              layer,
              attrs: layer.attrs,
              transform,
              opacity,
              elementSize: strokeShapeElementSize(sr.shape),
            });
          }
        }
        break;
      }

      case "geometry": {
        renderStrokeGeometry(sr, transform, opacity);
        break;
      }

      case "individual": {
        renderIndividualStroke(sr, transform, opacity);
        break;
      }
    }
  }

  function renderStrokeGeometry(
    sr: StrokeGeometryRendering,
    transform: AffineMatrix,
    opacity: number,
  ): void {
    const geometry = getStrokeGeometryCacheEntry(sr);
    if (geometry.vertices.length === 0) {
      return;
    }
    if (sr.mask === undefined) {
      drawStrokeGeometryLayers(sr, geometry.vertices, geometry.elementSize, transform, opacity);
      return;
    }
    renderMaskedStrokeGeometry(sr, geometry, transform, opacity);
  }

  function drawStrokeGeometryLayers(
    sr: StrokeGeometryRendering,
    vertices: Float32Array,
    elementSize: { readonly width: number; readonly height: number },
    transform: AffineMatrix,
    opacity: number,
  ): void {
    for (const layer of sr.layers) {
      drawStrokePaintLayer({
        vertices,
        layer,
        attrs: layer.attrs,
        transform,
        opacity,
        elementSize,
      });
    }
  }

  function renderMaskedStrokeGeometry(
    sr: StrokeGeometryRendering,
    geometry: StrokeGeometryCacheEntry,
    transform: AffineMatrix,
    opacity: number,
  ): void {
    if (sr.mask === undefined) {
      throw new Error("renderMaskedStrokeGeometry requires a stroke geometry mask");
    }
    const maskVerts = geometryCache.getClipPathShapeVertices(sr.mask.shape);
    if (maskVerts.length === 0) {
      return;
    }

    const white: Color = { r: 1, g: 1, b: 1, a: 1 };
    const wasStencilEnabled = glState.isStencilTestEnabled();
    const stencil = maskedStrokeStencilTest(sr.mask.strokeAlign === "INSIDE");

    glState.setEnabled(gl.STENCIL_TEST, true);
    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    drawSolidFill({ ctx: getGlContext(), vertices: maskVerts, color: white, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0x00);
    glState.setStencilFunc(gl.EQUAL, stencil.ref, stencil.mask);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    drawStrokeGeometryLayers(sr, geometry.vertices, geometry.elementSize, transform, opacity);

    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
    drawSolidFill({ ctx: getGlContext(), vertices: maskVerts, color: white, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);
    if (!wasStencilEnabled) {
      glState.setEnabled(gl.STENCIL_TEST, false);
      return;
    }
    glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  }

  type IndividualStrokeRendering = Extract<StrokeRendering, { readonly mode: "individual" }>;

  function renderIndividualStroke(
    sr: IndividualStrokeRendering,
    transform: AffineMatrix,
    opacity: number,
  ): void {
    if (!requiresIndividualStrokeInteriorClip(sr.cornerRadius, sr.strokeAlign)) {
      drawIndividualStrokeBands(sr, transform, opacity);
      return;
    }

    const clipVertices = geometryCache.getRectVertices(sr.width, sr.height, sr.cornerRadius);
    const white: Color = { r: 1, g: 1, b: 1, a: 1 };
    const wasStencilEnabled = glState.isStencilTestEnabled();

    glState.setEnabled(gl.STENCIL_TEST, true);
    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    drawSolidFill({ ctx: getGlContext(), vertices: clipVertices, color: white, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0x00);
    if (clipActive.value) {
      glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT | FILL_STENCIL_MASK, 0xff);
    } else {
      glState.setStencilFunc(gl.EQUAL, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
    }
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    drawIndividualStrokeBands(sr, transform, opacity);

    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
    drawSolidFill({ ctx: getGlContext(), vertices: clipVertices, color: white, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);
    if (!wasStencilEnabled) {
      glState.setEnabled(gl.STENCIL_TEST, false);
      return;
    }
    if (clipActive.value) {
      glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    }
  }

  function drawIndividualStrokeBands(
    sr: IndividualStrokeRendering,
    transform: AffineMatrix,
    opacity: number,
  ): void {
    const color = renderPaintCache.colorForHex(sr.color);
    const strokeOpacity = sr.opacity ?? 1;
    const { top, right, bottom, left } = sr.sides;
    const w = sr.width;
    const h = sr.height;
    const sign = sr.strokeAlign === "OUTSIDE" ? -1 : sr.strokeAlign === "INSIDE" ? 1 : 0;
    const topY = sign === 1 ? 0 : sign === -1 ? -top : -top / 2;
    const bottomY = sign === 1 ? h - bottom : sign === -1 ? h : h - bottom / 2;
    const leftX = sign === 1 ? 0 : sign === -1 ? -left : -left / 2;
    const rightX = sign === 1 ? w - right : sign === -1 ? w : w - right / 2;
    const resolvedOpacity = opacity * strokeOpacity;

    drawIndividualStrokeBand({ width: w, height: top, x: 0, y: topY, color, transform, opacity: resolvedOpacity });
    drawIndividualStrokeBand({ width: w, height: bottom, x: 0, y: bottomY, color, transform, opacity: resolvedOpacity });
    drawIndividualStrokeBand({ width: left, height: h, x: leftX, y: 0, color, transform, opacity: resolvedOpacity });
    drawIndividualStrokeBand({ width: right, height: h, x: rightX, y: 0, color, transform, opacity: resolvedOpacity });
  }

  function drawIndividualStrokeBand(
    { width: bandWidth, height: bandHeight, x, y, color, transform, opacity }: {
      readonly width: number;
      readonly height: number;
      readonly x: number;
      readonly y: number;
      readonly color: Color;
      readonly transform: AffineMatrix;
      readonly opacity: number;
    },
  ): void {
    if (bandWidth <= 0 || bandHeight <= 0) {
      return;
    }
    const offsetTransform = multiplyMatrices(transform, createTranslationMatrix(x, y));
    const vertices = geometryCache.getRectVertices(bandWidth, bandHeight);
    drawSolidFill({ ctx: getGlContext(), vertices, color, transform: offsetTransform, opacity });
  }

  function requiresIndividualStrokeInteriorClip(
    cornerRadius: CornerRadius | undefined,
    strokeAlign: IndividualStrokeRendering["strokeAlign"],
  ): boolean {
    if (strokeAlign === "OUTSIDE") {
      return false;
    }
    if (cornerRadius === undefined) {
      return false;
    }
    if (typeof cornerRadius === "number") {
      return cornerRadius > 0;
    }
    return cornerRadius.some((radius) => radius > 0);
  }

  /**
   * Tessellate a stroke from its StrokeShape descriptor.
   * Used for non-path shapes (rect, ellipse). Path strokes are handled
   * by the node renderer using sourceContours directly.
   */
  function tessellateShapeForStencil(
    shape: StrokeShape,
  ): Float32Array {
    return geometryCache.getStrokeShapeStencilVertices(shape);
  }

  function tessellateStrokeShapeFromSR(
    shape: StrokeShape,
    strokeWidth: number,
    dashPattern?: readonly number[],
  ): Float32Array {
    return geometryCache.getStrokeShapeStrokeVertices({ shape, strokeWidth, dashPattern });
  }

  /**
   * Render a uniform stroke for a shape node. Used when strokeRendering.mode === "uniform"
   * and the caller knows the shape geometry.
   */
  function renderUniformStroke(
    { sr, sourceStroke, shapeVerticesFactory, transform, opacity }: {
      sr: StrokeRendering & { mode: "uniform" };
      sourceStroke: { width: number; color: Color; opacity: number; dashPattern?: readonly number[] } | undefined;
      shapeVerticesFactory: (strokeWidth: number, dashPattern?: readonly number[]) => Float32Array;
      transform: AffineMatrix;
      opacity: number;
    },
  ): void {
    if (!sourceStroke || sourceStroke.width <= 0) { return; }
    const dashPattern = sourceStroke.dashPattern ?? renderPaintCache.strokeDashPattern(sr.attrs.strokeDasharray);
    const strokeVerts = shapeVerticesFactory(sourceStroke.width, dashPattern);
    if (strokeVerts.length > 0) {
      drawSolidFill({
        ctx: getGlContext(), vertices: strokeVerts,
        color: sourceStroke.color, transform,
        opacity: opacity * sourceStroke.opacity,
      });
    }
  }

  // =========================================================================
  // RenderTree traversal
  // =========================================================================

  function recordRenderedNodeType(node: RenderNode): void {
    switch (node.type) {
      case "group":
        metrics.lastRenderedGroupCount += 1;
        return;
      case "frame":
        metrics.lastRenderedFrameCount += 1;
        return;
      case "rect":
        metrics.lastRenderedRectCount += 1;
        return;
      case "ellipse":
        metrics.lastRenderedEllipseCount += 1;
        return;
      case "path":
        metrics.lastRenderedPathCount += 1;
        return;
      case "text":
        metrics.lastRenderedTextCount += 1;
        return;
      case "image":
        metrics.lastRenderedImageCount += 1;
        return;
    }
  }

  function renderRenderNode(
    node: RenderNode,
    parentTransform: AffineMatrix,
    parentOpacity: number
  ): void {
    // RenderTree already excludes invisible nodes, so no visibility check needed

    const nodeTransform = resolveCurrentRenderNodeTransform(node);
    const worldTransform = multiplyMatrices(parentTransform, nodeTransform);
    if (node.mask !== undefined) {
      renderWithNodeMask({ node, parentTransform, worldTransform, parentOpacity });
      return;
    }

    renderRenderNodeWithResolvedTransform({ node, worldTransform, parentOpacity });
  }

  function resolveCurrentRenderNodeTransform(node: RenderNode): AffineMatrix {
    const transientTranslation = currentTransientNodeTranslation.value;
    if (transientTranslation === undefined) {
      return node.source.transform;
    }
    if (transientTranslation.nodeId !== node.id) {
      return node.source.transform;
    }
    return translateSceneNodeTransform(node.source.transform, transientTranslation.dx, transientTranslation.dy);
  }

  function renderRenderNodeWithResolvedTransform(
    { node, worldTransform, parentOpacity }: {
      readonly node: RenderNode;
      readonly worldTransform: AffineMatrix;
      readonly parentOpacity: number;
    },
  ): void {
    const visibilityViewport = currentVisibilityViewportRect();
    if (visibilityViewport === null) {
      metrics.lastViewportSkippedSubtreeCount += 1;
      return;
    }
    if ((node.type === "group" || node.type === "frame") && !renderNodeIntersectsViewport({
      node,
      transform: worldTransform,
      viewport: visibilityViewport,
      visualTransform: currentRenderNodeVisualTransform.value,
      options: currentContainerSubtreeViewportIntersectionOptions(),
    })) {
      metrics.lastViewportSkippedSubtreeCount += 1;
      return;
    }
    if (node.type !== "group" && node.type !== "frame" && !isVisualNodeInViewport(node, worldTransform)) {
      metrics.lastViewportSkippedNodeCount += 1;
      return;
    }
    metrics.lastRenderedNodeCount += 1;
    recordRenderedNodeType(node);
    // Use wrapper opacity (resolved by RenderTree) — falls back to 1 if undefined
    const nodeOpacity = node.wrapper.opacity ?? 1;
    const worldOpacity = parentOpacity * nodeOpacity;

    const effectPlan = resolveWebGLNodeEffectRenderPlan(node.source.effects);
    if (effectPlan.stack.allEffects.length > 0) {
      metrics.lastEffectNodeCount += 1;
    }
    if (renderNodeWithBrowserCssBlend({
      node,
      worldTransform,
      renderNodeOutput: () => {
        renderRenderNodeWithoutBrowserCssBlend({
          node,
          worldTransform,
          parentOpacity,
          nodeOpacity,
          worldOpacity,
          effectPlan,
        });
      },
    })) {
      return;
    }

    renderRenderNodeWithoutBrowserCssBlend({
      node,
      worldTransform,
      parentOpacity,
      nodeOpacity,
      worldOpacity,
      effectPlan,
    });
  }

  function renderRenderNodeWithoutBrowserCssBlend(
    { node, worldTransform, parentOpacity, nodeOpacity, worldOpacity, effectPlan }: {
      readonly node: RenderNode;
      readonly worldTransform: AffineMatrix;
      readonly parentOpacity: number;
      readonly nodeOpacity: number;
      readonly worldOpacity: number;
      readonly effectPlan: WebGLNodeEffectRenderPlan;
    },
  ): void {
    const layerBlur = effectPlan.layerBlurEffect;
    if (layerBlur) {
      metrics.lastLayerBlurNodeCount += 1;
      renderWithLayerBlur({ node, worldTransform, worldOpacity, effectPlan });
      return;
    }

    if (renderContainerOpacityIfNeeded({ node, worldTransform, parentOpacity, nodeOpacity, effectPlan })) {
      return;
    }

    renderRenderNodeDirect(node, worldTransform, worldOpacity, effectPlan);
  }

  function renderContainerOpacityIfNeeded(
    { node, worldTransform, parentOpacity, nodeOpacity, effectPlan }: {
      readonly node: RenderNode;
      readonly worldTransform: AffineMatrix;
      readonly parentOpacity: number;
      readonly nodeOpacity: number;
      readonly effectPlan: WebGLNodeEffectRenderPlan;
    },
  ): boolean {
    if ((node.type !== "group" && node.type !== "frame") || nodeOpacity >= 1) {
      return false;
    }
    metrics.lastGroupOpacityNodeCount += 1;
    if (canRenderContainerOpacityWithInheritedOpacity({
      node,
      visualTransform: currentRenderNodeVisualTransform.value,
    })) {
      metrics.lastInheritedGroupOpacityNodeCount += 1;
      renderRenderNodeDirect(node, worldTransform, parentOpacity * nodeOpacity, effectPlan);
      return true;
    }
    renderWithGroupOpacity({ node, worldTransform, parentOpacity, nodeOpacity, effectPlan });
    return true;
  }

  function renderWithNodeMask(
    { node, parentTransform, worldTransform, parentOpacity }: {
      readonly node: RenderNode;
      readonly parentTransform: AffineMatrix;
      readonly worldTransform: AffineMatrix;
      readonly parentOpacity: number;
    },
  ): void {
    const mask = node.mask;
    if (mask === undefined) {
      throw new Error(`WebGL node mask dispatch requires a RenderMask on ${node.id}`);
    }
    const maskDef = findRequiredMaskDef(node.defs, mask.maskId, node.id);
    const entry: StencilClipEntry = {
      drawClipShape: () => {
        drawRenderMaskContent(maskDef.maskContent, parentTransform, maskDef.contentRendering);
      },
    };
    clipStack.push(entry);
    markClipStencilNeedsRebuild();
    renderRenderNodeWithResolvedTransform({ node, worldTransform, parentOpacity });
    clipStack.pop();
    markClipStencilNeedsRebuild();
  }

  function restoreOuterClipStencil(wasClipActive: boolean): void {
    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    if (wasClipActive) {
      glState.setEnabled(gl.STENCIL_TEST, true);
      glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      return;
    }

    glState.setEnabled(gl.STENCIL_TEST, false);
  }

  function renderWithEffectCaptureTarget(
    captureFbo: WebGLFramebuffer,
    renderCapturedContent: () => void,
  ): void {
    const previousOutputFramebuffer = currentEffectOutputFramebuffer.value;
    const previousBackdropFramebuffer = currentEffectBackdropFramebuffer.value;
    currentEffectOutputFramebuffer.value = captureFbo;
    currentEffectBackdropFramebuffer.value = captureFbo;
    try {
      renderCapturedContent();
    } finally {
      currentEffectOutputFramebuffer.value = previousOutputFramebuffer;
      currentEffectBackdropFramebuffer.value = previousBackdropFramebuffer;
    }
  }

  function renderNodeWithBrowserCssBlend(
    { node, worldTransform, renderNodeOutput }: {
      readonly node: RenderNode;
      readonly worldTransform: AffineMatrix;
      readonly renderNodeOutput: () => void;
    },
  ): boolean {
    const blendMode = resolveBrowserRenderedFigmaExportCssBlendMode(node.wrapper.blendMode);
    if (blendMode === undefined) {
      return false;
    }

    const canvasBackingWidthValue = canvasBackingWidth();
    const canvasBackingHeightValue = canvasBackingHeight();
    const region = resolveWebGLRenderNodeSubtreeVisualOutputRegion({
      node,
      transform: worldTransform,
      visualTransform: currentRenderNodeVisualTransform.value,
      canvasWidth: canvasBackingWidthValue,
      canvasHeight: canvasBackingHeightValue,
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectCaptureRegion("browser-blend", region);
    const capture = effectsRenderer.beginLayerCapture({
      canvasWidth: canvasBackingWidthValue,
      canvasHeight: canvasBackingHeightValue,
      region,
    });
    invalidateStateAfterRawEffectRendererCall();

    try {
      const savedClipStack = clipStack.splice(0);
      const hadOuterClip = savedClipStack.length > 0;
      clipActive.value = false;
      markClipStencilNeedsRebuild();

      renderWithEffectCaptureTarget(capture.framebuffer.fbo, renderNodeOutput);

      clipStack.push(...savedClipStack);
      clipActive.value = hadOuterClip;
      markClipStencilNeedsRebuild();

      glState.setEnabled(gl.BLEND, true);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );
      restoreOuterClipStencil(hadOuterClip);

      effectsRenderer.blendCapturedLayer({
        canvasWidth: canvasBackingWidthValue,
        canvasHeight: canvasBackingHeightValue,
        region,
        sourceFramebuffer: capture.framebuffer,
        blendMode,
        outputFramebuffer: currentEffectOutputFramebuffer.value,
        backdropFramebuffer: currentEffectBackdropFramebuffer.value,
        requireClipStencil: hadOuterClip,
      });
      invalidateStateAfterRawEffectRendererCall();
      markClipStencilNeedsRebuild();
      return true;
    } finally {
      effectsRenderer.releaseLayerCapture(capture);
    }
  }

  /**
   * Render a container node with isolated group opacity via FBO.
   */
  function renderWithGroupOpacity(
    { node, worldTransform, parentOpacity, nodeOpacity, effectPlan }: {
      node: RenderNode; worldTransform: AffineMatrix; parentOpacity: number; nodeOpacity: number; effectPlan: WebGLNodeEffectRenderPlan;
    }
  ): void {
    const groupOpacityStart = performance.now();
    const canvasBackingWidthValue = canvasBackingWidth();
    const canvasBackingHeightValue = canvasBackingHeight();
    // Foreground blur consumes the composed foreground stack, including
    // co-authored drop/inner shadows. Use the same source-effect bounds
    // as the shared SVG filter resolver instead of sizing this FBO from
    // the layer-blur radius alone.
    const region = resolveWebGLRenderNodeSubtreeVisualOutputRegion({
      node,
      transform: worldTransform,
      visualTransform: currentRenderNodeVisualTransform.value,
      canvasWidth: canvasBackingWidthValue,
      canvasHeight: canvasBackingHeightValue,
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectCaptureRegion("group-opacity", region);

    // Effects rendering binds its own FBO programs and changes
    // stencil/blend state directly. Invalidate the state cache after
    // each call so subsequent setters know they can't trust the
    // previous cached values.
    const capture = effectsRenderer.beginLayerCapture({
      canvasWidth: canvasBackingWidthValue,
      canvasHeight: canvasBackingHeightValue,
      region,
    });
    invalidateStateAfterRawEffectRendererCall();

    // Children render into the framebuffer with no outer clip applied.
    // `beginLayerCapture` already cleared the capture-region framebuffer stencil and
    // disabled STENCIL_TEST, so we swap `clipStack` for an empty
    // one and mark the deferred rebuild as needed so the first draw
    // inside the framebuffer re-derives state for an empty clip stack.
    const savedClipStack = clipStack.splice(0);
    // `clipActive.value` only updates on flush; if previous siblings
    // pushed and popped without an intervening draw, it lags reality.
    // Derive the outer-clip-active state from the real stack length.
    const hadOuterClip = savedClipStack.length > 0;
    clipActive.value = false;
    markClipStencilNeedsRebuild();

    try {
      renderWithEffectCaptureTarget(capture.framebuffer.fbo, () => {
        // Render children at full parent opacity (no node opacity yet)
        renderRenderNodeDirect(node, worldTransform, parentOpacity, effectPlan);
      });

      clipStack.push(...savedClipStack);
      clipActive.value = hadOuterClip;
      markClipStencilNeedsRebuild();

      glState.setEnabled(gl.BLEND, true);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );

      restoreOuterClipStencil(hadOuterClip);

      effectsRenderer.blitLayerWithOpacity({
        canvasWidth: canvasBackingWidthValue,
        canvasHeight: canvasBackingHeightValue,
        region,
        sourceFramebuffer: capture.framebuffer,
        opacity: nodeOpacity,
        outputFramebuffer: currentEffectOutputFramebuffer.value,
        requireClipStencil: hadOuterClip,
      });
      invalidateStateAfterRawEffectRendererCall();
      markClipStencilNeedsRebuild();
      const elapsed = performance.now() - groupOpacityStart;
      metrics.lastGroupOpacityRenderMs += elapsed;
      metrics.lastEffectRenderMs += elapsed;
    } finally {
      effectsRenderer.releaseLayerCapture(capture);
    }
  }

  function renderRenderNodeDirect(
    node: RenderNode,
    worldTransform: AffineMatrix,
    worldOpacity: number,
    effectPlan: WebGLRenderableNodeEffectPlan,
  ): void {
    switch (node.type) {
      case "group":
        renderGroupFromTree(node, worldTransform, worldOpacity);
        break;
      case "frame":
        renderFrameFromTree(node, worldTransform, worldOpacity, effectPlan);
        break;
      case "rect":
        renderRectFromTree(node, worldTransform, worldOpacity, effectPlan);
        break;
      case "ellipse":
        renderEllipseFromTree(node, worldTransform, worldOpacity, effectPlan);
        break;
      case "path":
        renderPathFromTree(node, worldTransform, worldOpacity, effectPlan);
        break;
      case "text":
        renderTextFromTree(node, worldTransform, worldOpacity);
        break;
      case "image":
        renderImageFromTree(node, worldTransform, worldOpacity);
        break;
    }
  }

  function renderFrameBackgroundBlurMask(
    node: RenderFrameNode,
    worldTransform: AffineMatrix,
    effect: BackgroundBlurSceneEffect,
  ): void {
    effectRendering.renderBackgroundBlurMask({
      effect,
      region: resolveBackgroundBlurRegion(node, worldTransform),
      vertices: resolveClipVertices(node.sourceSurfaceShape),
      transform: worldTransform,
    });
  }

  function renderRectBackgroundBlurMask(
    node: RenderRectNode,
    worldTransform: AffineMatrix,
    effect: BackgroundBlurSceneEffect,
  ): void {
    effectRendering.renderBackgroundBlurMask({
      effect,
      region: resolveBackgroundBlurRegion(node, worldTransform),
      vertices: geometryCache.getRectVertices(node.width, node.height, node.cornerRadius, node.cornerSmoothing),
      transform: worldTransform,
    });
  }

  function renderEllipseBackgroundBlurMask(
    node: RenderEllipseNode,
    worldTransform: AffineMatrix,
    effect: BackgroundBlurSceneEffect,
  ): void {
    effectRendering.renderBackgroundBlurMask({
      effect,
      region: resolveBackgroundBlurRegion(node, worldTransform),
      vertices: geometryCache.getEllipseVertices({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry }),
      transform: worldTransform,
    });
  }

  function renderPathBackgroundBlurMask(
    node: RenderPathNode,
    worldTransform: AffineMatrix,
    effect: BackgroundBlurSceneEffect,
  ): void {
    effectRendering.renderBackgroundBlurMask({
      effect,
      region: resolveBackgroundBlurRegion(node, worldTransform),
      vertices: geometryCache.getPathGeometry(node).backgroundMaskVertices,
      transform: worldTransform,
    });
  }

  function renderNodeBackgroundBlurMask(
    node: RenderNode,
    worldTransform: AffineMatrix,
    effect: BackgroundBlurSceneEffect,
  ): void {
    switch (node.type) {
      case "frame":
        renderFrameBackgroundBlurMask(node, worldTransform, effect);
        return;
      case "rect":
        renderRectBackgroundBlurMask(node, worldTransform, effect);
        return;
      case "ellipse":
        renderEllipseBackgroundBlurMask(node, worldTransform, effect);
        return;
      case "path":
        renderPathBackgroundBlurMask(node, worldTransform, effect);
        return;
      case "group":
      case "text":
      case "image":
        throw new Error(`WebGL node ${node.id} cannot render background blur without shape geometry`);
    }
  }

  function renderWithLayerBlur(
    { node, worldTransform, worldOpacity, effectPlan }: {
      node: RenderNode; worldTransform: AffineMatrix; worldOpacity: number; effectPlan: WebGLNodeEffectRenderPlan;
    }
  ): void {
    const layerBlurEffect = effectPlan.layerBlurEffect;
    if (layerBlurEffect === null) {
      throw new Error(`WebGL layer blur render plan for node ${node.id} is missing layer blur effect`);
    }
    if (!shouldRenderWebGLBlurFramebufferPass({
      radius: layerBlurEffect.radius,
      transform: worldTransform,
      pixelRatio: pixelRatioRef.value,
    })) {
      renderLayerBlurCapturedContentWithoutFramebuffer({ node, worldTransform, worldOpacity, effectPlan });
      return;
    }
    const layerBlurStart = performance.now();
    const canvasBackingWidthValue = canvasBackingWidth();
    const canvasBackingHeightValue = canvasBackingHeight();
    const region = resolveWebGLRenderNodeSubtreeVisualOutputRegion({
      node,
      transform: worldTransform,
      visualTransform: currentRenderNodeVisualTransform.value,
      canvasWidth: canvasBackingWidthValue,
      canvasHeight: canvasBackingHeightValue,
      pixelRatio: pixelRatioRef.value,
    });
    recordEffectCaptureRegion("layer-blur", region);
    if (effectPlan.backgroundBlurMaskEffect !== null) {
      renderNodeBackgroundBlurMask(node, worldTransform, effectPlan.backgroundBlurMaskEffect);
    }

    const capture = effectsRenderer.beginLayerCapture({
      canvasWidth: canvasBackingWidthValue,
      canvasHeight: canvasBackingHeightValue,
      region,
    });
    invalidateStateAfterRawEffectRendererCall();

    const savedClipStack = clipStack.splice(0);
    const hadOuterClip = savedClipStack.length > 0;
    clipActive.value = false;
    markClipStencilNeedsRebuild();

    try {
      renderWithEffectCaptureTarget(capture.framebuffer.fbo, () => {
        renderRenderNodeDirect(
          node,
          worldTransform,
          worldOpacity,
          {
            stack: effectPlan.layerBlurCapturedContentStack,
            backgroundBlurMaskEffect: null,
            frameSurfaceFilterStack: effectPlan.layerBlurCapturedFrameSurfaceFilterStack,
          },
        );
      });

      clipStack.push(...savedClipStack);
      clipActive.value = hadOuterClip;
      markClipStencilNeedsRebuild();

      glState.setEnabled(gl.BLEND, true);
      gl.blendFuncSeparate(
        gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
        gl.ONE, gl.ONE_MINUS_SRC_ALPHA
      );

      restoreOuterClipStencil(hadOuterClip);

      effectsRenderer.endLayerCaptureAndBlur({
        canvasWidth: canvasBackingWidthValue,
        canvasHeight: canvasBackingHeightValue,
        region,
        sourceFramebuffer: capture.framebuffer,
        effect: layerBlurEffect,
        worldToBacking: resolveEffectBackingScale(worldTransform, pixelRatioRef.value),
        outputFramebuffer: currentEffectOutputFramebuffer.value,
        requireClipStencil: hadOuterClip,
      });
      invalidateStateAfterRawEffectRendererCall();
      markClipStencilNeedsRebuild();
      const elapsed = performance.now() - layerBlurStart;
      metrics.lastLayerBlurRenderMs += elapsed;
      metrics.lastEffectRenderMs += elapsed;
    } finally {
      effectsRenderer.releaseLayerCapture(capture);
    }
  }

  function renderLayerBlurCapturedContentWithoutFramebuffer(
    { node, worldTransform, worldOpacity, effectPlan }: {
      readonly node: RenderNode;
      readonly worldTransform: AffineMatrix;
      readonly worldOpacity: number;
      readonly effectPlan: WebGLNodeEffectRenderPlan;
    },
  ): void {
    const backgroundBlurMaskEffect = effectPlan.backgroundBlurMaskEffect;
    if (backgroundBlurMaskEffect !== null) {
      renderNodeBackgroundBlurMask(node, worldTransform, backgroundBlurMaskEffect);
    }
    renderRenderNodeDirect(
      node,
      worldTransform,
      worldOpacity,
      {
        stack: effectPlan.layerBlurCapturedContentStack,
        backgroundBlurMaskEffect: null,
        frameSurfaceFilterStack: effectPlan.layerBlurCapturedFrameSurfaceFilterStack,
      },
    );
  }

  // =========================================================================
  // Node-type renderers — use RenderTree fields for dimensions/geometry,
  // source* fields for GPU data, StrokeRendering for stroke dispatch
  // =========================================================================

  function renderGroupFromTree(node: RenderGroupNode, transform: AffineMatrix, opacity: number): void {
    const childClipId = node.childClipId;
    if (childClipId) {
      pushRenderTreeClip({ defs: node.defs, clipId: childClipId, nodeId: node.id, transform });
    }

    for (const child of node.children) {
      renderRenderNode(child, transform, opacity);
    }

    if (childClipId) {
      clipStack.pop();
      markClipStencilNeedsRebuild();
    }
  }

  function findRequiredMaskDef(
    defs: readonly RenderDef[],
    maskId: string,
    nodeId: string,
  ): RenderMaskDef {
    const maskDef = defs.find(
      (d): d is RenderMaskDef =>
        d.type === "mask" && d.id === maskId
    );
    if (maskDef === undefined) {
      throw new Error(`RenderTree node ${nodeId} references missing mask ${maskId}`);
    }
    return maskDef;
  }

  function drawMaskVertices(vertices: Float32Array, transform: AffineMatrix): void {
    if (vertices.length === 0) {
      return;
    }
    drawSolidFill({
      ctx: getGlContext(),
      vertices,
      color: BLACK,
      transform,
      opacity: 1,
    });
  }

  function drawRenderMaskContent(
    node: RenderNode,
    parentTransform: AffineMatrix,
    contentRendering: RenderMaskDef["contentRendering"],
  ): void {
    const transform = multiplyMatrices(parentTransform, node.source.transform);
    switch (node.type) {
      case "group":
        drawRenderGroupMaskContent(node, transform, contentRendering);
        return;
      case "frame":
        drawRenderFrameMaskContent(node, transform, contentRendering);
        return;
      case "rect":
        drawRenderRectMaskContent(node, transform, contentRendering);
        return;
      case "ellipse":
        if (!shouldDrawMaskShape(node, contentRendering)) {
          return;
        }
        drawMaskVertices(geometryCache.getEllipseVertices({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry }), transform);
        return;
      case "path":
        if (!shouldDrawMaskShape(node, contentRendering)) {
          return;
        }
        drawMaskVertices(geometryCache.getPathGeometry(node).backgroundMaskVertices, transform);
        return;
      case "text":
        drawRenderTextMaskContent(node, transform);
        return;
      case "image":
        throw new Error(`WebGL mask content ${node.id} requires image-alpha masking support`);
    }
  }

  function drawRenderGroupMaskContent(
    node: RenderGroupNode,
    transform: AffineMatrix,
    contentRendering: RenderMaskDef["contentRendering"],
  ): void {
    for (const child of node.children) {
      drawRenderMaskContent(child, transform, contentRendering);
    }
  }

  function drawRenderFrameMaskContent(
    node: RenderFrameNode,
    transform: AffineMatrix,
    contentRendering: RenderMaskDef["contentRendering"],
  ): void {
    if (contentRendering === "geometry-coverage" || node.background !== null || node.backgroundBlur !== undefined) {
      drawMaskVertices(resolveClipVertices(node.sourceSurfaceShape), transform);
    }
    for (const child of node.children) {
      drawRenderMaskContent(child, transform, contentRendering);
    }
  }

  function drawRenderRectMaskContent(
    node: RenderRectNode,
    transform: AffineMatrix,
    contentRendering: RenderMaskDef["contentRendering"],
  ): void {
    if (!shouldDrawMaskShape(node, contentRendering)) {
      return;
    }
    drawMaskVertices(geometryCache.getRectVertices(node.width, node.height, node.cornerRadius, node.cornerSmoothing), transform);
  }

  function shouldDrawMaskShape(
    node: RenderRectNode | RenderEllipseNode | RenderPathNode,
    contentRendering: RenderMaskDef["contentRendering"],
  ): boolean {
    if (contentRendering === "geometry-coverage") {
      return true;
    }
    return node.sourceFills.length > 0 || node.strokeRendering !== undefined || node.filterSource === "effect-shape";
  }

  function drawRenderTextMaskContent(node: RenderTextNode, transform: AffineMatrix): void {
    if (node.content.mode !== "glyphs") {
      throw new Error(`WebGL text mask node ${node.id} requires glyph geometry`);
    }
    const { runs } = geometryCache.getTextGlyphGeometry(node);
    for (const run of runs) {
      drawMaskVertices(run.vertices, transform);
    }
  }

  function findRequiredClipPathDef(
    defs: readonly RenderDef[],
    clipId: string,
    nodeId: string,
  ): RenderClipPathDef {
    const clipDef = defs.find(
      (d): d is RenderClipPathDef =>
        d.type === "clip-path" && d.id === clipId
    );
    if (clipDef === undefined) {
      throw new Error(`RenderTree node ${nodeId} references missing clip-path ${clipId}`);
    }
    return clipDef;
  }

  function resolveClipPathDefData(
    { clipDef, transform }: {
      clipDef: RenderClipPathDef;
      transform: AffineMatrix;
    },
  ): { clip: ClipShape; transform: AffineMatrix } {
    if (clipDef.transform !== undefined) {
      throw new Error(`WebGL clip-path ${clipDef.id} carries an SVG transform and cannot be consumed as a render stencil`);
    }
    if (clipDef.shape.kind === "path") {
      // `clipDef.shape` belongs to the cached `node.defs` entry, so its
      // object reference stays stable across viewport-only renders. Caching the
      // parsed contours on the shape object keeps pan/zoom from
      // re-running `parseSvgPathD` on the clip data every frame.
      return {
        clip: { type: "path", contours: getCachedClipPathContours(clipDef.shape) },
        transform,
      };
    }

    if (clipDef.shape.kind === "rect") {
      // `clipDef.shape.x/y` is in node-local space; `transform` is the
      // composed world transform (incl. viewport scale on m00/m11). The
      // local translation must compose through `multiplyMatrices`, not
      // be added to m02/m12 directly — otherwise the clip rect lands at
      // the wrong distance from the frame origin at viewport scale != 1.
      const clipTransform = multiplyMatrices(transform, createTranslationMatrix(clipDef.shape.x, clipDef.shape.y));
      return {
        clip: {
          type: "rect",
          width: clipDef.shape.width,
          height: clipDef.shape.height,
          cornerRadius: clipDef.shape.rx,
        },
        transform: clipTransform,
      };
    }
    throw new Error(`Unsupported clip-path shape ${clipDef.shape.kind}`);
  }

  function cornerRadiusHasPositiveValue(cornerRadius: CornerRadius | undefined): boolean {
    if (cornerRadius === undefined) {
      return false;
    }
    if (typeof cornerRadius === "number") {
      return cornerRadius > 0;
    }
    return cornerRadius.some((radius) => radius > 0);
  }

  function resolveAxisAlignedRectScissorClipBox(
    clip: ClipShape,
    transform: AffineMatrix,
  ): WebGLScissorClipBox | undefined {
    if (clip.type !== "rect" || cornerRadiusHasPositiveValue(clip.cornerRadius)) {
      return undefined;
    }
    if (transform.m01 !== 0 || transform.m10 !== 0) {
      return undefined;
    }
    const x0 = transform.m02;
    const x1 = transform.m02 + transform.m00 * clip.width;
    const y0 = transform.m12;
    const y1 = transform.m12 + transform.m11 * clip.height;
    const pixelRatio = pixelRatioRef.value;
    const left = Math.floor(Math.min(x0, x1) * pixelRatio);
    const right = Math.ceil(Math.max(x0, x1) * pixelRatio);
    const top = Math.floor(Math.min(y0, y1) * pixelRatio);
    const bottom = Math.ceil(Math.max(y0, y1) * pixelRatio);
    const clampedLeft = Math.max(0, Math.min(canvasBackingWidth(), left));
    const clampedRight = Math.max(0, Math.min(canvasBackingWidth(), right));
    const clampedTop = Math.max(0, Math.min(canvasBackingHeight(), top));
    const clampedBottom = Math.max(0, Math.min(canvasBackingHeight(), bottom));
    return {
      x: clampedLeft,
      y: canvasBackingHeight() - clampedBottom,
      width: Math.max(0, clampedRight - clampedLeft),
      height: Math.max(0, clampedBottom - clampedTop),
    };
  }

  function resolveViewportRectScissorClipBox(viewport: ViewportRect): WebGLScissorClipBox {
    const pixelRatio = pixelRatioRef.value;
    const left = Math.floor(viewport.x * pixelRatio);
    const right = Math.ceil((viewport.x + viewport.width) * pixelRatio);
    const top = Math.floor(viewport.y * pixelRatio);
    const bottom = Math.ceil((viewport.y + viewport.height) * pixelRatio);
    const clampedLeft = Math.max(0, Math.min(canvasBackingWidth(), left));
    const clampedRight = Math.max(0, Math.min(canvasBackingWidth(), right));
    const clampedTop = Math.max(0, Math.min(canvasBackingHeight(), top));
    const clampedBottom = Math.max(0, Math.min(canvasBackingHeight(), bottom));
    return {
      x: clampedLeft,
      y: canvasBackingHeight() - clampedBottom,
      width: Math.max(0, clampedRight - clampedLeft),
      height: Math.max(0, clampedBottom - clampedTop),
    };
  }

  function scissorClipBoxToEffectRenderRegion(scissorBox: WebGLScissorClipBox): WebGLEffectRenderRegion {
    return {
      x: scissorBox.x,
      y: scissorBox.y,
      width: scissorBox.width,
      height: scissorBox.height,
    };
  }

  function viewportRectFromBounds(bounds: Bounds): ViewportRect | undefined {
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    if (width <= 0 || height <= 0) {
      return undefined;
    }
    return {
      x: bounds.minX,
      y: bounds.minY,
      width,
      height,
    };
  }

  function resolveClipVisibilityViewport(clip: ClipShape, transform: AffineMatrix): ViewportRect | undefined {
    return viewportRectFromBounds(transformBounds(getClipShapeLocalBounds(clip), transform));
  }

  function pushRenderTreeClip(
    { defs, clipId, nodeId, transform }: {
      defs: readonly RenderDef[];
      clipId: string;
      nodeId: string;
      transform: AffineMatrix;
    },
  ): void {
    const clipDef = findRequiredClipPathDef(defs, clipId, nodeId);
    const clipData = resolveClipPathDefData({ clipDef, transform });
    const clipVertices = resolveClipVertices(clipData.clip);
    const clipTransform = clipData.transform;
    const entry: WebGLRendererClipEntry = {
      scissorBox: resolveAxisAlignedRectScissorClipBox(clipData.clip, clipTransform),
      visibilityViewport: resolveClipVisibilityViewport(clipData.clip, clipTransform),
      drawClipShape: () => {
        drawSolidFill({
          ctx: getGlContext(),
          vertices: clipVertices,
          color: BLACK,
          transform: clipTransform,
          opacity: 1,
        });
      },
    };
    clipStack.push(entry);
    markClipStencilNeedsRebuild();
  }


  function resolveFrameUniformStrokeVertices(
    surfaceShape: ClipShape,
    strokeWidth: number,
    dashPattern: readonly number[] | undefined,
  ): Float32Array {
    switch (surfaceShape.type) {
      case "rect":
        return geometryCache.getRectStrokeVertices({
          width: surfaceShape.width,
          height: surfaceShape.height,
          cornerRadius: surfaceShape.cornerRadius,
          strokeWidth,
          dashPattern,
        });
      case "path":
        return geometryCache.getPathContourStrokeVertices({
          contours: surfaceShape.contours,
          strokeWidth,
          dashPattern,
        });
    }
  }

  function renderFrameFromTree(
    node: RenderFrameNode,
    transform: AffineMatrix,
    opacity: number,
    effectPlan: WebGLRenderableNodeEffectPlan,
  ): void {
    const elementSize = { width: node.width, height: node.height };
    const vertices = resolveClipVertices(node.sourceSurfaceShape);
    const childClipId = resolveFrameChildClipIdForCurrentViewport(node, transform);

    if (effectPlan.backgroundBlurMaskEffect !== null) {
      renderFrameBackgroundBlurMask(node, transform, effectPlan.backgroundBlurMaskEffect);
    }

    const renderedSurfaceFilter = renderFrameSurfaceFilterIfNeeded({
      node,
      transform,
      opacity,
      effectPlan,
      elementSize,
      vertices,
    });
    if (!renderedSurfaceFilter) {
      renderFrameSurfaceAndChildrenContent({
        node,
        transform,
        opacity,
        elementSize,
        vertices,
        childClipId,
        skipFrameSurfaceOutsideViewport: true,
      });
    } else {
      renderFrameChildrenWithClip({ node, transform, opacity, childClipId });
    }

    renderFrameSeparateStrokeIfVisible(node, transform, opacity);
  }

  function renderFrameSurfaceFilterIfNeeded(
    { node, transform, opacity, elementSize, vertices, effectPlan }: {
      readonly node: RenderFrameNode;
      readonly transform: AffineMatrix;
      readonly opacity: number;
      readonly elementSize: { readonly width: number; readonly height: number };
      readonly vertices: Float32Array;
      readonly effectPlan: WebGLRenderableNodeEffectPlan;
    },
  ): boolean {
    if (node.surfaceFilterAttr === undefined || effectPlan.frameSurfaceFilterStack.allEffects.length === 0) {
      return false;
    }
    const shapeStart = performance.now();
    const region = resolveFrameSurfaceEffectRegion(node, transform, effectPlan.frameSurfaceFilterStack);
    const effectStart = performance.now();
    const renderContent = (): void => {
      renderFrameBackgroundFillIfPresent({
        node,
        transform,
        opacity,
        elementSize,
        vertices,
        skipFrameSurfaceOutsideViewport: false,
      });
    };
    const renderStroke = (): void => {
      renderFrameUniformStrokeIfPresent(node, transform, opacity);
    };
    effectRendering.renderVertexShapeEffectStack({
      stack: effectPlan.frameSurfaceFilterStack,
      hasVisibleContent: renderFrameSurfaceFilterHasVisibleContent(node),
      region,
      vertices,
      transform,
      resolvedNodeOpacity: opacity,
      renderContent: () => recordEffectContentRender(renderContent),
      renderStroke: () => recordEffectStrokeRender(renderStroke),
    });
    metrics.lastEffectRenderMs += performance.now() - effectStart;
    metrics.lastShapeRenderMs += performance.now() - shapeStart;
    return true;
  }

  function renderFrameSurfaceFilterHasVisibleContent(node: RenderFrameNode): boolean {
    if (node.sourceFills.length > 0) {
      return true;
    }
    return node.background?.strokeRendering?.mode === "uniform";
  }

  function renderFrameSurfaceAndChildrenContent(
    { node, transform, opacity, elementSize, vertices, childClipId, skipFrameSurfaceOutsideViewport }: {
      readonly node: RenderFrameNode;
      readonly transform: AffineMatrix;
      readonly opacity: number;
      readonly elementSize: { readonly width: number; readonly height: number };
      readonly vertices: Float32Array;
      readonly childClipId: RenderFrameNode["childClipId"];
      readonly skipFrameSurfaceOutsideViewport: boolean;
    },
  ): void {
    renderFrameBackgroundFillAndUniformStroke({
      node,
      transform,
      opacity,
      elementSize,
      vertices,
      skipFrameSurfaceOutsideViewport,
    });
    renderFrameChildrenWithClip({ node, transform, opacity, childClipId });
  }

  function renderFrameBackgroundFillAndUniformStroke(
    { node, transform, opacity, elementSize, vertices, skipFrameSurfaceOutsideViewport }: {
      readonly node: RenderFrameNode;
      readonly transform: AffineMatrix;
      readonly opacity: number;
      readonly elementSize: { readonly width: number; readonly height: number };
      readonly vertices: Float32Array;
      readonly skipFrameSurfaceOutsideViewport: boolean;
    },
  ): void {
    if (node.background === null) {
      return;
    }
    renderFrameBackgroundFillIfPresent({
      node,
      transform,
      opacity,
      elementSize,
      vertices,
      skipFrameSurfaceOutsideViewport,
    });
    renderFrameUniformStrokeIfPresent(node, transform, opacity);
  }

  function renderFrameBackgroundFillIfPresent(
    { node, transform, opacity, elementSize, vertices, skipFrameSurfaceOutsideViewport }: {
      readonly node: RenderFrameNode;
      readonly transform: AffineMatrix;
      readonly opacity: number;
      readonly elementSize: { readonly width: number; readonly height: number };
      readonly vertices: Float32Array;
      readonly skipFrameSurfaceOutsideViewport: boolean;
    },
  ): void {
    if (node.background === null) {
      return;
    }
    if (skipFrameSurfaceOutsideViewport && !isVisualNodeInViewport(node, transform)) {
      return;
    }
    if (node.sourceFills.length > 0) {
      flushClipStencilIfRebuildNeeded();
      const blendRegion = resolvePaintBlendRegionForLocalBoundsFills(
        node.sourceFills,
        node,
        transform,
      );
      drawAllFills({ vertices, fills: node.sourceFills, transform, opacity, elementSize, blendRegion });
    }
  }

  function renderFrameUniformStrokeIfPresent(
    node: RenderFrameNode,
    transform: AffineMatrix,
    opacity: number,
  ): void {
    const sr = node.background?.strokeRendering;
    if (sr?.mode !== "uniform") {
      return;
    }
    const sourceStroke = node.sourceStroke;
    if (!sourceStroke || sourceStroke.width <= 0) { return; }
    flushClipStencilIfRebuildNeeded();
    renderUniformStroke({
      sr,
      sourceStroke,
      shapeVerticesFactory: (strokeWidth, dashPattern) => resolveFrameUniformStrokeVertices(
        node.sourceSurfaceShape,
        strokeWidth,
        dashPattern,
      ),
      transform,
      opacity,
    });
  }

  function renderFrameChildrenWithClip(
    { node, transform, opacity, childClipId }: {
      readonly node: RenderFrameNode;
      readonly transform: AffineMatrix;
      readonly opacity: number;
      readonly childClipId: RenderFrameNode["childClipId"];
    },
  ): void {
    if (childClipId) {
      pushRenderTreeClip({ defs: node.defs, clipId: childClipId, nodeId: node.id, transform });
    }
    for (const child of node.children) {
      renderRenderNode(child, transform, opacity);
    }
    if (childClipId) {
      clipStack.pop();
      markClipStencilNeedsRebuild();
    }
  }

  function renderFrameSeparateStrokeIfVisible(
    node: RenderFrameNode,
    transform: AffineMatrix,
    opacity: number,
  ): void {
    const sr = node.background?.strokeRendering;
    if (sr === undefined || sr.mode === "uniform") {
      return;
    }
    if (!isVisualNodeInViewport(node, transform)) {
      return;
    }
    const strokeStart = performance.now();
    flushClipStencilIfRebuildNeeded();
    renderStrokeRendering(sr, transform, opacity);
    metrics.lastShapeRenderMs += performance.now() - strokeStart;
  }

  function renderRectFromTree(
    node: RenderRectNode,
    transform: AffineMatrix,
    opacity: number,
    effectPlan: WebGLRenderableNodeEffectPlan,
  ): void {
    const shapeStart = performance.now();
    const effects = effectPlan.stack.allEffects;
    // Use RenderTree fields for dimensions
    const elementSize = { width: node.width, height: node.height };
    const vertices = geometryCache.getRectVertices(node.width, node.height, node.cornerRadius, node.cornerSmoothing);

    // Skip effects when node has no visible content (fill=none + no stroke → empty silhouette)
    const hasVisibleContent = node.sourceFills.length > 0 || !!node.strokeRendering;
    if (effects.length === 0 && !hasVisibleContent) {
      metrics.lastShapeRenderMs += performance.now() - shapeStart;
      return;
    }
    flushClipStencilIfRebuildNeeded();
    const renderContent = (): void => {
      if (node.sourceFills.length > 0) {
        const blendRegion = resolvePaintBlendRegionForRenderNodeFills(
          node.sourceFills,
          node,
          transform,
        );
        drawAllFills({ vertices, fills: node.sourceFills, transform, opacity, elementSize, blendRegion });
      }
    };
    const renderStroke = (): void => {
      if (!node.strokeRendering) { return; }
      const sr = node.strokeRendering;
      if (sr.mode === "uniform") {
        renderUniformStroke({
          sr,
          sourceStroke: node.sourceStroke,
          shapeVerticesFactory: (sw, dashPattern) => geometryCache.getRectStrokeVertices({
            width: node.width,
            height: node.height,
            cornerRadius: node.cornerRadius,
            strokeWidth: sw,
            dashPattern,
          }),
          transform,
          opacity,
        });
        return;
      }
      renderStrokeRendering(sr, transform, opacity);
    };
    if (effects.length === 0) {
      renderContent();
      renderStroke();
      metrics.lastShapeRenderMs += performance.now() - shapeStart;
      return;
    }
    const region = resolveRenderNodeEffectStackOutputRegion(node, transform, effectPlan.stack);

    const effectStart = performance.now();
    effectRendering.renderVertexShapeEffectStack({
      stack: effectPlan.stack,
      hasVisibleContent,
      region,
      vertices,
      transform,
      resolvedNodeOpacity: opacity,
      renderContent: () => recordEffectContentRender(renderContent),
      renderStroke: () => recordEffectStrokeRender(renderStroke),
    });
    metrics.lastEffectRenderMs += performance.now() - effectStart;
    metrics.lastShapeRenderMs += performance.now() - shapeStart;
  }

  function renderEllipseFromTree(
    node: RenderEllipseNode,
    transform: AffineMatrix,
    opacity: number,
    effectPlan: WebGLRenderableNodeEffectPlan,
  ): void {
    const shapeStart = performance.now();
    const effects = effectPlan.stack.allEffects;
    const elementSize = { width: node.rx * 2, height: node.ry * 2 };
    const vertices = geometryCache.getEllipseVertices({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry });

    const hasVisibleContent = node.sourceFills.length > 0 || !!node.strokeRendering;
    if (effects.length === 0 && !hasVisibleContent) {
      metrics.lastShapeRenderMs += performance.now() - shapeStart;
      return;
    }
    flushClipStencilIfRebuildNeeded();
    const renderContent = (): void => {
      if (node.sourceFills.length > 0) {
        const blendRegion = resolvePaintBlendRegionForRenderNodeFills(
          node.sourceFills,
          node,
          transform,
        );
        drawAllFills({ vertices, fills: node.sourceFills, transform, opacity, elementSize, blendRegion });
      }
    };
    const renderStroke = (): void => {
      if (!node.strokeRendering) { return; }
      const sr = node.strokeRendering;
      if (sr.mode === "uniform") {
        renderUniformStroke({
          sr,
          sourceStroke: node.sourceStroke,
          shapeVerticesFactory: (sw, dashPattern) => geometryCache.getEllipseStrokeVertices({
            cx: node.cx,
            cy: node.cy,
            rx: node.rx,
            ry: node.ry,
            strokeWidth: sw,
            dashPattern,
          }),
          transform,
          opacity,
        });
        return;
      }
      renderStrokeRendering(sr, transform, opacity);
    };
    if (effects.length === 0) {
      renderContent();
      renderStroke();
      metrics.lastShapeRenderMs += performance.now() - shapeStart;
      return;
    }
    const region = resolveRenderNodeEffectStackOutputRegion(node, transform, effectPlan.stack);

    const effectStart = performance.now();
    effectRendering.renderVertexShapeEffectStack({
      stack: effectPlan.stack,
      hasVisibleContent,
      region,
      vertices,
      transform,
      resolvedNodeOpacity: opacity,
      renderContent: () => recordEffectContentRender(renderContent),
      renderStroke: () => recordEffectStrokeRender(renderStroke),
    });
    metrics.lastEffectRenderMs += performance.now() - effectStart;
    metrics.lastShapeRenderMs += performance.now() - shapeStart;
  }

  function maskedStrokeStencilTest(isInside: boolean): { readonly ref: number; readonly mask: number } {
    if (isInside && clipActive.value) {
      return { ref: CLIP_STENCIL_BIT | FILL_STENCIL_MASK, mask: 0xff };
    }
    if (isInside) {
      return { ref: FILL_STENCIL_MASK, mask: FILL_STENCIL_MASK };
    }
    if (clipActive.value) {
      return { ref: CLIP_STENCIL_BIT, mask: 0xff };
    }
    return { ref: 0, mask: FILL_STENCIL_MASK };
  }

  function renderPathUniformStroke(
    { node, contours, transform, opacity }: {
      readonly node: RenderPathNode;
      readonly contours: readonly PathContour[];
      readonly transform: AffineMatrix;
      readonly opacity: number;
    },
  ): void {
    const sourceStroke = node.sourceStroke;
    if (!sourceStroke || sourceStroke.width <= 0) { return; }
    const strokeVerts = geometryCache.getPathStrokeVertices({
      node,
      contours,
      strokeWidth: sourceStroke.width,
      dashPattern: sourceStroke.dashPattern,
    });
    if (strokeVerts.length === 0) { return; }
    drawSolidFill({
      ctx: getGlContext(), vertices: strokeVerts,
      color: sourceStroke.color, transform,
      opacity: opacity * sourceStroke.opacity,
    });
  }

  function renderPathStrokeLayers(
    { sr, node, contours, elementSize, transform, opacity }: {
      readonly sr: Extract<StrokeRendering, { readonly mode: "layers" }>;
      readonly node: RenderPathNode;
      readonly contours: readonly PathContour[];
      readonly elementSize: { readonly width: number; readonly height: number };
      readonly transform: AffineMatrix;
      readonly opacity: number;
    },
  ): void {
    for (const layer of sr.layers) {
      const strokeWidth = layer.attrs.strokeWidth ?? 1;
      if (strokeWidth <= 0) { continue; }
      const strokeVerts = geometryCache.getPathStrokeVertices({
        node,
        contours,
        strokeWidth,
        dashPattern: renderPaintCache.strokeDashPattern(layer.attrs.strokeDasharray),
      });
      if (strokeVerts.length === 0) { continue; }
      drawStrokePaintLayer({
        vertices: strokeVerts,
        layer,
        attrs: layer.attrs,
        transform,
        opacity,
        elementSize,
      });
    }
  }

  function renderPathMaskedStroke(
    { sr, node, contours, fillVerts, elementSize, transform, opacity }: {
      readonly sr: Extract<StrokeRendering, { readonly mode: "masked" }>;
      readonly node: RenderPathNode;
      readonly contours: readonly PathContour[];
      readonly fillVerts: Float32Array;
      readonly elementSize: { readonly width: number; readonly height: number };
      readonly transform: AffineMatrix;
      readonly opacity: number;
    },
  ): void {
    const strokeWidth = sr.attrs.strokeWidth ?? 1;
    if (strokeWidth <= 0) { return; }
    const strokeVerts = geometryCache.getPathStrokeVertices({
      node,
      contours,
      strokeWidth,
      dashPattern: renderPaintCache.strokeDashPattern(sr.attrs.strokeDasharray),
    });
    if (strokeVerts.length === 0 || fillVerts.length === 0) { return; }

    const white: Color = { r: 1, g: 1, b: 1, a: 1 };
    const wasStencilEnabled = glState.isStencilTestEnabled();
    const stencil = maskedStrokeStencilTest(sr.attrs.strokeAlign === "INSIDE");

    glState.setEnabled(gl.STENCIL_TEST, true);
    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    drawSolidFill({ ctx: getGlContext(), vertices: fillVerts, color: white, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0x00);
    glState.setStencilFunc(gl.EQUAL, stencil.ref, stencil.mask);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    drawStrokePaintLayer({
      vertices: strokeVerts,
      layer: sr.layer,
      attrs: sr.attrs,
      transform,
      opacity,
      elementSize,
    });

    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
    drawSolidFill({ ctx: getGlContext(), vertices: fillVerts, color: white, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);
    if (!wasStencilEnabled) {
      glState.setEnabled(gl.STENCIL_TEST, false);
      return;
    }
    glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
  }

  function renderPathStrokeFromTree(
    { node, contours, transform, opacity }: {
      node: RenderPathNode; contours: readonly PathContour[]; transform: AffineMatrix; opacity: number;
    },
  ): void {
    if (!node.strokeRendering) { return; }
    const sr = node.strokeRendering;
    if (sr.mode === "uniform") {
      renderPathUniformStroke({ node, contours, transform, opacity });
      return;
    }
    // Stroke paint layers and the masked-stroke fill mask both need the
    // node's element-size and (for masked) the closed-contour fill
    // tessellation. Both are stable across viewport-only renders, so we
    // pull them from the per-node geometry cache rather than rebuilding
    // them from the contour stream on every frame.
    const pathGeometry = geometryCache.getPathGeometry(node);
    if (sr.mode === "layers") {
      renderPathStrokeLayers({ sr, node, contours, elementSize: pathGeometry.elementSize, transform, opacity });
      return;
    }
    if (sr.mode === "masked") {
      renderPathMaskedStroke({
        sr,
        node,
        contours,
        fillVerts: pathGeometry.backgroundMaskVertices,
        elementSize: pathGeometry.elementSize,
        transform,
        opacity,
      });
      return;
    }
    if (sr.mode === "geometry") {
      renderStrokeGeometry(sr, transform, opacity);
    }
  }

  function renderPathFromTree(
    node: RenderPathNode,
    transform: AffineMatrix,
    opacity: number,
    effectPlan: WebGLRenderableNodeEffectPlan,
  ): void {
    const pathStart = performance.now();
    const effects = effectPlan.stack.allEffects;
    // Use RenderTree's paths[].d (SVG path strings) as the single source of truth.
    // This ensures WebGL renders the exact same geometry as SVG — including
    // shapes generated by the resolver (ellipse arcs, donut rings, etc.)
    // that have no sourceContours.
    if (node.paths.length === 0) { return; }
    const hasVisibleContent = node.sourceFills.length > 0 || !!node.strokeRendering;
    if (effects.length === 0 && !hasVisibleContent) {
      metrics.lastPathRenderMs += performance.now() - pathStart;
      return;
    }
    flushClipStencilIfRebuildNeeded();
    const pathGeometry = geometryCache.getPathGeometry(node);
    const { parsedContours, pathVertices, backgroundMaskVertices, dropShadowSilhouetteVertices } = pathGeometry;
    const fillPlan = geometryCache.getPathFillPlanGeometry(node);
    const renderContent = (): void => {
      if (node.sourceFills.length === 0) { return; }
      // The per-instruction fan triangles, cover quad, and element
      // size are stable across viewport-only renders, so we cache
      // them on the node and reuse them every pan/zoom frame instead
      // of re-flattening every contour Bézier here.
      for (const instruction of fillPlan.instructions) {
        const fills = renderPaintCache.fillsForResolvedFillOverride(instruction.fillOverride, node.sourceFills);
        if (fills.length === 0) {
          continue;
        }
        drawStencilFill({
          prepared: instruction.prepared,
          coverQuad: instruction.coverQuad,
          transform,
          opacity,
          elementSize: instruction.elementSize,
          fills,
          fillRule: instruction.fillRule,
        });
      }
    };
    const renderStroke = (): void => {
      renderPathStrokeFromTree({ node, contours: parsedContours, transform, opacity });
    };
    if (effects.length === 0) {
      renderContent();
      renderStroke();
      metrics.lastPathRenderMs += performance.now() - pathStart;
      return;
    }
    const region = resolveRenderNodeEffectStackOutputRegion(node, transform, effectPlan.stack);

    const effectStart = performance.now();
    renderShapeEffectStack({
      stack: effectPlan.stack,
      hasVisibleContent,
      renderBackgroundBlur: (effect) => {
        if (backgroundMaskVertices.length > 0) {
          effectRendering.renderBackgroundBlurMask({ effect, region, vertices: backgroundMaskVertices, transform });
        }
      },
      renderDropShadows: (dropShadowEffects) => {
        if (dropShadowSilhouetteVertices.length > 0) {
          effectRendering.renderDropShadowsWithSilhouette({
            effects: dropShadowEffects,
            region,
            transform,
            resolvedNodeOpacity: opacity,
            renderSilhouette: () => {
              drawSolidFill({ ctx: getGlContext(), vertices: dropShadowSilhouetteVertices, color: WHITE, transform, opacity: 1 });
            },
          });
          return;
        }
        if (pathVertices.length > 0) {
          effectRendering.renderDropShadows({
            effects: dropShadowEffects,
            region,
            vertices: pathVertices,
            transform,
            resolvedNodeOpacity: opacity,
          });
        }
      },
      renderContent: () => recordEffectContentRender(renderContent),
      renderInnerShadows: (innerShadowEffects) => {
        if (backgroundMaskVertices.length > 0) {
          effectRendering.renderInnerShadows({
            effects: innerShadowEffects,
            region,
            vertices: backgroundMaskVertices,
            transform,
            resolvedNodeOpacity: opacity,
          });
        }
      },
      renderStroke: () => recordEffectStrokeRender(renderStroke),
    });
    metrics.lastEffectRenderMs += performance.now() - effectStart;
    metrics.lastPathRenderMs += performance.now() - pathStart;
  }

  function requireTextGlyphBlendBounds(
    runGeo: ReturnType<ReturnType<typeof createWebGLGeometryCache>["getTextGlyphGeometry"]>["runs"][number],
    nodeId: string,
  ): NonNullable<typeof runGeo.prepared>["bounds"] {
    const bounds = runGeo.prepared?.bounds;
    if (bounds === undefined) {
      throw new Error(`WebGL text glyph blend requires prepared glyph bounds for text node ${nodeId}`);
    }
    return bounds;
  }

  function renderGlyphTextFromTree(node: RenderTextNode, transform: AffineMatrix, opacity: number): void {
    if (node.content.mode !== "glyphs") { return; }
    if (node.content.runs.length === 0) { return; }

    const { runs } = geometryCache.getTextGlyphGeometry(node);
    for (const runGeo of runs) {
      if (runGeo.vertices.length === 0) { continue; }
      const runColor = renderPaintCache.colorForHex(runGeo.fillColor);
      metrics.lastTextGlyphRunDrawCount += 1;
      // Text glyphs paint via earcut-tessellated triangles, NOT the
      // INVERT-mode stencil fill we use for general SVG paths. The
      // stencil-fill path fans triangles from a shared anchor (or per
      // contour anchor) and relies on parity flips along the swept
      // edges to colour the interior. For glyph outlines with closed
      // counters (a, b, d, e, g, o, p, q…) this produces single-pixel
      // notches inside the bowl whenever an edge crosses exactly on a
      // pixel boundary the top-left rasterisation rule excludes — the
      // adjacent triangles "agree" that the pixel is outside even
      // though it is structurally inside the closed outline. earcut
      // emits a proper triangulation that covers every interior pixel
      // exactly once, so no notches; outer/hole detection in
      // `tessellateContours` handles glyph counters (autoDetectWinding
      // is the third arg, true → respect Figma's CFF winding).
      const browserBlendMode = resolveBrowserRenderedFigmaExportCssBlendMode(runGeo.blendMode);
      if (browserBlendMode !== undefined) {
        const bounds = requireTextGlyphBlendBounds(runGeo, node.id);
        const region = resolveLocalPaintBlendRegion({
          x: bounds.minX,
          y: bounds.minY,
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
        }, transform);
        effectRendering.renderBlendedShapeContent({
          blendMode: browserBlendMode,
          region,
          renderContent: () => {
            drawSolidFill({
              ctx: getGlContext(),
              vertices: runGeo.vertices,
              color: runColor,
              transform,
              opacity: opacity * runGeo.fillOpacity,
            });
          },
        });
        continue;
      }
      drawSolidFill({
        ctx: getGlContext(),
        vertices: runGeo.vertices,
        color: runColor,
        transform,
        opacity: opacity * runGeo.fillOpacity,
      });
    }
  }

  function renderTextGlyphContentFromTree(
    node: RenderTextNode,
    transform: AffineMatrix,
    opacity: number,
    textStart: number,
  ): void {
    if (node.content.mode !== "glyphs") {
      throw new Error(`WebGL text renderer expected glyph content for text node ${node.id}`);
    }
    if (node.content.runs.length === 0) {
      metrics.lastTextRenderMs += performance.now() - textStart;
      return;
    }
    flushClipStencilIfRebuildNeeded();
    renderGlyphTextFromTree(node, transform, opacity);
    metrics.lastTextRenderMs += performance.now() - textStart;
  }

  function renderTextFromTree(node: RenderTextNode, transform: AffineMatrix, opacity: number): void {
    const textStart = performance.now();

    // Use RenderTree content as the single source of truth.
    // Both SVG and WebGL consume the same content representation.
    if (node.content.mode === "glyphs") {
      renderTextGlyphContentFromTree(node, transform, opacity, textStart);
      return;
    }

    if (!hasVisibleLineText(node.content)) {
      metrics.lastTextRenderMs += performance.now() - textStart;
      return;
    }
    throw new Error(`WebGL text renderer requires glyph contours for text node ${node.id}`);
  }

  function renderImageFromTree(node: RenderImageNode, transform: AffineMatrix, opacity: number): void {
    const imageStart = performance.now();
    const entry = textureCache.getIfCached(imageTextureResource(node.sourceImageHash, colorManagementForImageNode(node)));
    if (!entry) {
      throw new Error(`WebGL image node ${node.id} requires prepared texture ${node.sourceImageHash}`);
    }
    flushClipStencilIfRebuildNeeded();

    const vertices = geometryCache.getRectVertices(node.width, node.height);
    const elementSize = { width: node.width, height: node.height };
    metrics.lastImageDrawCount += 1;
    metrics.lastImageNodeDrawCount += 1;
    drawImageFill({
      ctx: getGlContext(), vertices, texture: entry.texture, transform, opacity, elementSize,
      options: { imageWidth: entry.width, imageHeight: entry.height, scaleMode: node.sourceScaleMode },
    });
    metrics.lastImageRenderMs += performance.now() - imageStart;
  }

  return {
    isScenePrepared(scene: SceneGraph): boolean {
      const renderTree = renderTreeCache.get(scene, { exportSettings: options.exportSettings });
      const preparations = visibleTexturePreparations(renderTree);
      const visibleResourceKey = createWebGLVisibleResourcePreparationKey({
        scene,
        visibleTextureResourceIds: visibleTextureResourceIds(preparations),
      });
      if (!areWebGLVisibleResourcePreparationKeysEqual(
        preparedVisibleResourceKey.value,
        visibleResourceKey,
      )) {
        return false;
      }
      return allVisibleTexturePreparationsReady(preparations);
    },

    async prepareScene(scene: SceneGraph): Promise<void> {
      const renderTree = renderTreeCache.get(scene, { exportSettings: options.exportSettings });
      width.value = scene.width;
      height.value = scene.height;
      const preparations = visibleTexturePreparations(renderTree);
      const visibleResourceKey = createWebGLVisibleResourcePreparationKey({
        scene,
        visibleTextureResourceIds: visibleTextureResourceIds(preparations),
      });
      const missingPreparations = missingVisibleTexturePreparations(preparations);
      metrics.lastVisibleTexturePreparationCount = preparations.length;
      metrics.lastMissingVisibleTexturePreparationCount = missingPreparations.length;
      metrics.lastTextureUploadCount = missingPreparations.length;
      const isPreparedSourceResource = areWebGLVisibleResourcePreparationKeysEqual(
        preparedVisibleResourceKey.value,
        visibleResourceKey,
      );
      const areVisibleTexturesReady = allVisibleTexturePreparationsReady(preparations);
      const start = performance.now();
      vertexBuffers.resetFrameMetrics();
      prepareVisibleVertexBuffers(renderTree);
      effectsRenderer.prepareSurface({
        canvasWidth: canvasBackingWidth(),
        canvasHeight: canvasBackingHeight(),
      });
      invalidateStateAfterRawEffectRendererCall();
      const vertexBufferMetrics = vertexBuffers.getFrameMetrics();
      metrics.lastPrepareStaticVertexBufferCreationCount = vertexBufferMetrics.staticBufferCreationCount;
      metrics.lastPrepareStaticVertexBufferUploadByteLength = vertexBufferMetrics.staticBufferUploadByteLength;
      metrics.lastPrepareStaticVertexBufferReleaseCount = vertexBufferMetrics.staticBufferReleaseCount;
      if (
        isPreparedSourceResource &&
        areVisibleTexturesReady
      ) {
        metrics.prepareCount += 1;
        metrics.lastPrepareMs = performance.now() - start;
        return;
      }
      await prepareMissingVisibleTextures(preparations);
      metrics.lastMissingVisibleTexturePreparationCount = 0;
      metrics.prepareCount += 1;
      metrics.lastPrepareMs = performance.now() - start;
      preparedVisibleResourceKey.value = visibleResourceKey;
    },

    precompileResources(): void {
      resourceContext.precompile();
      effectsRenderer.precompileShaders();
    },

    render(scene: SceneGraph, frameOptions?: WebGLRenderFrameOptions): void {
      const start = performance.now();
      const frameReason = frameOptions?.frameReason ?? "settled";
      currentRenderFrameReason.value = frameReason;
      metrics.lastRenderFrameReason = frameReason;
      metrics.lastRenderTreeResolveMs = 0;
      metrics.lastNodeTraversalMs = 0;
      metrics.lastSettledFrameCacheCaptureMs = 0;
      metrics.lastSettledFrameCacheRestoreMs = 0;
      metrics.lastSettledFrameCacheRegionCopyMs = 0;
      metrics.lastRenderedNodeCount = 0;
      metrics.lastRenderedGroupCount = 0;
      metrics.lastRenderedFrameCount = 0;
      metrics.lastRenderedRectCount = 0;
      metrics.lastRenderedEllipseCount = 0;
      metrics.lastRenderedPathCount = 0;
      metrics.lastRenderedTextCount = 0;
      metrics.lastRenderedImageCount = 0;
      metrics.lastViewportSkippedNodeCount = 0;
      metrics.lastViewportSkippedSubtreeCount = 0;
      metrics.lastEffectNodeCount = 0;
      metrics.lastLayerBlurNodeCount = 0;
      metrics.lastGroupOpacityNodeCount = 0;
      metrics.lastInheritedGroupOpacityNodeCount = 0;
      metrics.lastImageDrawCount = 0;
      metrics.lastImageFillDrawCount = 0;
      metrics.lastImageNodeDrawCount = 0;
      metrics.lastTextGlyphRunDrawCount = 0;
      metrics.lastClipStencilFlushCount = 0;
      metrics.lastClipStencilFlushMs = 0;
      metrics.lastShapeRenderMs = 0;
      metrics.lastPathRenderMs = 0;
      metrics.lastTextRenderMs = 0;
      metrics.lastImageRenderMs = 0;
      metrics.lastEffectRenderMs = 0;
      metrics.lastBackgroundBlurRenderMs = 0;
      metrics.lastDropShadowRenderMs = 0;
      metrics.lastInnerShadowRenderMs = 0;
      metrics.lastEffectContentRenderMs = 0;
      metrics.lastEffectStrokeRenderMs = 0;
      metrics.lastGroupOpacityRenderMs = 0;
      metrics.lastLayerBlurRenderMs = 0;
      metrics.lastBackgroundBlurPassCount = 0;
      metrics.lastDropShadowPassCount = 0;
      metrics.lastInnerShadowPassCount = 0;
      metrics.lastInnerShadowBlurSourceCount = 0;
      metrics.lastEffectRegionCount = 0;
      metrics.lastEffectRegionPixelCount = 0;
      metrics.lastMaxEffectRegionPixelCount = 0;
      metrics.lastEffectCaptureRegionCount = 0;
      metrics.lastEffectCaptureRegionPixelCount = 0;
      metrics.lastMaxEffectCaptureRegionPixelCount = 0;
      metrics.lastBrowserBlendCaptureRegionPixelCount = 0;
      metrics.lastGroupOpacityCaptureRegionPixelCount = 0;
      metrics.lastLayerBlurCaptureRegionPixelCount = 0;
      metrics.lastRenderDynamicVertexBufferBindCount = 0;
      metrics.lastRenderDynamicVertexBufferUploadCount = 0;
      metrics.lastRenderDynamicVertexBufferUploadByteLength = 0;
      metrics.lastRenderStaticVertexBufferBindCount = 0;
      metrics.lastRenderStaticVertexBufferCreationCount = 0;
      metrics.lastRenderStaticVertexBufferUploadByteLength = 0;
      metrics.lastRenderStaticVertexBufferReleaseCount = 0;
      metrics.lastRenderStaticVertexBufferCount = 0;
      vertexBuffers.resetFrameMetrics();
      width.value = scene.width;
      height.value = scene.height;
      const canvas = gl.canvas;
      // The renderer's `style.width/height` calls below require the
      // DOM-attached `HTMLCanvasElement`. `WebGL{,2}RenderingContext.canvas`
      // is typed `HTMLCanvasElement | OffscreenCanvas`; a runtime check
      // narrows to the DOM variant without an `as` cast and surfaces a
      // clear error if the renderer is ever wired to an OffscreenCanvas
      // (which would silently lose the CSS sizing).
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("WebGL renderer: gl.canvas is not an HTMLCanvasElement (OffscreenCanvas not supported)");
      }
      syncWebGLCanvasRenderSurface({
        canvas,
        width: scene.width,
        height: scene.height,
        pixelRatio: pixelRatioRef.value,
      });

      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.SCISSOR_TEST);
      activeScissorClipBox.value = null;

      clipActive.value = false;
      clipStencilValid.value = false;
      clipStack.length = 0;
      // Drop the GL state cache because external subsystems may have
      // run between frames (text editing, debug overlays). Subsequent
      // setters and vertex binds in this frame will write fresh values.
      glState.invalidate();
      vertexBuffers.invalidateArrayBufferBinding();
      effectsRenderer.setRendererOutputRegion(null);
      invalidateClipStencilState();

      const renderTreeResolveStart = performance.now();
      const renderTree = renderTreeCache.get(scene, { exportSettings: options.exportSettings });
      metrics.lastRenderTreeResolveMs = performance.now() - renderTreeResolveStart;
      const viewportTransform = viewportToSurfaceTransform(renderTree);
      const traversalStart = performance.now();
      renderFrameFromRenderTree({ scene, renderTree, viewportTransform, frameOptions });
      metrics.lastNodeTraversalMs = performance.now() - traversalStart;
      const vertexBufferMetrics = vertexBuffers.getFrameMetrics();
      metrics.lastRenderDynamicVertexBufferBindCount = vertexBufferMetrics.dynamicBufferBindCount;
      metrics.lastRenderDynamicVertexBufferUploadCount = vertexBufferMetrics.dynamicBufferUploadCount;
      metrics.lastRenderDynamicVertexBufferUploadByteLength = vertexBufferMetrics.dynamicBufferUploadByteLength;
      metrics.lastRenderStaticVertexBufferBindCount = vertexBufferMetrics.staticBufferBindCount;
      metrics.lastRenderStaticVertexBufferCreationCount = vertexBufferMetrics.staticBufferCreationCount;
      metrics.lastRenderStaticVertexBufferUploadByteLength = vertexBufferMetrics.staticBufferUploadByteLength;
      metrics.lastRenderStaticVertexBufferReleaseCount = vertexBufferMetrics.staticBufferReleaseCount;
      metrics.lastRenderStaticVertexBufferCount = vertexBufferMetrics.staticBufferCount;
      metrics.renderCount += 1;
      recordCompletedRenderMetrics(performance.now() - start);
    },

    setPixelRatio(pixelRatio: number): void {
      const nextPixelRatio = requireWebGLRendererPixelRatio(pixelRatio);
      if (pixelRatioRef.value !== nextPixelRatio) {
        deleteSettledFrameCache();
      }
      pixelRatioRef.value = nextPixelRatio;
    },

    getMetrics(): WebGLFigmaRendererMetrics {
      return { ...metrics };
    },

    dispose(): void {
      resourceContext.dispose();
      preparedVisibleResourceKey.value = null;
      deleteSettledFrameCache();
      effectsRenderer.dispose();
      geometryCache.dispose();
    },
  };
}
