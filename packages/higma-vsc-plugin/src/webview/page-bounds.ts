/**
 * @file Compute an axis-aligned bounding box for a fig page in canvas
 * coordinates.
 *
 * The viewer needs a viewport rectangle to feed `useFigSceneGraph`.
 * Canvas-space coordinates come from each top-level child's transform
 * (`m02`, `m12`) plus its `size`. Rotation/skew is approximated by
 * transforming the four local corners of `(0, 0)..(size.x, size.y)`
 * through the affine matrix before unioning.
 *
 * Hidden children are still included — viewers should expose layout
 * even when an artboard is currently invisible.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";

export type PageBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

const DEFAULT_FALLBACK_SIZE = 1024;

type Matrix = readonly [number, number, number, number, number, number];

function readMatrix(node: FigDesignNode): Matrix {
  const t = node.transform;
  return [t.m00, t.m01, t.m02, t.m10, t.m11, t.m12];
}

function applyMatrix(m: Matrix, x: number, y: number): { readonly x: number; readonly y: number } {
  const [m00, m01, m02, m10, m11, m12] = m;
  return {
    x: m00 * x + m01 * y + m02,
    y: m10 * x + m11 * y + m12,
  };
}

/**
 * Computes the union AABB of every child of a fig page in canvas
 * (page-local) coordinates.
 *
 * Returns a `DEFAULT_FALLBACK_SIZE`-square bounds anchored at the origin
 * when the page has no children — the viewer renders an empty canvas
 * surface rather than degenerating to a 0×0 viewBox that browsers treat
 * as invalid.
 */
export function computePageBounds(children: readonly FigDesignNode[]): PageBounds {
  if (children.length === 0) {
    return { x: 0, y: 0, width: DEFAULT_FALLBACK_SIZE, height: DEFAULT_FALLBACK_SIZE };
  }

  const corners = children.flatMap((child) => {
    const matrix = readMatrix(child);
    const w = child.size.x;
    const h = child.size.y;
    return [
      applyMatrix(matrix, 0, 0),
      applyMatrix(matrix, w, 0),
      applyMatrix(matrix, w, h),
      applyMatrix(matrix, 0, h),
    ];
  });

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const width = Math.max(1, maxX - minX);
  const height = Math.max(1, maxY - minY);
  return { x: minX, y: minY, width, height };
}
