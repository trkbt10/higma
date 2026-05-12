/** @file WebGL geometry cache keyed by RenderTree node identity. */

import type { CornerRadius, PathContour } from "../../scene-graph/types";
import type { RenderPathNode, RenderTextNode } from "../../scene-graph/render-tree";
import {
  generateEllipseVertices,
  generateRectVertices,
  tessellateContours,
} from "../tessellation/tessellation";
import { tessellatePathStroke } from "../tessellation/stroke-tessellation";
import { prepareFanTriangles } from "../tessellation/stencil-fill";
import { svgPathDToContours } from "../tessellation/path-contours";

type PathGeometry = {
  readonly parsedContours: readonly PathContour[];
  readonly prepared: ReturnType<typeof prepareFanTriangles>;
  readonly pathVertices: Float32Array;
  readonly backgroundMaskVertices: Float32Array;
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

/** Create the WebGL geometry cache for viewport rerenders. */
export function createWebGLGeometryCache(): WebGLGeometryCache {
  const rectVertices = new Map<string, Float32Array>();
  const ellipseVertices = new Map<string, Float32Array>();
  const pathGeometry = new WeakMap<RenderPathNode, PathGeometry>();
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
      const value = {
        parsedContours,
        prepared: prepareFanTriangles(parsedContours, 0.25, !usesEvenOddFill),
        pathVertices: new Float32Array(0),
        backgroundMaskVertices: tessellateContours(parsedContours, 0.25, true),
      };
      pathGeometry.set(node, value);
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
