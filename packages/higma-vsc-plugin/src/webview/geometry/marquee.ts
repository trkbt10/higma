/**
 * @file Drag-marquee geometry — build a world-space rect from two
 * pointer samples and find the top-level page children whose AABB
 * intersects it.
 *
 * Marquee selection deliberately filters to `depth === 0`, matching
 * the canvas-level selection idiom used by every vector tool (Figma,
 * Sketch, Illustrator): a rectangle covering a Frame selects that
 * Frame as a whole, never the dozens of descendants underneath. The
 * user can still drill deeper with Cmd/Ctrl-click or Shift-click on
 * the tree.
 *
 * "Intersect" here means *any* overlap (touching boundaries count) so
 * the user only needs to graze a Frame to capture it — matching the
 * lasso behaviour of the surrounding tools.
 */

import type { NodeBounds } from "./node-bounds";

export type WorldPoint = { readonly x: number; readonly y: number };

export type WorldRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Normalise two pointer-sampled corners into a positive-sized rect. */
export function buildMarqueeRect(start: WorldPoint, end: WorldPoint): WorldRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function rectsOverlap(a: WorldRect, b: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): boolean {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

/**
 * Return the ids of every top-level visible node whose AABB intersects
 * `rect`, preserved in painter order. Painter order matters: the last
 * entry becomes the marquee's primary anchor, mirroring the
 * "last-clicked wins" convention the click selection uses.
 */
export function findTopLevelIdsInRect(
  bounds: readonly NodeBounds[],
  rect: WorldRect,
): readonly string[] {
  const out: string[] = [];
  for (const entry of bounds) {
    if (!entry.visible) {
      continue;
    }
    if (entry.depth !== 0) {
      continue;
    }
    if (rectsOverlap(rect, entry)) {
      out.push(entry.id);
    }
  }
  return out;
}
