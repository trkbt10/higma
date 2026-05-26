/** @file Viewport visibility derived from renderer SceneGraph node bounds. */
import type { SceneGraphNodeBounds } from "@higma-document-renderers/fig/scene-graph";
import { layoutBoundsTouchOrOverlap, type LayoutBounds } from "./layout-bounds";

/** Filter editor hit/selection bounds to the viewport while keeping selected Kiwi nodes addressable. */
export function filterNodeBoundsForViewport({
  bounds,
  viewport,
  selectedNodeGuidKeys,
}: {
  readonly bounds: readonly SceneGraphNodeBounds[];
  readonly viewport: LayoutBounds | null;
  readonly selectedNodeGuidKeys: readonly string[];
}): readonly SceneGraphNodeBounds[] {
  if (viewport === null) {
    return bounds;
  }
  const selectedGuidKeys = new Set(selectedNodeGuidKeys);
  return bounds.filter((nodeBounds) => selectedGuidKeys.has(nodeBounds.id) || layoutBoundsTouchOrOverlap(nodeBounds.aabb, viewport));
}
