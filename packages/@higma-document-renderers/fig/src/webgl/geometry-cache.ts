/** @file WebGL geometry cache keyed by RenderTree node identity. */

import type { CornerRadius, PathContour } from "../scene-graph/types";
import type { RenderPathNode, RenderTextNode } from "../scene-graph/render-tree";
import {
  generateEllipseVertices,
  generateRectVertices,
  tessellateContours,
} from "./tessellation";
import { tessellatePathStroke } from "./stroke-tessellation";
import { prepareFanTriangles } from "./stencil-fill";
import { svgPathDToContours } from "./path-contours";

type PathGeometry = {
  readonly parsedContours: readonly PathContour[];
  readonly prepared: ReturnType<typeof prepareFanTriangles>;
  readonly pathVertices: Float32Array;
  readonly backgroundMaskVertices: Float32Array;
};

type TextGlyphGeometry = {
  readonly contours: readonly PathContour[];
  readonly vertices: Float32Array;
  readonly prepared: ReturnType<typeof prepareFanTriangles>;
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
      const contours = svgPathDToContours({ d: node.content.d });
      const value = {
        contours,
        vertices: tessellateContours(contours, 0.1, true),
        prepared: prepareFanTriangles(contours, 0.1),
      };
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
