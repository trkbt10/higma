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

import type { SceneGraph, Fill, Color, LayerBlurEffect, Effect, PathContour, ClipShape } from "@higma-document-models/fig/scene-graph";
import { normalizeFigmaRenderExportSettings, requireManagedImageColorProfile, type FigmaRenderExportSettings, type NormalizedFigmaRenderExportSettings, } from "../../scene-graph/render";

import {
  type RenderNode, type RenderGroupNode, type RenderFrameNode, type RenderRectNode, type RenderEllipseNode, type RenderPathNode, type RenderTextNode, type RenderImageNode, type RenderNodeBase, type StrokeRendering, type StrokeShape, type RenderClipPathDef, } from "../../scene-graph/render-tree";
import type { ResolvedFillDef } from "../../scene-graph/render/fill";

import {
  generateRectVertices, tessellateContours, } from "../tessellation/tessellation";
import {
  drawSolidFill, drawLinearGradientFill, drawRadialGradientFill, drawAngularGradientFill, drawDiamondGradientFill, drawImageFill, type GLContext, } from "../fill/fill-renderer";
import { imageTextureResource, type TextureColorManagement } from "../resources/texture-resource";
import { IDENTITY_MATRIX, multiplyMatrices } from "@higma-document-models/fig/matrix";
import { rebuildStencilClipStack, type StencilClipEntry } from "../effects/clip-mask";
import {
  tessellateRectStroke, tessellateRectAlignedStroke, tessellateEllipseStroke, } from "../tessellation/stroke-tessellation";
import { createEffectsRenderer } from "../effects/effects-renderer";
import { buildEffectStack, renderShapeEffectStack } from "../../scene-graph/render/effect-stack";
import { createWebGLEffectRendering } from "../effects/effect-rendering";
import { shouldRenderVisualNode, type ViewportRect } from "../scene/render-culling";
import { createWebGLFigmaResourceContext, type WebGLFigmaResourceContext } from "../resources/resource-context";
import {
  prepareFanTriangles, generateCoverQuad, CLIP_STENCIL_BIT, FILL_STENCIL_MASK, } from "../tessellation/stencil-fill";
import { flattenPathCommands } from "@higma-primitives/path";
import { svgPathDToContours } from "../tessellation/path-contours";
import { syncWebGLCanvasRenderSurface } from "../scene/render-surface";
import { createWebGLPathFillPlan, type WebGLPathFillRule } from "../fill/render-path-fill-plan";
import { hasVisibleLineText } from "../text/text-visibility";
import { createWebGLGeometryCache } from "../resources/geometry-cache";

/** Extract uniform radius from CornerRadius (per-corner → average for WebGL) */
function uniformRadiusForGL(cr: CornerRadius | undefined): number | undefined {
  if (cr === undefined) { return undefined; }
  if (typeof cr === "number") { return cr; }
  const avg = (cr[0] + cr[1] + cr[2] + cr[3]) / 4;
  return avg || undefined;
}
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
  exportSettings: NormalizedFigmaRenderExportSettings,
): void {
  if (exportSettings.imageColorManagement.kind === "unmanaged") {
    return;
  }
  const profile = requireManagedImageColorProfile(exportSettings.imageColorManagement);
  const colorManagedGl = gl as WebGLRenderingContext & {
    drawingBufferColorSpace?: "srgb" | "display-p3";
    unpackColorSpace?: "srgb" | "display-p3";
  };
  if (profile === "DISPLAY_P3_V4") {
    if (colorManagedGl.drawingBufferColorSpace === undefined || colorManagedGl.unpackColorSpace === undefined) {
      throw new Error("Display P3 WebGL rendering requires drawingBufferColorSpace and unpackColorSpace support");
    }
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
  const exportSettings = normalizeFigmaRenderExportSettings(options.exportSettings);
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
  const geometryCache = createWebGLGeometryCache();

  // Enable blending for transparency
  gl.enable(gl.BLEND);
  gl.blendFuncSeparate(
    gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
    gl.ONE, gl.ONE_MINUS_SRC_ALPHA
  );

  function getGlContext(): GLContext {
    return {
      gl,
      shaders,
      positionBuffer,
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

  function rebuildClipStencil(): void {
    rebuildStencilClipStack({ gl, clips: clipStack });
    clipActive.value = clipStack.length > 0;
    clipStencilValid.value = clipStack.length > 0;
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
        imageTextureResource(node.sourceImageRef, colorManagement),
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
            imageTextureResource(fill.imageRef, colorManagement),
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
  // Effect helpers — use source effects for GPU-native rendering
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
        const entry = textureCache.getIfCached(imageTextureResource(fill.imageRef, colorManagementForImagePaint(fill)));
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

    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.stencilMask(FILL_STENCIL_MASK);

    if (!useClipAwareMode) {
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    }

    if (resolvedFillRule === "nonzero") {
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    } else {
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    }

    drawSolidFill({ ctx: getGlContext(), vertices: fanVertices, color: white, transform, opacity: 1 });

    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    if (useClipAwareMode) {
      gl.stencilFunc(gl.LESS, CLIP_STENCIL_BIT, 0xff);
    } else {
      gl.stencilFunc(gl.NOTEQUAL, 0, FILL_STENCIL_MASK);
    }

    for (const fill of fills) {
      drawFill({ vertices: coverQuad, fill, transform, opacity, elementSize });
    }

    gl.colorMask(false, false, false, false);
    gl.stencilMask(FILL_STENCIL_MASK);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);

    drawSolidFill({ ctx: getGlContext(), vertices: coverQuad, color: white, transform, opacity: 1 });

    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);

    if (useClipAwareMode) {
      gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    } else {
      gl.disable(gl.STENCIL_TEST);
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
   * Used to convert resolved stroke colors back to GPU-compatible Color.
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
    const coordinates = contours.flatMap((contour) => flattenPathCommands(contour.commands));
    if (coordinates.length < 2) {
      return { width: 1, height: 1 };
    }
    const bounds = computeCoordinateBounds(coordinates);
    return { width: Math.max(1, bounds.maxX - bounds.minX), height: Math.max(1, bounds.maxY - bounds.minY) };
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
            cornerRadius: uniformRadiusForGL(sr.shape.cornerRadius) ?? 0,
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

        // Save current stencil state
        const wasStencilEnabled = gl.isEnabled(gl.STENCIL_TEST);

        // Step 1: Write fill shape to stencil (use FILL_STENCIL_MASK bits)
        gl.enable(gl.STENCIL_TEST);
        gl.colorMask(false, false, false, false);
        gl.stencilMask(FILL_STENCIL_MASK);
        gl.stencilFunc(gl.ALWAYS, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        drawSolidFill({ ctx: getGlContext(), vertices: fillVerts, color: white, transform, opacity: 1 });

        // Step 2: Draw doubled stroke, stencil-tested
        // Must respect both fill mask (FILL_STENCIL_MASK) and clip stencil (CLIP_STENCIL_BIT)
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0x00);
        if (isInside) {
          // INSIDE: draw where fill stencil is set (inside shape)
          // If clip is active, also require CLIP_STENCIL_BIT
          const ref = clipActive.value ? (CLIP_STENCIL_BIT | FILL_STENCIL_MASK) : FILL_STENCIL_MASK;
          const mask = clipActive.value ? 0xff : FILL_STENCIL_MASK;
          gl.stencilFunc(gl.EQUAL, ref, mask);
        } else {
          // OUTSIDE: draw where fill stencil is NOT set (outside shape)
          // If clip is active, require CLIP_STENCIL_BIT but NOT FILL_STENCIL_MASK
          const ref = clipActive.value ? CLIP_STENCIL_BIT : 0;
          const mask = clipActive.value ? 0xff : FILL_STENCIL_MASK;
          gl.stencilFunc(gl.EQUAL, ref, mask);
        }
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        drawStrokePaintLayer({
          vertices: strokeVerts,
          layer: sr.layer,
          attrs: sr.attrs,
          transform,
          opacity,
          elementSize: strokeShapeElementSize(sr.shape),
        });

        // Step 3: Clear stencil bits
        gl.colorMask(false, false, false, false);
        gl.stencilMask(FILL_STENCIL_MASK);
        gl.stencilFunc(gl.ALWAYS, 0, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
        drawSolidFill({ ctx: getGlContext(), vertices: fillVerts, color: white, transform, opacity: 1 });

        // Restore stencil state
        gl.colorMask(true, true, true, true);
        gl.stencilMask(0xff);
        if (!wasStencilEnabled) {
          gl.disable(gl.STENCIL_TEST);
        } else {
          // Restore clip stencil if active
          gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
          gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
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
        // Per-side stroke weights with strokeAlign-aware band placement.
        //
        // INSIDE  (sign=+1): bands stack inside the rect (top   y=0..top,
        //                                                 bottom y=h-bottom..h, ...)
        // OUTSIDE (sign=-1): bands stack outside     (top y=-top..0, bottom y=h..h+bottom, ...)
        // CENTER  (sign= 0): bands straddle the edge (top y=-top/2..+top/2, ...)
        //
        // Mirrors svg/scene-renderer.ts and react/primitives/stroke-rendering.tsx.
        const color = hexToColor(sr.color);
        const strokeOpacity = sr.opacity ?? 1;
        const { top, right, bottom, left } = sr.sides;
        const w = sr.width;
        const h = sr.height;
        const sign = sr.strokeAlign === "OUTSIDE" ? -1 : sr.strokeAlign === "INSIDE" ? 1 : 0;
        // Top-left of each side's band, in local node coords.
        const topY = sign === 1 ? 0 : sign === -1 ? -top : -top / 2;
        const bottomY = sign === 1 ? h - bottom : sign === -1 ? h : h - bottom / 2;
        const leftX = sign === 1 ? 0 : sign === -1 ? -left : -left / 2;
        const rightX = sign === 1 ? w - right : sign === -1 ? w : w - right / 2;

        // Top border
        if (top > 0) {
          const offsetTransform: AffineMatrix = {
            m00: transform.m00, m01: transform.m01, m02: transform.m02,
            m10: transform.m10, m11: transform.m11, m12: transform.m12 + topY,
          };
          const verts = generateRectVertices(w, top);
          drawSolidFill({ ctx: getGlContext(), vertices: verts, color, transform: offsetTransform, opacity: opacity * strokeOpacity });
        }
        // Bottom border
        if (bottom > 0) {
          const offsetTransform: AffineMatrix = {
            m00: transform.m00, m01: transform.m01, m02: transform.m02,
            m10: transform.m10, m11: transform.m11, m12: transform.m12 + bottomY,
          };
          const verts = generateRectVertices(w, bottom);
          drawSolidFill({ ctx: getGlContext(), vertices: verts, color, transform: offsetTransform, opacity: opacity * strokeOpacity });
        }
        // Left border
        if (left > 0) {
          const offsetTransform: AffineMatrix = {
            m00: transform.m00, m01: transform.m01, m02: transform.m02 + leftX,
            m10: transform.m10, m11: transform.m11, m12: transform.m12,
          };
          const verts = generateRectVertices(left, h);
          drawSolidFill({ ctx: getGlContext(), vertices: verts, color, transform: offsetTransform, opacity: opacity * strokeOpacity });
        }
        // Right border
        if (right > 0) {
          const offsetTransform: AffineMatrix = {
            m00: transform.m00, m01: transform.m01, m02: transform.m02 + rightX,
            m10: transform.m10, m11: transform.m11, m12: transform.m12,
          };
          const verts = generateRectVertices(right, h);
          drawSolidFill({ ctx: getGlContext(), vertices: verts, color, transform: offsetTransform, opacity: opacity * strokeOpacity });
        }
        break;
      }
    }
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
        return geometryCache.getRectVertices(shape.width, shape.height, shape.cornerRadius);
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
        const cr = uniformRadiusForGL(shape.cornerRadius);
        return tessellateRectStroke({ w: shape.width, h: shape.height, cornerRadius: cr ?? 0, strokeWidth, dashPattern });
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
    gl.colorMask(true, true, true, true);
    gl.stencilMask(0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

    if (wasClipActive) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
      return;
    }

    gl.disable(gl.STENCIL_TEST);
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

    effectsRenderer.beginLayerCapture(canvasW, canvasH);

    const wasClipActive = clipActive.value;
    clipActive.value = false;

    // Render children at full parent opacity (no node opacity yet)
    renderRenderNodeDirect(node, worldTransform, parentOpacity);

    clipActive.value = wasClipActive;

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE, gl.ONE_MINUS_SRC_ALPHA
    );

    restoreOuterClipStencil(wasClipActive);

    effectsRenderer.blitLayerWithOpacity({
      canvasWidth: canvasW, canvasHeight: canvasH,
      opacity: nodeOpacity,
    });
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

    const wasClipActive = clipActive.value;
    clipActive.value = false;

    renderRenderNodeDirect(node, worldTransform, worldOpacity);

    clipActive.value = wasClipActive;

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(
      gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE, gl.ONE_MINUS_SRC_ALPHA
    );

    restoreOuterClipStencil(wasClipActive);

    effectsRenderer.endLayerCaptureAndBlur({ canvasWidth: canvasW, canvasHeight: canvasH, effect, pixelRatio: pixelRatioRef.value });
  }

  // =========================================================================
  // Node-type renderers — use RenderTree fields for dimensions/geometry,
  // source* fields for GPU data, StrokeRendering for stroke dispatch
  // =========================================================================

  function renderGroupFromTree(node: RenderGroupNode, transform: AffineMatrix, opacity: number): void {
    for (const child of node.children) {
      renderRenderNode(child, transform, opacity);
    }
  }

  function getFrameClipData(
    { clipDef, node, transform }: {
      clipDef: RenderClipPathDef | undefined;
      node: RenderFrameNode;
      transform: AffineMatrix;
    },
  ): { clip: ClipShape; transform: AffineMatrix } {
    if (clipDef?.shape.kind === "path") {
      return {
        clip: { type: "path", contours: svgPathDToContours({ d: clipDef.shape.d }) },
        transform,
      };
    }

    if (clipDef?.shape.kind === "rect") {
      const clipTransform: AffineMatrix = {
        m00: transform.m00,
        m01: transform.m01,
        m02: transform.m02 + clipDef.shape.x,
        m10: transform.m10,
        m11: transform.m11,
        m12: transform.m12 + clipDef.shape.y,
      };
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

    return {
      clip: {
        type: "rect",
        width: node.width,
        height: node.height,
        cornerRadius: node.cornerRadius,
      },
      transform,
    };
  }

  function renderFrameFromTree(node: RenderFrameNode, transform: AffineMatrix, opacity: number): void {
    // Use RenderTree fields for dimensions and corner radius
    const elementSize = { width: node.width, height: node.height };
    const uniformCR = uniformRadiusForGL(node.cornerRadius);
    const vertices = geometryCache.getRectVertices(node.width, node.height, node.cornerRadius);
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
          if (sr.mode === "uniform") {
            const sourceStroke = node.sourceStroke;
            if (sourceStroke && sourceStroke.width > 0) {
              renderUniformStroke({
                sr,
                sourceStroke,
                shapeVerticesFactory: (sw, dashPattern) => tessellateRectStroke({
                  w: node.width,
                  h: node.height,
                  cornerRadius: uniformCR ?? 0,
                  strokeWidth: sw,
                  dashPattern,
                }),
                transform,
                opacity,
              });
            }
            return;
          }
          renderStrokeRendering(sr, transform, opacity);
        },
      });
    }

    // Children with clip — use RenderTree's clip-path def (which may be expanded
    // by child stroke overhang to prevent stroke clipping at frame edges)
    if (node.childClipId) {
      // Find the clip-path def for this child clip
      const clipDef = node.defs.find(
        (d): d is RenderClipPathDef =>
          d.type === "clip-path" && d.id === node.childClipId
      );
      const clipData = getFrameClipData({ clipDef, node, transform });
      const entry: StencilClipEntry = {
        clip: clipData.clip,
        drawVertices: (verts) => {
          drawSolidFill({ ctx: getGlContext(), vertices: verts, color: { r: 0, g: 0, b: 0, a: 1 }, transform: clipData.transform, opacity: 1 });
        },
      };
      clipStack.push(entry);
      rebuildClipStencil();
    }

    for (const child of node.children) {
      renderRenderNode(child, transform, opacity);
    }

    if (node.childClipId) {
      clipStack.pop();
      rebuildClipStencil();
    }
  }

  function renderRectFromTree(node: RenderRectNode, transform: AffineMatrix, opacity: number): void {
    // Use RenderTree fields for dimensions
    const elementSize = { width: node.width, height: node.height };
    const uniformCR = uniformRadiusForGL(node.cornerRadius);
    const vertices = geometryCache.getRectVertices(node.width, node.height, node.cornerRadius);
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
              cornerRadius: uniformCR ?? 0,
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

  function renderPathStrokeFromTree(
    { node, contours, transform, opacity }: {
      node: RenderPathNode; contours: readonly PathContour[]; transform: AffineMatrix; opacity: number;
    },
  ): void {
    if (!node.strokeRendering) { return; }
    const sr = node.strokeRendering;
    if (sr.mode === "uniform" && node.sourceStroke && node.sourceStroke.width > 0) {
      const strokeVerts = geometryCache.getPathStrokeVertices({
        node,
        contours,
        strokeWidth: node.sourceStroke.width,
        dashPattern: node.sourceStroke.dashPattern,
      });
      if (strokeVerts.length > 0) {
        drawSolidFill({
          ctx: getGlContext(), vertices: strokeVerts,
          color: node.sourceStroke.color, transform,
          opacity: opacity * node.sourceStroke.opacity,
        });
      }
      return;
    }
    if (sr.mode === "layers") {
      for (const layer of sr.layers) {
        const strokeWidth = layer.attrs.strokeWidth ?? 1;
        if (strokeWidth <= 0) { continue; }
        const strokeVerts = geometryCache.getPathStrokeVertices({
          node,
          contours,
          strokeWidth,
          dashPattern: parseStrokeDasharray(layer.attrs.strokeDasharray),
        });
        if (strokeVerts.length > 0) {
          drawStrokePaintLayer({
            vertices: strokeVerts,
            layer,
            attrs: layer.attrs,
            transform,
            opacity,
            elementSize: pathContoursElementSize(contours),
          });
        }
      }
      return;
    }
    if (sr.mode === "masked") {
      const strokeWidth = sr.attrs.strokeWidth ?? 1;
      if (strokeWidth <= 0) { return; }
      const strokeVerts = geometryCache.getPathStrokeVertices({
        node,
        contours,
        strokeWidth,
        dashPattern: parseStrokeDasharray(sr.attrs.strokeDasharray),
      });
      const fillVerts = tessellateContours(contours, 0.25, true);
      if (strokeVerts.length > 0 && fillVerts.length > 0) {
        const white: Color = { r: 1, g: 1, b: 1, a: 1 };
        const wasStencilEnabled = gl.isEnabled(gl.STENCIL_TEST);
        const isInside = sr.attrs.strokeAlign === "INSIDE";

        gl.enable(gl.STENCIL_TEST);
        gl.colorMask(false, false, false, false);
        gl.stencilMask(FILL_STENCIL_MASK);
        gl.stencilFunc(gl.ALWAYS, FILL_STENCIL_MASK, FILL_STENCIL_MASK);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
        drawSolidFill({ ctx: getGlContext(), vertices: fillVerts, color: white, transform, opacity: 1 });

        gl.colorMask(true, true, true, true);
        gl.stencilMask(0x00);
        if (isInside) {
          const ref = clipActive.value ? (CLIP_STENCIL_BIT | FILL_STENCIL_MASK) : FILL_STENCIL_MASK;
          const mask = clipActive.value ? 0xff : FILL_STENCIL_MASK;
          gl.stencilFunc(gl.EQUAL, ref, mask);
        } else {
          const ref = clipActive.value ? CLIP_STENCIL_BIT : 0;
          const mask = clipActive.value ? 0xff : FILL_STENCIL_MASK;
          gl.stencilFunc(gl.EQUAL, ref, mask);
        }
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        drawStrokePaintLayer({
          vertices: strokeVerts,
          layer: sr.layer,
          attrs: sr.attrs,
          transform,
          opacity,
          elementSize: pathContoursElementSize(contours),
        });

        gl.colorMask(false, false, false, false);
        gl.stencilMask(FILL_STENCIL_MASK);
        gl.stencilFunc(gl.ALWAYS, 0, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.ZERO);
        drawSolidFill({ ctx: getGlContext(), vertices: fillVerts, color: white, transform, opacity: 1 });

        gl.colorMask(true, true, true, true);
        gl.stencilMask(0xff);
        if (!wasStencilEnabled) {
          gl.disable(gl.STENCIL_TEST);
          return;
        }
        gl.stencilFunc(gl.EQUAL, CLIP_STENCIL_BIT, CLIP_STENCIL_BIT);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      }
    }
  }

  function renderPathFromTree(node: RenderPathNode, transform: AffineMatrix, opacity: number): void {
    // Use RenderTree's paths[].d (SVG path strings) as the single source of truth.
    // This ensures WebGL renders the exact same geometry as SVG — including
    // shapes generated by the resolver (ellipse arcs, donut rings, etc.)
    // that have no sourceContours.
    if (node.paths.length === 0) { return; }
    const effects = getSourceEffects(node);
    const effectStack = buildEffectStack(effects);

    const hasVisibleContent = node.sourceFills.length > 0 || !!node.strokeRendering;
    const { parsedContours, prepared, pathVertices, backgroundMaskVertices } = geometryCache.getPathGeometry(node);

    renderShapeEffectStack({
      stack: effectStack,
      hasVisibleContent,
      renderBackgroundBlur: (effect) => {
        if (backgroundMaskVertices.length > 0) {
          effectRendering.renderBackgroundBlurMask({ effect, vertices: backgroundMaskVertices, transform });
        }
      },
      renderDropShadows: (sourceEffects) => {
        if (prepared) {
          const { fanVertices, bounds } = prepared;
          const coverQuad = generateCoverQuad(bounds);
          effectRendering.renderDropShadowsStencil({ effects: sourceEffects, fanVertices, coverQuad, bounds, contours: parsedContours, transform, opacity });
          return;
        }
        if (pathVertices.length > 0) {
          effectRendering.renderDropShadows({ effects: sourceEffects, vertices: pathVertices, transform, opacity });
        }
      },
      renderContent: () => {
        if (node.sourceFills.length === 0) { return; }
        for (const instruction of createWebGLPathFillPlan(node)) {
          if (instruction.fills.length === 0) { continue; }
          const singlePathPrepared = prepareFanTriangles(instruction.contours, 0.25, instruction.fillRule === "nonzero");
          if (singlePathPrepared) {
            const { bounds } = singlePathPrepared;
            const coverQuad = generateCoverQuad(bounds);
            const elementSize = { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
            drawStencilFill({
              prepared: singlePathPrepared,
              coverQuad,
              transform,
              opacity,
              elementSize,
              fills: instruction.fills,
              fillRule: instruction.fillRule,
            });
          }
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

  function renderTextFromTree(node: RenderTextNode, transform: AffineMatrix, opacity: number): void {
    const fillOpacity = node.sourceFillOpacity;

    // Use RenderTree content as the single source of truth.
    // Both SVG and WebGL consume the same content representation.
    if (node.content.mode === "glyphs") {
      // One stencil-fill draw per fill-run, mirroring the SVG emitter
      // which writes one <path> per run. The geometry cache returns
      // pre-tessellated triangles per run keyed off the same node, so
      // re-rendering the same TEXT node only re-issues draws — it does
      // not re-tessellate.
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
          opacity: opacity * fillOpacity * runGeo.fillOpacity,
        });
      }
      return;
    }

    if (node.content.mode === "lines") {
      if (!hasVisibleLineText(node.content)) { return; }
      throw new Error(`WebGL text renderer requires glyph contours for text node ${node.id}`);
    }
  }

  function renderImageFromTree(node: RenderImageNode, transform: AffineMatrix, opacity: number): void {
    const entry = textureCache.getIfCached(imageTextureResource(node.sourceImageRef, colorManagementForImageNode(node)));
    if (!entry) { return; }

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
    },
  };
}

// =============================================================================
// Helpers
// =============================================================================

function computeCoordinateBounds(coordinates: ArrayLike<number>): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} {
  return Array.from(coordinates).reduce(
    (acc, value, index) => {
      if (index % 2 === 0) {
        return {
          ...acc,
          minX: Math.min(acc.minX, value),
          maxX: Math.max(acc.maxX, value),
        };
      }
      return {
        ...acc,
        minY: Math.min(acc.minY, value),
        maxY: Math.max(acc.maxY, value),
      };
    },
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}
