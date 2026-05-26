/** @file WebGL geometry cache keyed by RenderTree node object references. */

import type { BlendMode, ClipPathShape, PathContour, StrokeShape } from "@higma-document-renderers/fig/scene-graph";
import type { RenderPathNode, RenderTextGlyphs, RenderTextNode } from "../../scene-graph";
import {
  generateEllipseVertices,
  generateRectVertices,
  tessellateContours,
} from "../tessellation/tessellation";
import {
  tessellateEllipseStroke,
  tessellatePathStroke,
  tessellateRectAlignedStroke,
  tessellateRectStroke,
} from "../tessellation/stroke-tessellation";
import { generateCoverQuad, prepareFanTriangles, type Bounds as StencilBounds } from "../tessellation/stencil-fill";
import { svgPathDToContours } from "../tessellation/path-contours";
import {
  createWebGLPathFillPlan,
  type WebGLPathFillInstruction,
  type WebGLPathFillRule,
} from "../fill/render-path-fill-plan";
import { pathContoursBoundingBox, type CornerRadius } from "@higma-primitives/path";

type PathGeometry = {
  readonly parsedContours: readonly PathContour[];
  readonly prepared: ReturnType<typeof prepareFanTriangles>;
  /**
   * Cover quad sized to `prepared.bounds`, paired with `prepared` so
   * the drop-shadow stencil pipeline never has to recompute the quad
   * per frame. Null when `prepared` is null (degenerate contours).
   */
  readonly coverQuad: Float32Array | null;
  readonly pathVertices: Float32Array;
  readonly backgroundMaskVertices: Float32Array;
  /**
   * TrueType-winding earcut silhouette used by drop-shadow stencils.
   * This is kept separate from fill-plan geometry because SVG filter
   * SourceAlpha for these vector effects follows the authored path
   * silhouette, not every per-contour fill override expansion.
   */
  readonly dropShadowSilhouetteVertices: Float32Array;
  /**
   * Loose control-hull element size of the parsed contours, kept here
   * so per-frame stroke-paint draws don't need to re-flatten the path
   * just to size a gradient. Computed once when the node is first seen
   * and reused for every subsequent render of the same node instance.
   */
  readonly elementSize: { readonly width: number; readonly height: number };
};

/**
 * One prepared fill draw for a `RenderPathNode`. Mirrors the structure
 * the renderer needs at draw time (stencil fan vertices + cover quad +
 * element size for gradient-relative paints), all cached so pan/zoom
 * rerenders never re-flatten the contour Béziers.
 */
export type PathFillInstructionGeometry = {
  readonly fillRule: WebGLPathFillRule;
  readonly fillOverride: WebGLPathFillInstruction["fillOverride"];
  readonly contours: readonly PathContour[];
  readonly prepared: NonNullable<ReturnType<typeof prepareFanTriangles>>;
  readonly coverQuad: Float32Array;
  readonly bounds: StencilBounds;
  readonly elementSize: { readonly width: number; readonly height: number };
};

type PathFillPlanGeometry = {
  readonly instructions: readonly PathFillInstructionGeometry[];
};

/**
 * Per-fill-run glyph geometry: each entry corresponds to one
 * `RenderTextGlyphRun` (i.e. one CSS-hex fill colour) and carries the
 * tessellated triangles for the contours that paint with that fill.
 *
 * Decorations (underlines / strikethroughs) are folded into the base
 * run by the render-tree resolver, so this cache treats them as just
 * more contours of run 0.
 */
export type TextGlyphRunGeometry = {
  readonly fillColor: string;
  readonly fillOpacity: number;
  readonly blendMode?: BlendMode;
  readonly contours: readonly PathContour[];
  readonly vertices: Float32Array;
  readonly prepared: ReturnType<typeof prepareFanTriangles>;
};

type TextGlyphGeometry = {
  readonly runs: readonly TextGlyphRunGeometry[];
};

export type WebGLGeometryCache = {
  readonly getRectVertices: (width: number, height: number, cornerRadius?: CornerRadius, cornerSmoothing?: number) => Float32Array;
  readonly getEllipseVertices: (params: { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }) => Float32Array;
  readonly getRectStrokeVertices: (params: {
    readonly width: number;
    readonly height: number;
    readonly cornerRadius?: CornerRadius;
    readonly strokeWidth: number;
    readonly dashPattern?: readonly number[];
  }) => Float32Array;
  readonly getRectAlignedStrokeVertices: (params: {
    readonly width: number;
    readonly height: number;
    readonly cornerRadius?: CornerRadius;
    readonly strokeWidth: number;
    readonly align: "INSIDE" | "OUTSIDE";
  }) => Float32Array;
  readonly getEllipseStrokeVertices: (params: {
    readonly cx: number;
    readonly cy: number;
    readonly rx: number;
    readonly ry: number;
    readonly strokeWidth: number;
    readonly dashPattern?: readonly number[];
  }) => Float32Array;
  readonly getPathContourStrokeVertices: (params: {
    readonly contours: readonly PathContour[];
    readonly strokeWidth: number;
    readonly dashPattern?: readonly number[];
  }) => Float32Array;
  readonly getStrokeShapeStrokeVertices: (params: {
    readonly shape: StrokeShape;
    readonly strokeWidth: number;
    readonly dashPattern?: readonly number[];
  }) => Float32Array;
  readonly getStrokeShapeStencilVertices: (shape: StrokeShape) => Float32Array;
  readonly getClipPathShapeVertices: (shape: ClipPathShape) => Float32Array;
  readonly getPathGeometry: (node: RenderPathNode) => PathGeometry;
  readonly getPathFillPlanGeometry: (node: RenderPathNode) => PathFillPlanGeometry;
  readonly getTextGlyphGeometry: (node: RenderTextNode) => TextGlyphGeometry;
  readonly getPathStrokeVertices: (params: {
    readonly node: RenderPathNode;
    readonly contours: readonly PathContour[];
    readonly strokeWidth: number;
    readonly dashPattern?: readonly number[];
  }) => Float32Array;
  readonly dispose: () => void;
};

function getCachedGeometry<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const value = create();
  cache.set(key, value);
  return value;
}

function cornerRadiusCacheKey(cornerRadius: CornerRadius | undefined): string {
  return Array.isArray(cornerRadius) ? cornerRadius.join(",") : `${cornerRadius ?? ""}`;
}

function pathStrokeCacheKey(
  { strokeWidth, dashPattern }: {
    readonly strokeWidth: number;
    readonly dashPattern?: readonly number[];
  },
): string {
  return `${strokeWidth}\u001e${dashPattern?.join(",") ?? ""}`;
}

function strokeShapeDependencyKey(shape: StrokeShape): string {
  switch (shape.kind) {
    case "rect":
      return JSON.stringify([
        "rect",
        shape.width,
        shape.height,
        shape.cornerRadius ?? null,
        shape.cornerSmoothing ?? null,
      ]);
    case "ellipse":
      return JSON.stringify([
        "ellipse",
        shape.cx,
        shape.cy,
        shape.rx,
        shape.ry,
      ]);
    case "path":
      return JSON.stringify([
        "path",
        shape.paths.map((path) => [path.d, path.fillRule ?? "nonzero"]),
      ]);
  }
}

function clipPathShapeDependencyKey(shape: ClipPathShape): string {
  switch (shape.kind) {
    case "rect":
      return JSON.stringify([
        "rect",
        shape.x,
        shape.y,
        shape.width,
        shape.height,
        shape.rx ?? null,
        shape.ry ?? null,
      ]);
    case "ellipse":
      return JSON.stringify([
        "ellipse",
        shape.cx,
        shape.cy,
        shape.rx,
        shape.ry,
      ]);
    case "path":
      return JSON.stringify([
        "path",
        shape.d,
        shape.fillRule ?? "nonzero",
      ]);
  }
}

function pathContoursStrokeCacheKey(
  { strokeWidth, dashPattern }: {
    readonly strokeWidth: number;
    readonly dashPattern?: readonly number[];
  },
): string {
  return pathStrokeCacheKey({ strokeWidth, dashPattern });
}

function requireRenderTextGlyphContent(node: RenderTextNode): RenderTextGlyphs {
  if (node.content.mode !== "glyphs") {
    throw new Error(`WebGL text glyph geometry cache requires glyph content for text node ${node.id}`);
  }
  return node.content;
}

function clipPathRectRadius(shape: Extract<ClipPathShape, { readonly kind: "rect" }>): number | undefined {
  if (shape.rx === undefined) {
    return shape.ry;
  }
  if (shape.ry === undefined || shape.ry === shape.rx) {
    return shape.rx;
  }
  throw new Error(`WebGL clip-path rect has unsupported elliptical corner radii rx=${shape.rx} ry=${shape.ry}`);
}

function translateVertices(vertices: Float32Array, dx: number, dy: number): Float32Array {
  if (dx === 0 && dy === 0) {
    return vertices;
  }
  const translated = new Float32Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 2) {
    translated[i] = vertices[i] + dx;
    translated[i + 1] = vertices[i + 1] + dy;
  }
  return translated;
}

function contoursElementSize(
  contours: readonly PathContour[],
): { readonly width: number; readonly height: number } {
  const bbox = pathContoursBoundingBox(contours);
  if (!bbox) {
    return { width: 1, height: 1 };
  }
  return { width: Math.max(1, bbox.w), height: Math.max(1, bbox.h) };
}

function buildPathFillInstructionGeometry(
  instruction: WebGLPathFillInstruction,
): PathFillInstructionGeometry | null {
  // `prepareFanTriangles` returns null when the contour set has fewer
  // than three usable points — those are degenerate fills that we drop
  // at the draw site, so the cache likewise drops them here.
  const prepared = prepareFanTriangles(
    instruction.contours,
    0.25,
    instruction.fillRule === "nonzero",
  );
  if (!prepared) {
    return null;
  }
  return {
    fillRule: instruction.fillRule,
    fillOverride: instruction.fillOverride,
    contours: instruction.contours,
    prepared,
    coverQuad: generateCoverQuad(prepared.bounds),
    bounds: prepared.bounds,
    elementSize: {
      width: prepared.bounds.maxX - prepared.bounds.minX,
      height: prepared.bounds.maxY - prepared.bounds.minY,
    },
  };
}

/** Create the WebGL geometry cache for viewport rerenders. */
export function createWebGLGeometryCache(): WebGLGeometryCache {
  const rectVertices = new Map<string, Float32Array>();
  const ellipseVertices = new Map<string, Float32Array>();
  const rectStrokeVertices = new Map<string, Float32Array>();
  const rectAlignedStrokeVertices = new Map<string, Float32Array>();
  const ellipseStrokeVertices = new Map<string, Float32Array>();
  const pathContourStrokeVertices = new WeakMap<readonly PathContour[], Map<string, Float32Array>>();
  const strokeShapeStrokeVertices = new Map<string, Float32Array>();
  const strokeShapeStencilVertices = new Map<string, Float32Array>();
  const clipPathShapeVertices = new Map<string, Float32Array>();
  const pathGeometry = new WeakMap<RenderPathNode, PathGeometry>();
  const pathFillPlanGeometry = new WeakMap<RenderPathNode, PathFillPlanGeometry>();
  const pathStrokeVertices = new WeakMap<RenderPathNode, Map<string, Float32Array>>();
  const textGlyphGeometry = new WeakMap<RenderTextNode, TextGlyphGeometry>();

  return {
    getRectVertices(widthValue, heightValue, cornerRadius, cornerSmoothing) {
      return getCachedGeometry(
        rectVertices,
        `${widthValue}:${heightValue}:${cornerRadiusCacheKey(cornerRadius)}:${cornerSmoothing ?? ""}`,
        () => generateRectVertices(widthValue, heightValue, cornerRadius, cornerSmoothing),
      );
    },

    getEllipseVertices({ cx, cy, rx, ry }) {
      return getCachedGeometry(
        ellipseVertices,
        `${cx}:${cy}:${rx}:${ry}`,
        () => generateEllipseVertices({ cx, cy, rx, ry }),
      );
    },

    getRectStrokeVertices({ width: widthValue, height: heightValue, cornerRadius, strokeWidth, dashPattern }) {
      return getCachedGeometry(
        rectStrokeVertices,
        `${widthValue}:${heightValue}:${cornerRadiusCacheKey(cornerRadius)}:${pathStrokeCacheKey({ strokeWidth, dashPattern })}`,
        () => tessellateRectStroke({
          w: widthValue,
          h: heightValue,
          cornerRadius,
          strokeWidth,
          dashPattern,
        }),
      );
    },

    getRectAlignedStrokeVertices({ width: widthValue, height: heightValue, cornerRadius, strokeWidth, align }) {
      return getCachedGeometry(
        rectAlignedStrokeVertices,
        `${widthValue}:${heightValue}:${cornerRadiusCacheKey(cornerRadius)}:${strokeWidth}:${align}`,
        () => tessellateRectAlignedStroke({
          w: widthValue,
          h: heightValue,
          cornerRadius,
          strokeWidth,
          align,
        }),
      );
    },

    getEllipseStrokeVertices({ cx, cy, rx, ry, strokeWidth, dashPattern }) {
      return getCachedGeometry(
        ellipseStrokeVertices,
        `${cx}:${cy}:${rx}:${ry}:${pathStrokeCacheKey({ strokeWidth, dashPattern })}`,
        () => tessellateEllipseStroke({ cx, cy, rx, ry, strokeWidth, dashPattern }),
      );
    },

    getPathContourStrokeVertices({ contours, strokeWidth, dashPattern }) {
      const cache = pathContourStrokeVertices.get(contours) ?? new Map<string, Float32Array>();
      if (!pathContourStrokeVertices.has(contours)) {
        pathContourStrokeVertices.set(contours, cache);
      }
      return getCachedGeometry(
        cache,
        pathContoursStrokeCacheKey({ strokeWidth, dashPattern }),
        () => tessellatePathStroke(contours, strokeWidth, { dashPattern }),
      );
    },

    getStrokeShapeStrokeVertices({ shape, strokeWidth, dashPattern }) {
      return getCachedGeometry(
        strokeShapeStrokeVertices,
        `${strokeShapeDependencyKey(shape)}\u001e${pathStrokeCacheKey({ strokeWidth, dashPattern })}`,
        () => {
          switch (shape.kind) {
            case "rect":
              return tessellateRectStroke({
                w: shape.width,
                h: shape.height,
                cornerRadius: shape.cornerRadius,
                strokeWidth,
                dashPattern,
              });
            case "ellipse":
              return tessellateEllipseStroke({
                cx: shape.cx,
                cy: shape.cy,
                rx: shape.rx,
                ry: shape.ry,
                strokeWidth,
                dashPattern,
              });
            case "path":
              return new Float32Array(0);
          }
        },
      );
    },

    getStrokeShapeStencilVertices(shape) {
      return getCachedGeometry(
        strokeShapeStencilVertices,
        strokeShapeDependencyKey(shape),
        () => {
          switch (shape.kind) {
            case "rect":
              return generateRectVertices(shape.width, shape.height, shape.cornerRadius, shape.cornerSmoothing);
            case "ellipse":
              return generateEllipseVertices({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry });
            case "path": {
              const contours: PathContour[] = shape.paths.flatMap((path) => svgPathDToContours({
                d: path.d,
                windingRule: path.fillRule ?? "nonzero",
              }));
              return tessellateContours(contours, 0.25, true);
            }
          }
        },
      );
    },

    getClipPathShapeVertices(shape) {
      return getCachedGeometry(
        clipPathShapeVertices,
        clipPathShapeDependencyKey(shape),
        () => {
          switch (shape.kind) {
            case "rect": {
              const cornerRadius = clipPathRectRadius(shape);
              return translateVertices(
                generateRectVertices(shape.width, shape.height, cornerRadius),
                shape.x,
                shape.y,
              );
            }
            case "ellipse":
              return generateEllipseVertices({ cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry });
            case "path": {
              const contours = svgPathDToContours({
                d: shape.d,
                windingRule: shape.fillRule ?? "nonzero",
              });
              return tessellateContours(contours, 0.25, true);
            }
          }
        },
      );
    },

    getPathGeometry(node) {
      const cached = pathGeometry.get(node);
      if (cached) {
        return cached;
      }
      const parsedContours = node.paths.flatMap((rp) => svgPathDToContours({
        d: rp.d,
        windingRule: rp.fillRule ?? "nonzero",
      }));
      const usesEvenOddFill = parsedContours.some((contour) => contour.windingRule === "evenodd");
      const prepared = prepareFanTriangles(parsedContours, 0.25, !usesEvenOddFill);
      const value = {
        parsedContours,
        prepared,
        coverQuad: prepared ? generateCoverQuad(prepared.bounds) : null,
        pathVertices: new Float32Array(0),
        backgroundMaskVertices: tessellateContours(parsedContours, 0.25, true),
        dropShadowSilhouetteVertices: tessellateContours(parsedContours, 0.25, false),
        elementSize: contoursElementSize(parsedContours),
      };
      pathGeometry.set(node, value);
      return value;
    },

    getPathFillPlanGeometry(node) {
      const cached = pathFillPlanGeometry.get(node);
      if (cached) {
        return cached;
      }
      // Build via the SoT plan builder so per-contour fill overrides /
      // fill-rule resolution stay consistent with the SVG renderer.
      const plan = createWebGLPathFillPlan({
        paths: node.paths,
      });
      const instructions: PathFillInstructionGeometry[] = [];
      for (const instruction of plan) {
        const built = buildPathFillInstructionGeometry(instruction);
        if (built) {
          instructions.push(built);
        }
      }
      const value = { instructions };
      pathFillPlanGeometry.set(node, value);
      return value;
    },

    getTextGlyphGeometry(node) {
      const cached = textGlyphGeometry.get(node);
      if (cached) {
        return cached;
      }
      const glyphContent = requireRenderTextGlyphContent(node);
      // One tessellation pass per fill-run keeps WebGL aligned with the
      // SVG path emitter (which also outputs one <path> per run). The
      // renderer iterates these runs and submits a stencil-fill draw
      // call per run with the run's fillColor / fillOpacity.
      const runs: TextGlyphRunGeometry[] = glyphContent.runs.map((run) => {
        const contours = svgPathDToContours({ d: run.d });
        return {
          fillColor: run.fillColor,
          fillOpacity: run.fillOpacity,
          blendMode: run.blendMode,
          contours,
          vertices: tessellateContours(contours, 0.1, true),
          // Use the single-shared-anchor fan mode for glyph contours.
          // The per-contour-anchor mode (where each contour fans from
          // its own first vertex) produces near-degenerate slivers
          // whenever a glyph outline walks along a straight edge — the
          // flattened polyline carries many near-collinear points and
          // triangles (v0, vi, vi+1) collapse to almost-zero area, which
          // the GPU may skip rasterising. Skipped triangles don't flip
          // the stencil for INVERT-mode even-odd fill, leaving horizontal
          // streaks of stencil=0 inside what should be solid glyphs.
          // The shared anchor (one corner outside the union bounds) keeps
          // every fan triangle wide and non-degenerate, so every edge
          // contributes exactly one stencil flip and the even-odd rule
          // resolves cleanly.
          //
          // The flattening tolerance is also tightened to 0.025 so the
          // fan triangles approximate curved glyph edges with three to
          // four times more segments. Coarser flattening leaves visible
          // straight-line artefacts on bowls / curves (Bold weights make
          // them most obvious) that the stencil-fill path bakes into
          // the rasterised glyph as binary jaggies — finer flattening
          // closes those.
          prepared: prepareFanTriangles(contours, 0.025, true),
        };
      });
      const value = { runs };
      textGlyphGeometry.set(node, value);
      return value;
    },

    getPathStrokeVertices({ node, contours, strokeWidth, dashPattern }) {
      const cache = pathStrokeVertices.get(node) ?? new Map<string, Float32Array>();
      if (!pathStrokeVertices.has(node)) {
        pathStrokeVertices.set(node, cache);
      }
      return getCachedGeometry(
        cache,
        pathStrokeCacheKey({ strokeWidth, dashPattern }),
        () => tessellatePathStroke(contours, strokeWidth, { dashPattern }),
      );
    },

    dispose() {
      rectVertices.clear();
      ellipseVertices.clear();
      rectStrokeVertices.clear();
      rectAlignedStrokeVertices.clear();
      ellipseStrokeVertices.clear();
      strokeShapeStrokeVertices.clear();
      strokeShapeStencilVertices.clear();
      clipPathShapeVertices.clear();
    },
  };
}
