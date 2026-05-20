/**
 * @file Topmost-wins point query against pre-computed node bounds.
 *
 * Bounds arrive in painter order (see `computeNodeBounds`). The
 * topmost paintable node at a point is the *last* visible entry whose
 * AABB contains it, so we scan from the end and return on first hit.
 *
 * Hit-testing is currently bbox-based. Vector paths and image
 * transparency are not consulted — Figma's inspect mode is also
 * bbox-first; sub-pixel transparency hits are an explicit non-goal.
 */

import type { NodeBounds } from "./node-bounds";






/** Return the topmost visible bounds entry containing a page-space point. */
export function findNodeAtPoint(
  bounds: readonly NodeBounds[],
  point: { readonly x: number; readonly y: number },
): NodeBounds | null {
  for (let i = bounds.length - 1; i >= 0; i -= 1) {
    const entry = bounds[i];
    if (!entry || !entry.visible) {
      continue;
    }
    if (
      point.x >= entry.x &&
      point.x <= entry.x + entry.width &&
      point.y >= entry.y &&
      point.y <= entry.y + entry.height
    ) {
      return entry;
    }
  }
  return null;
}






/** Return the bounds entry for a Kiwi GUID string, or null when absent. */
export function findNodeById(
  bounds: readonly NodeBounds[],
  id: string | null,
): NodeBounds | null {
  if (id === null) {
    return null;
  }
  for (const entry of bounds) {
    if (entry.id === id) {
      return entry;
    }
  }
  return null;
}
