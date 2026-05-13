/** @file WebGL geometry cache keyed by RenderTree node identity. */

import type { Fill, PathContour } from "@higma-document-models/fig/scene-graph";
import type { RenderPathNode, RenderTextNode } from "../../scene-graph/render-tree";
import {
  generateEllipseVertices,
  generateRectVertices,
  tessellateContours,
} from "../tessellation/tessellation";
import { tessellatePathStroke } from "../tessellation/stroke-tessellation";
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
   * `tessellateContours(..., autoDetectWinding=false)` is intentionally
   * different from `backgroundMaskVertices` (which auto-detects),
   * so we precompute both alongside the parsed contours instead of
   * re-flattening every drop-shadow draw.
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
  readonly fills: readonly Fill[];
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
  readonly contours: readonly PathContour[];
  readonly vertices: Float32Array;
  readonly prepared: ReturnType<typeof prepareFanTriangles>;
};

type TextGlyphGeometry = {
  readonly runs: readonly TextGlyphRunGeometry[];
};

export type WebGLGeometryCache = {
  readonly getRectVertices: (width: number, height: number, cornerRadius?: CornerRadius) => Float32Array;
  readonly getEllipseVertices: (params: { readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number }) => Float32Array;
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

const MAX_GEOMETRY_CACHE_ENTRIES = 2048;

function getCachedGeometry<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const value = create();
  if (cache.size >= MAX_GEOMETRY_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (typeof firstKey === "string") {
      cache.delete(firstKey);
    }
  }
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
    fills: instruction.fills,
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
  const pathGeometry = new WeakMap<RenderPathNode, PathGeometry>();
  const pathFillPlanGeometry = new WeakMap<RenderPathNode, PathFillPlanGeometry>();
  const pathStrokeVertices = new WeakMap<RenderPathNode, Map<string, Float32Array>>();
  const textGlyphGeometry = new WeakMap<RenderTextNode, TextGlyphGeometry>();

  return {
    getRectVertices(widthValue, heightValue, cornerRadius) {
      return getCachedGeometry(
        rectVertices,
        `${widthValue}:${heightValue}:${cornerRadiusCacheKey(cornerRadius)}`,
        () => generateRectVertices(widthValue, heightValue, cornerRadius),
      );
    },

    getEllipseVertices({ cx, cy, rx, ry }) {
      return getCachedGeometry(
        ellipseVertices,
        `${cx}:${cy}:${rx}:${ry}`,
        () => generateEllipseVertices({ cx, cy, rx, ry }),
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
      const value: PathGeometry = {
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
      // The plan would re-parse `paths[i].d` on every render if called
      // from the hot loop; doing it once per node here is the whole
      // point of the cache.
      const plan = createWebGLPathFillPlan({
        paths: node.paths,
        sourceFills: node.sourceFills,
      });
      const instructions: PathFillInstructionGeometry[] = [];
      for (const instruction of plan) {
        if (instruction.fills.length === 0) {
          continue;
        }
        const built = buildPathFillInstructionGeometry(instruction);
        if (built) {
          instructions.push(built);
        }
      }
      const value: PathFillPlanGeometry = { instructions };
      pathFillPlanGeometry.set(node, value);
      return value;
    },

    getTextGlyphGeometry(node) {
      const cached = textGlyphGeometry.get(node);
      if (cached) {
        return cached;
      }
      if (node.content.mode !== "glyphs") {
        throw new Error(`WebGL text glyph geometry cache requires glyph content for text node ${node.id}`);
      }
      // One tessellation pass per fill-run keeps WebGL aligned with the
      // SVG path emitter (which also outputs one <path> per run). The
      // renderer iterates these runs and submits a stencil-fill draw
      // call per run with the run's fillColor / fillOpacity.
      const runs: TextGlyphRunGeometry[] = node.content.runs.map((run) => {
        const contours = svgPathDToContours({ d: run.d });
        return {
          fillColor: run.fillColor,
          fillOpacity: run.fillOpacity,
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
      const value: TextGlyphGeometry = { runs };
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
    },
  };
}
