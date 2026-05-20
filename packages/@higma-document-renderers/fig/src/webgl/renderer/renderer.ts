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
 * - node.source.effects for WebGL effect rendering (drop shadow, inner shadow,
 *   layer blur require raw effect params for FBO-based GPU rendering — the
 *   RenderTree's resolved filter defs are SVG-specific)
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

import type { SceneGraph, Fill, Color, LayerBlurEffect, Effect, PathContour, ClipShape } from "@higma-document-renderers/fig/scene-graph";
import { buildEffectStack, renderShapeEffectStack, resolveFigmaRenderExportSettings, requireManagedImageColorProfile, type FigmaRenderExportSettings, type ResolvedFigmaRenderExportSettings, type ResolvedFillDef, } from "../../scene-graph";

import {
  type RenderNode, type RenderGroupNode, type RenderFrameNode, type RenderRectNode, type RenderEllipseNode, type RenderPathNode, type RenderTextNode, type RenderImageNode, type RenderNodeBase, type RenderDef, type StrokeRendering, type StrokeShape, type RenderClipPathDef, } from "../../scene-graph";

import {
  generateRectVertices, tessellateContours, } from "../tessellation/tessellation";
import {
  drawSolidFill, drawLinearGradientFill, drawRadialGradientFill, drawAngularGradientFill, drawDiamondGradientFill, drawImageFill, type GLContext, } from "../fill/fill-renderer";
import { imageTextureResource, type TextureColorManagement } from "../resources/texture-resource";
import { IDENTITY_MATRIX, multiplyMatrices, createTranslationMatrix } from "@higma-document-models/fig/matrix";
import { rebuildStencilClipStack, type StencilClipEntry } from "../effects/clip-mask";
import { createGLStateCache } from "../state/gl-state-cache";
import {
  tessellateRectStroke, tessellateRectAlignedStroke, tessellateEllipseStroke, tessellatePathStroke, } from "../tessellation/stroke-tessellation";
import { createEffectsRenderer } from "../effects/effects-renderer";
import { createWebGLEffectRendering } from "../effects/effect-rendering";
import { resolveEffectBackingScale } from "../effects/effect-scale";
import { shouldRenderVisualNode, type ViewportRect } from "../scene/render-culling";
import { createWebGLFigmaResourceContext, type WebGLFigmaResourceContext } from "../resources/resource-context";
import {
  prepareFanTriangles, CLIP_STENCIL_BIT, FILL_STENCIL_MASK, } from "../tessellation/stencil-fill";
import { pathContoursBoundingBox } from "@higma-primitives/path";
import { svgPathDToContours } from "../tessellation/path-contours";
import { syncWebGLCanvasRenderSurface } from "../scene/render-surface";
import type { WebGLPathFillRule } from "../fill/render-path-fill-plan";
import { hasVisibleLineText } from "../text/text-visibility";
import { createWebGLGeometryCache } from "../resources/geometry-cache";
import type { AffineMatrix, CornerRadius } from "@higma-primitives/path";

// =============================================================================
// Types
// =============================================================================

export type WebGLRendererOptions = {
  /** WebGL canvas element or rendering context */
  readonly canvas: HTMLCanvasElement;
  /** Device pixel ratio (default: window.devicePixelRatio) */
  readonly pixelRatio?: number;
  /** Antialias (default: true) */
  readonly antialias?: boolean;
  /** Background color (default: white) */
  readonly backgroundColor?: Color;
  /** Central resource owner for caches and precompiled GPU programs. */
  readonly resourceContext?: WebGLFigmaResourceContext;
  readonly exportSettings?: FigmaRenderExportSettings;
};

export type WebGLFigmaRendererMetrics = {
  readonly prepareCount: number;
  readonly renderCount: number;
  readonly lastPrepareMs: number;
  readonly lastRenderMs: number;
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
  render(scene: SceneGraph): void;
  setPixelRatio(pixelRatio: number): void;
  getMetrics(): WebGLFigmaRendererMetrics;
  dispose(): void;
};

/** Create a WebGL renderer for Figma scene graphs */
export function createWebGLFigmaRenderer(options: WebGLRendererOptions): WebGLFigmaRendererInstance {
  const glOrNull = options.canvas.getContext("webgl", {
    antialias: options.antialias ?? true,
    alpha: true,
    premultipliedAlpha: false,
    stencil: true,
    preserveDrawingBuffer: true,
  });

  if (!glOrNull) {
    throw new Error("WebGL not supported");
  }

  // Reassign after null guard so TypeScript narrows correctly in closures
  const gl: WebGLRenderingContext = glOrNull;
  const exportSettings = resolveFigmaRenderExportSettings(options.exportSettings);
  configureWebGLColorProfile(gl, exportSettings);

  const pixelRatioRef = { value: options.pixelRatio ?? (typeof window !== "undefined" ? window.devicePixelRatio : 1) };
  const backgroundColor = options.backgroundColor ?? { r: 1, g: 1, b: 1, a: 1 };
  const resourceContext = options.resourceContext ?? createWebGLFigmaResourceContext(gl);
  const shaders = resourceContext.shaders;
  const textureCache = resourceContext.textures;
  const effectsRenderer = createEffectsRenderer(gl);
  const width = { value: 0 };
  const height = { value: 0 };
  const clipActive = { value: false };
  const clipStencilValid = { value: false };
  const renderTreeCache = resourceContext.renderTrees;
  const sceneResources = resourceContext.sceneResources;
  const preparedSceneResourceKey = { value: null as ReturnType<typeof sceneResources.get> | null };
  const metrics = {
    prepareCount: 0,
    renderCount: 0,
    lastPrepareMs: 0,
    lastRenderMs: 0,
  };
  const clipStack: StencilClipEntry[] = [];

  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error("Failed to create buffer");
  }
  const positionBuffer = buffer;
  /**
   * Tracks the last `Float32Array` uploaded to `positionBuffer`.
   * `bindPositionBufferVertices` consults this to skip
   * `gl.bufferData` when the same cached array is being rebound —
   * the typical case during clip-stencil rebuilds and back-to-back
   * draws that share a `geometryCache` entry. Effects rendering
   * uses its own VBOs, so this tracker stays valid for the renderer's
   * lifetime.
   */
  const positionBufferUpload: { value: Float32Array | null } = { value: null };
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
  const BLACK: Color = { r: 0, g: 0, b: 0, a: 1 };

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
      positionBuffer,
      positionBufferUpload,
      width: width.value,
      height: height.value,
      pixelRatio: pixelRatioRef.value,
    };
  }

  type StencilFillRule = WebGLPathFillRule;

  type StencilPreparedGeometry = NonNullable<ReturnType<typeof prepareFanTriangles>>;

  // =========================================================================
  // Image preloading — walk RenderTree, use source* fields for image data
  // =========================================================================

  function currentViewportRect(): ViewportRect {
    return { x: 0, y: 0, width: width.value, height: height.value };
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
    return shouldRenderVisualNode({
      node,
      transform,
      viewport: currentViewportRect(),
    });
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
   * Push / pop mutate `clipStack` and flip `clipStencilDirty`. Every
   * drawing entry point (`renderRectFromTree`, `renderEllipseFromTree`,
   * `renderPathFromTree`, `renderTextFromTree`, `renderImageFromTree`,
   * frame-background draws inside `renderFrameFromTree`) calls
   * `flushClipStencilIfDirty` before painting so the GPU stencil
   * matches what the renderer believes the clip stack to be.
   */
  const clipStencilDirty = { value: true };
  function markClipStencilDirty(): void {
    clipStencilDirty.value = true;
  }
  function flushClipStencilIfDirty(): void {
    if (!clipStencilDirty.value) {
      return;
    }
    rebuildStencilClipStack({ ops: { gl, glState }, clips: clipStack });
    clipActive.value = clipStack.length > 0;
    clipStencilValid.value = clipStack.length > 0;
    clipStencilDirty.value = false;
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

  async function walkForImages(node: RenderNode, parentTransform: AffineMatrix): Promise<void> {
    const worldTransform = multiplyMatrices(parentTransform, node.source.transform);
    const visible = isVisualNodeInViewport(node, worldTransform);

    // Image nodes carry source data for texture creation
    if (node.type === "image" && visible) {
      const colorManagement = colorManagementForImageNode(node);
      await textureCache.prepare(
        imageTextureResource(node.sourceImageHash, colorManagement),
        node.sourceData,
        node.sourceMimeType,
        { colorManagement },
      );
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
          await textureCache.prepare(
            imageTextureResource(fill.imageHash, colorManagement),
            fill.data,
            fill.mimeType,
            { colorManagement },
          );
        }
      }
    }

    // Recurse into children (group / frame are the only container variants).
    if (node.type === "group" || node.type === "frame") {
      for (const child of node.children) {
        await walkForImages(child, worldTransform);
      }
    }
  }

  // =========================================================================
  // Effect routines — use source effects for GPU-native rendering
  // =========================================================================

  /**
   * Extract effects from a RenderNode's source.
   * WebGL renders effects (drop shadow, inner shadow, layer blur) using
   * GPU-native FBO operations, not SVG filters. SceneNodeBase guarantees
   * an `effects` field on every SceneNode variant, so no cast is needed.
   */
  function getSourceEffects(node: RenderNodeBase): readonly Effect[] {
    return node.source.effects;
  }

  function drawFill(
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
        const entry = textureCache.getIfCached(imageTextureResource(fill.imageHash, colorManagementForImagePaint(fill)));
        if (entry) {
          drawImageFill({
            ctx, vertices, texture: entry.texture, transform,
            opacity: opacity * fill.opacity, elementSize,
            options: {
              imageWidth: entry.width,
              imageHeight: entry.height,
              scaleMode: fill.scaleMode,
              scalingFactor: fill.scalingFactor,
              imageTransform: fill.imageTransform,
              paintFilter: fill.paintFilter,
            },
          });
        }
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

  /**
   * Draw all fills for a shape node using source fill data.
   * Always draws ALL fills (multi-paint), not just the top fill.
   */
  function drawAllFills(
    { vertices, fills, transform, opacity, elementSize }: {
      vertices: Float32Array; fills: readonly Fill[]; transform: AffineMatrix;
      opacity: number; elementSize: { width: number; height: number };
    }
  ): void {
    for (const fill of fills) {
      drawFill({ vertices, fill, transform, opacity, elementSize });
    }
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
    const useClipAwareMode = clipActive.value && clipStencilValid.value;
    const white: Color = { r: 1, g: 1, b: 1, a: 1 };
    const resolvedFillRule = fillRule ?? "evenodd";

    glState.setEnabled(gl.STENCIL_TEST, true);
    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);

    if (!useClipAwareMode) {
      glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
    }

    if (resolvedFillRule === "nonzero") {
      glState.setStencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      glState.setStencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    } else {
      glState.setStencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    }

    drawSolidFill({ ctx: getGlContext(), vertices: fanVertices, color: white, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    if (useClipAwareMode) {
      glState.setStencilFunc(gl.LESS, CLIP_STENCIL_BIT, 0xff);
    } else {
      glState.setStencilFunc(gl.NOTEQUAL, 0, FILL_STENCIL_MASK);
    }

    for (const fill of fills) {
      drawFill({ vertices: coverQuad, fill, transform, opacity, elementSize });
    }

    glState.setColorMask(false, false, false, false);
    glState.setStencilMask(FILL_STENCIL_MASK);
    glState.setStencilFunc(gl.ALWAYS, 0, 0xff);
    glState.setStencilOp(gl.KEEP, gl.KEEP, gl.ZERO);

    drawSolidFill({ ctx: getGlContext(), vertices: coverQuad, color: white, transform, opacity: 1 });

    glState.setColorMask(true, true, true, true);
    glState.setStencilMask(0xff);

    if (useClipAwareMode) {
      glState.setStencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      glState.setStencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    } else {
      glState.setEnabled(gl.STENCIL_TEST, false);
    }
  }

  const effectRendering = createWebGLEffectRendering({
    getGlContext,
    effectsRenderer,
    pixelRatio: () => pixelRatioRef.value,
    canvasWidth: () => width.value * pixelRatioRef.value,
    canvasHeight: () => height.value * pixelRatioRef.value,
    isClipStencilRequired: () => clipActive.value && clipStencilValid.value,
    drawStencilFill,
  });

  // =========================================================================
  // Stroke rendering — uses StrokeRendering discriminated union from RenderTree
  // =========================================================================

  /**
   * Parse a hex color string (#RRGGBB or #RRGGBBAA) to a Color object.
   * Used to convert resolved stroke colors back to a GPU Color value.
   */
  function hexToColor(hex: string): Color {
    if (hex === "none") { return { r: 0, g: 0, b: 0, a: 0 }; }
    const h = hex.startsWith("#") ? hex.slice(1) : hex;
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }

  function parseStrokeDasharray(dasharray: string | undefined): readonly number[] | undefined {
    if (!dasharray) { return undefined; }
    const pattern = dasharray
      .split(/[\s,]+/)
      .map((part) => Number(part))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (pattern.length === 0) { return undefined; }
    return pattern;
  }

  function parseSvgCoordinate(value: string | undefined, defaultValue: number): number {
    if (!value) { return defaultValue; }
    if (value.endsWith("%")) {
      const parsed = Number(value.slice(0, -1));
      return Number.isFinite(parsed) ? parsed / 100 : defaultValue;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  function parseStopOffset(value: string): number {
    return parseSvgCoordinate(value, 0);
  }

  function resolvedGradientDefToFill(def: ResolvedFillDef | undefined): Fill | undefined {
    if (!def) { return undefined; }
    switch (def.type) {
      case "linear-gradient":
        return {
          type: "linear-gradient",
          start: { x: parseSvgCoordinate(def.x1, 0), y: parseSvgCoordinate(def.y1, 0.5) },
          end: { x: parseSvgCoordinate(def.x2, 1), y: parseSvgCoordinate(def.y2, 0.5) },
          stops: def.stops.map((stop) => ({
            position: parseStopOffset(stop.offset),
            color: { ...hexToColor(stop.stopColor), a: stop.stopOpacity ?? 1 },
          })),
          opacity: 1,
        };
      case "radial-gradient":
        return {
          type: "radial-gradient",
          center: { x: parseSvgCoordinate(def.cx, 0.5), y: parseSvgCoordinate(def.cy, 0.5) },
          radius: parseSvgCoordinate(def.r, 0.5),
          stops: def.stops.map((stop) => ({
            position: parseStopOffset(stop.offset),
            color: { ...hexToColor(stop.stopColor), a: stop.stopOpacity ?? 1 },
          })),
          opacity: 1,
        };
      case "angular-gradient":
        return {
          type: "angular-gradient",
          center: { x: parseSvgCoordinate(def.cx, 0.5), y: parseSvgCoordinate(def.cy, 0.5) },
          rotation: def.rotation,
          stops: def.stops.map((stop) => ({
            position: parseStopOffset(stop.offset),
            color: { ...hexToColor(stop.stopColor), a: stop.stopOpacity ?? 1 },
          })),
          opacity: 1,
        };
      case "diamond-gradient":
        return {
          type: "diamond-gradient",
          center: { x: parseSvgCoordinate(def.cx, 0.5), y: parseSvgCoordinate(def.cy, 0.5) },
          stops: def.stops.map((stop) => ({
            position: parseStopOffset(stop.offset),
            color: { ...hexToColor(stop.stopColor), a: stop.stopOpacity ?? 1 },
          })),
          opacity: 1,
        };
      case "image":
        return undefined;
    }
  }

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
    const gradientFill = resolvedGradientDefToFill(layer?.gradientDef);
    if (gradientFill) {
      drawFill({ vertices, fill: gradientFill, transform, opacity: opacity * strokeOpacity, elementSize });
      return;
    }
    drawSolidFill({
      ctx: getGlContext(),
      vertices,
      color: hexToColor(attrs.stroke),
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
          const alignedStrokeVerts = tessellateRectAlignedStroke({
            w: sr.shape.width,
            h: sr.shape.height,
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
          parseStrokeDasharray(sr.attrs.strokeDasharray),
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
            parseStrokeDasharray(layer.attrs.strokeDasharray),
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

      case "individual": {
        renderIndividualStroke(sr, transform, opacity);
        break;
      }
    }
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
    const color = hexToColor(sr.color);
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
    const vertices = generateRectVertices(bandWidth, bandHeight);
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
    switch (shape.kind) {
      case "rect": {
        return geometryCache.getRectVertices(shape.width, shape.height, shape.cornerRadius, shape.cornerSmoothing);
      }
      case "ellipse":
        return geometryCache.getEllipseVertices({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry });
      case "path": {
        const contours: PathContour[] = shape.paths.flatMap((p) => svgPathDToContours({
          d: p.d,
          windingRule: p.fillRule ?? "nonzero",
        }));
        return tessellateContours(contours, 0.25, true);
      }
    }
  }

  function tessellateStrokeShapeFromSR(
    shape: StrokeShape,
    strokeWidth: number,
    dashPattern?: readonly number[],
  ): Float32Array {
    switch (shape.kind) {
      case "rect": {
        return tessellateRectStroke({ w: shape.width, h: shape.height, cornerRadius: shape.cornerRadius, strokeWidth, dashPattern });
      }
      case "ellipse":
        return tessellateEllipseStroke({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry, strokeWidth, dashPattern });
      case "path":
        // Path strokes need the original contours for tessellation.
        // StrokeShape.path carries SVG d strings; we need PathContour objects.
        // Path strokes are handled by the node renderer using sourceContours directly.
        return new Float32Array(0);
    }
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
    const dashPattern = sourceStroke.dashPattern ?? parseStrokeDasharray(sr.attrs.strokeDasharray);
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

  function renderRenderNode(
    node: RenderNode,
    parentTransform: AffineMatrix,
    parentOpacity: number
  ): void {
    // RenderTree already excludes invisible nodes, so no visibility check needed

    const worldTransform = multiplyMatrices(parentTransform, node.source.transform);
    if (node.type !== "group" && node.type !== "frame" && !isVisualNodeInViewport(node, worldTransform)) {
      return;
    }
    // Use wrapper opacity (resolved by RenderTree) — falls back to 1 if undefined
    const nodeOpacity = node.wrapper.opacity ?? 1;
    const worldOpacity = parentOpacity * nodeOpacity;

    const effectStack = buildEffectStack(getSourceEffects(node));
    const layerBlur = effectStack.layerBlur;
    if (layerBlur) {
      renderWithLayerBlur({ node, worldTransform, worldOpacity, effect: layerBlur });
      return;
    }

    if ((node.type === "group" || node.type === "frame") && nodeOpacity < 1) {
      renderWithGroupOpacity({ node, worldTransform, parentOpacity, nodeOpacity });
      return;
    }

    renderRenderNodeDirect(node, worldTransform, worldOpacity);
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

  /**
   * Render a container node with isolated group opacity via FBO.
   */
  function renderWithGroupOpacity(
    { node, worldTransform, parentOpacity, nodeOpacity }: {
      node: RenderNode; worldTransform: AffineMatrix; parentOpacity: number; nodeOpacity: number;
    }
  ): void {
    const canvasW = width.value * pixelRatioRef.value;
    const canvasH = height.value * pixelRatioRef.value;

    // Effects rendering binds its own FBO programs and changes
    // stencil/blend state directly. Invalidate the state cache after
    // each call so subsequent setters know they can't trust the
    // previous cached values.
    effectsRenderer.beginLayerCapture(canvasW, canvasH);
    glState.invalidate();

    // Children render into the FBO with no outer clip applied.
    // `beginLayerCapture` already cleared the FBO stencil and
    // disabled STENCIL_TEST, so we swap `clipStack` for an empty
    // one and mark the deferred-rebuild dirty so the first draw
    // inside the FBO re-derives state for an empty clip stack.
    const savedClipStack = clipStack.splice(0);
    // `clipActive.value` only updates on flush; if previous siblings
    // pushed and popped without an intervening draw, it lags reality.
    // Derive the outer-clip-active state from the real stack length.
    const hadOuterClip = savedClipStack.length > 0;
    clipActive.value = false;
    markClipStencilDirty();

    // Render children at full parent opacity (no node opacity yet)
    renderRenderNodeDirect(node, worldTransform, parentOpacity);

    clipStack.push(...savedClipStack);
    clipActive.value = hadOuterClip;
    markClipStencilDirty();

    glState.setEnabled(gl.BLEND, true);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE, gl.ONE_MINUS_SRC_ALPHA
    );

    restoreOuterClipStencil(hadOuterClip);

    effectsRenderer.blitLayerWithOpacity({
      canvasWidth: canvasW, canvasHeight: canvasH,
      opacity: nodeOpacity,
    });
    glState.invalidate();
    markClipStencilDirty();
  }

  function renderRenderNodeDirect(
    node: RenderNode,
    worldTransform: AffineMatrix,
    worldOpacity: number
  ): void {
    switch (node.type) {
      case "group":
        renderGroupFromTree(node, worldTransform, worldOpacity);
        break;
      case "frame":
        renderFrameFromTree(node, worldTransform, worldOpacity);
        break;
      case "rect":
        renderRectFromTree(node, worldTransform, worldOpacity);
        break;
      case "ellipse":
        renderEllipseFromTree(node, worldTransform, worldOpacity);
        break;
      case "path":
        renderPathFromTree(node, worldTransform, worldOpacity);
        break;
      case "text":
        renderTextFromTree(node, worldTransform, worldOpacity);
        break;
      case "image":
        renderImageFromTree(node, worldTransform, worldOpacity);
        break;
    }
  }

  function renderWithLayerBlur(
    { node, worldTransform, worldOpacity, effect }: {
      node: RenderNode; worldTransform: AffineMatrix; worldOpacity: number; effect: LayerBlurEffect;
    }
  ): void {
    const canvasW = width.value * pixelRatioRef.value;
    const canvasH = height.value * pixelRatioRef.value;

    effectsRenderer.beginLayerCapture(canvasW, canvasH);
    glState.invalidate();

    const savedClipStack = clipStack.splice(0);
    const hadOuterClip = savedClipStack.length > 0;
    clipActive.value = false;
    markClipStencilDirty();

    renderRenderNodeDirect(node, worldTransform, worldOpacity);

    clipStack.push(...savedClipStack);
    clipActive.value = hadOuterClip;
    markClipStencilDirty();

    glState.setEnabled(gl.BLEND, true);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE, gl.ONE_MINUS_SRC_ALPHA
    );

    restoreOuterClipStencil(hadOuterClip);

    effectsRenderer.endLayerCaptureAndBlur({
      canvasWidth: canvasW,
      canvasHeight: canvasH,
      effect,
      worldToBacking: resolveEffectBackingScale(worldTransform, pixelRatioRef.value),
    });
    glState.invalidate();
    markClipStencilDirty();
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
      markClipStencilDirty();
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
    if (clipDef.shape.kind === "path") {
      // `clipDef.shape` belongs to the cached `node.defs` entry, so its
      // identity stays stable across viewport-only renders. Caching the
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
    const entry: StencilClipEntry = {
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
    markClipStencilDirty();
  }

  function resolveFrameUniformStrokeVertices(
    surfaceShape: ClipShape,
    strokeWidth: number,
    dashPattern: readonly number[] | undefined,
  ): Float32Array {
    switch (surfaceShape.type) {
      case "rect":
        return tessellateRectStroke({
          w: surfaceShape.width,
          h: surfaceShape.height,
          cornerRadius: surfaceShape.cornerRadius,
          strokeWidth,
          dashPattern,
        });
      case "path":
        return tessellatePathStroke(surfaceShape.contours, strokeWidth, { dashPattern });
    }
  }

  function renderFrameFromTree(node: RenderFrameNode, transform: AffineMatrix, opacity: number): void {
    // Frame backgrounds paint with the *outer* clip state — the frame's
    // own `childClipId` is pushed only after this draw and applies to
    // descendants. Flushing here covers the pending dirty flag from
    // the previous sibling's pop / the very first traversal step.
    flushClipStencilIfDirty();

    // Use RenderTree fields for dimensions and corner radius
    const elementSize = { width: node.width, height: node.height };
    const vertices = resolveClipVertices(node.sourceSurfaceShape);
    const effects = getSourceEffects(node);

    // Check if node has visible content — SVG filters operate on rendered content,
    // so fill=none + no stroke produces an empty shadow silhouette
    const hasFills = node.background !== null;
    const hasStroke = !!node.background?.strokeRendering;
    const hasVisibleContent = hasFills || hasStroke;

    if (isVisualNodeInViewport(node, transform)) {
      effectRendering.renderVertexShapeEffectStack({
        effects,
        hasVisibleContent,
        vertices,
        transform,
        opacity,
        renderContent: () => {
          if (node.background) {
            drawAllFills({ vertices, fills: node.sourceFills, transform, opacity, elementSize });
          }
        },
        renderStroke: () => {
          if (!node.background?.strokeRendering) { return; }
          const sr = node.background.strokeRendering;
          if (sr.mode !== "uniform") {
            renderStrokeRendering(sr, transform, opacity);
            return;
          }
          const sourceStroke = node.sourceStroke;
          if (!sourceStroke || sourceStroke.width <= 0) { return; }
          renderUniformStroke({
            sr,
            sourceStroke,
            shapeVerticesFactory: (sw, dashPattern) => resolveFrameUniformStrokeVertices(node.sourceSurfaceShape, sw, dashPattern),
            transform,
            opacity,
          });
        },
      });
    }

    // Children with clip — use RenderTree's clip-path def (which may be expanded
    // by child stroke overhang to prevent stroke clipping at frame edges)
    const childClipId = node.omitChildClip ? undefined : node.childClipId;
    if (childClipId) {
      pushRenderTreeClip({ defs: node.defs, clipId: childClipId, nodeId: node.id, transform });
    }

    for (const child of node.children) {
      renderRenderNode(child, transform, opacity);
    }

    if (childClipId) {
      clipStack.pop();
      markClipStencilDirty();
    }
  }

  function renderRectFromTree(node: RenderRectNode, transform: AffineMatrix, opacity: number): void {
    flushClipStencilIfDirty();
    // Use RenderTree fields for dimensions
    const elementSize = { width: node.width, height: node.height };
    const vertices = geometryCache.getRectVertices(node.width, node.height, node.cornerRadius, node.cornerSmoothing);
    const effects = getSourceEffects(node);

    // Skip effects when node has no visible content (fill=none + no stroke → empty silhouette)
    const hasVisibleContent = node.sourceFills.length > 0 || !!node.strokeRendering;

    effectRendering.renderVertexShapeEffectStack({
      effects,
      hasVisibleContent,
      vertices,
      transform,
      opacity,
      renderContent: () => {
        if (node.sourceFills.length > 0) {
          drawAllFills({ vertices, fills: node.sourceFills, transform, opacity, elementSize });
        }
      },
      renderStroke: () => {
        if (!node.strokeRendering) { return; }
        const sr = node.strokeRendering;
        if (sr.mode === "uniform") {
          renderUniformStroke({
            sr,
            sourceStroke: node.sourceStroke,
            shapeVerticesFactory: (sw, dashPattern) => tessellateRectStroke({
              w: node.width,
              h: node.height,
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
      },
    });
  }

  function renderEllipseFromTree(node: RenderEllipseNode, transform: AffineMatrix, opacity: number): void {
    flushClipStencilIfDirty();
    const elementSize = { width: node.rx * 2, height: node.ry * 2 };
    const vertices = geometryCache.getEllipseVertices({ cx: node.cx, cy: node.cy, rx: node.rx, ry: node.ry });
    const effects = getSourceEffects(node);

    const hasVisibleContent = node.sourceFills.length > 0 || !!node.strokeRendering;

    effectRendering.renderVertexShapeEffectStack({
      effects,
      hasVisibleContent,
      vertices,
      transform,
      opacity,
      renderContent: () => {
        if (node.sourceFills.length > 0) {
          drawAllFills({ vertices, fills: node.sourceFills, transform, opacity, elementSize });
        }
      },
      renderStroke: () => {
        if (!node.strokeRendering) { return; }
        const sr = node.strokeRendering;
        if (sr.mode === "uniform") {
          renderUniformStroke({
            sr,
            sourceStroke: node.sourceStroke,
            shapeVerticesFactory: (sw, dashPattern) => tessellateEllipseStroke({
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
      },
    });
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
        dashPattern: parseStrokeDasharray(layer.attrs.strokeDasharray),
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
      dashPattern: parseStrokeDasharray(sr.attrs.strokeDasharray),
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
    }
  }

  function renderPathFromTree(node: RenderPathNode, transform: AffineMatrix, opacity: number): void {
    // Use RenderTree's paths[].d (SVG path strings) as the single source of truth.
    // This ensures WebGL renders the exact same geometry as SVG — including
    // shapes generated by the resolver (ellipse arcs, donut rings, etc.)
    // that have no sourceContours.
    if (node.paths.length === 0) { return; }
    flushClipStencilIfDirty();
    const effects = getSourceEffects(node);
    const effectStack = buildEffectStack(effects);

    const hasVisibleContent = node.sourceFills.length > 0 || !!node.strokeRendering;
    const pathGeometry = geometryCache.getPathGeometry(node);
    const { parsedContours, prepared, coverQuad, pathVertices, backgroundMaskVertices, dropShadowSilhouetteVertices } = pathGeometry;

    renderShapeEffectStack({
      stack: effectStack,
      hasVisibleContent,
      renderBackgroundBlur: (effect) => {
        if (backgroundMaskVertices.length > 0) {
          effectRendering.renderBackgroundBlurMask({ effect, vertices: backgroundMaskVertices, transform });
        }
      },
      renderDropShadows: (sourceEffects) => {
        if (prepared && coverQuad) {
          effectRendering.renderDropShadowsStencil({
            effects: sourceEffects,
            fanVertices: prepared.fanVertices,
            coverQuad,
            bounds: prepared.bounds,
            silhouetteVertices: dropShadowSilhouetteVertices,
            transform,
            opacity,
          });
          return;
        }
        if (pathVertices.length > 0) {
          effectRendering.renderDropShadows({ effects: sourceEffects, vertices: pathVertices, transform, opacity });
        }
      },
      renderContent: () => {
        if (node.sourceFills.length === 0) { return; }
        // The per-instruction fan triangles, cover quad, and element
        // size are stable across viewport-only renders, so we cache
        // them on the node and reuse them every pan/zoom frame instead
        // of re-flattening every contour Bézier here.
        const fillPlan = geometryCache.getPathFillPlanGeometry(node);
        for (const instruction of fillPlan.instructions) {
          drawStencilFill({
            prepared: instruction.prepared,
            coverQuad: instruction.coverQuad,
            transform,
            opacity,
            elementSize: instruction.elementSize,
            fills: instruction.fills,
            fillRule: instruction.fillRule,
          });
        }
      },
      renderInnerShadows: (sourceEffects) => {
        if (backgroundMaskVertices.length > 0) {
          effectRendering.renderInnerShadows({ effects: sourceEffects, vertices: backgroundMaskVertices, transform });
        }
      },
      renderStroke: () => {
        renderPathStrokeFromTree({ node, contours: parsedContours, transform, opacity });
      },
    });
  }

  function renderGlyphTextFromTree(node: RenderTextNode, transform: AffineMatrix, opacity: number): void {
    if (node.content.mode !== "glyphs") { return; }
    if (node.content.runs.length === 0) { return; }

    const { runs } = geometryCache.getTextGlyphGeometry(node);
    for (const runGeo of runs) {
      if (runGeo.vertices.length === 0) { continue; }
      const runColor = hexToColor(runGeo.fillColor);
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
      drawSolidFill({
        ctx: getGlContext(),
        vertices: runGeo.vertices,
        color: runColor,
        transform,
        opacity: opacity * runGeo.fillOpacity,
      });
    }
  }

  function renderTextFromTree(node: RenderTextNode, transform: AffineMatrix, opacity: number): void {
    flushClipStencilIfDirty();

    // Use RenderTree content as the single source of truth.
    // Both SVG and WebGL consume the same content representation.
    if (node.content.mode === "glyphs") {
      // One stencil-fill draw per fill-run, mirroring the SVG emitter
      // which writes one <path> per run. The geometry cache returns
      // pre-tessellated triangles per run keyed off the same node, so
      // re-rendering the same TEXT node only re-issues draws — it does
      // not re-tessellate.
      renderGlyphTextFromTree(node, transform, opacity);
      return;
    }

    if (!hasVisibleLineText(node.content)) { return; }
    throw new Error(`WebGL text renderer requires glyph contours for text node ${node.id}`);
  }

  function renderImageFromTree(node: RenderImageNode, transform: AffineMatrix, opacity: number): void {
    const entry = textureCache.getIfCached(imageTextureResource(node.sourceImageHash, colorManagementForImageNode(node)));
    if (!entry) { return; }
    flushClipStencilIfDirty();

    const vertices = geometryCache.getRectVertices(node.width, node.height);
    const elementSize = { width: node.width, height: node.height };
    drawImageFill({
      ctx: getGlContext(), vertices, texture: entry.texture, transform, opacity, elementSize,
      options: { imageWidth: entry.width, imageHeight: entry.height, scaleMode: node.sourceScaleMode },
    });
  }

  return {
    isScenePrepared(scene: SceneGraph): boolean {
      return sceneResources.isEqual(preparedSceneResourceKey.value, sceneResources.get(scene));
    },

    async prepareScene(scene: SceneGraph): Promise<void> {
      const resourceKey = sceneResources.get(scene);
      if (sceneResources.isEqual(preparedSceneResourceKey.value, resourceKey)) {
        return;
      }
      const start = performance.now();
      width.value = scene.width;
      height.value = scene.height;
      const renderTree = renderTreeCache.get(scene, { exportSettings: options.exportSettings });
      const viewportTransform = viewportToSurfaceTransform(renderTree);
      await Promise.all(renderTree.children.map((child) => walkForImages(child, viewportTransform)));
      metrics.prepareCount += 1;
      metrics.lastPrepareMs = performance.now() - start;
      preparedSceneResourceKey.value = resourceKey;
    },

    precompileResources(): void {
      resourceContext.precompile();
    },

    render(scene: SceneGraph): void {
      const start = performance.now();
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

      const bg = backgroundColor;
      gl.clearColor(bg.r, bg.g, bg.b, bg.a);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      clipActive.value = false;
      clipStencilValid.value = false;
      clipStack.length = 0;
      // Frame-start `gl.clear` wiped the stencil — but we also drop
      // the GL state cache because external subsystems may have run
      // between frames (text editing, debug overlays). Subsequent
      // setters in this frame will write fresh values.
      glState.invalidate();
      clipStencilDirty.value = true;

      const renderTree = renderTreeCache.get(scene, { exportSettings: options.exportSettings });
      const viewportTransform = viewportToSurfaceTransform(renderTree);
      for (const child of renderTree.children) {
        renderRenderNode(child, viewportTransform, 1);
      }
      metrics.renderCount += 1;
      metrics.lastRenderMs = performance.now() - start;
    },

    setPixelRatio(pixelRatio: number): void {
      if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
        throw new Error("WebGL renderer requires positive pixelRatio");
      }
      pixelRatioRef.value = pixelRatio;
    },

    getMetrics(): WebGLFigmaRendererMetrics {
      return { ...metrics };
    },

    dispose(): void {
      resourceContext.dispose();
      preparedSceneResourceKey.value = null;
      effectsRenderer.dispose();
      geometryCache.dispose();
      gl.deleteBuffer(positionBuffer);
      positionBufferUpload.value = null;
    },
  };
}
