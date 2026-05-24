/** @file Viewport visibility derived from Kiwi editor node bounds. */
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";
import type { NodeBounds } from "../interaction/bounds";
import { layoutBoundsTouchOrOverlap, type LayoutBounds } from "./layout-bounds";

function rootNodeId(node: FigNode): string {
  if (node.guid === undefined) {
    throw new Error(`viewport-node-visibility requires root node "${node.name ?? "(unnamed)"}" to carry a Kiwi guid`);
  }
  return guidToString(node.guid);
}

/** Filter editor hit/selection bounds to the viewport while preserving explicitly selected nodes. */
export function filterNodeBoundsForViewport({
  bounds,
  viewport,
  retainedIds,
}: {
  readonly bounds: readonly NodeBounds[];
  readonly viewport: LayoutBounds | null;
  readonly retainedIds: readonly string[];
}): readonly NodeBounds[] {
  if (viewport === null) {
    return bounds;
  }
  const retained = new Set(retainedIds);
  return bounds.filter((nodeBounds) => retained.has(nodeBounds.id) || layoutBoundsTouchOrOverlap(nodeBounds.aabb, viewport));
}

/** Select top-level Kiwi render roots that have visible descendant bounds in the viewport. */
export function filterRootNodesForViewport({
  nodes,
  bounds,
  viewport,
}: {
  readonly nodes: readonly FigNode[];
  readonly bounds: readonly NodeBounds[];
  readonly viewport: LayoutBounds | null;
}): readonly FigNode[] {
  if (viewport === null) {
    return nodes;
  }
  const visibleRootIds = new Set(
    bounds
      .filter((nodeBounds) => layoutBoundsTouchOrOverlap(nodeBounds.aabb, viewport))
      .map((nodeBounds) => nodeBounds.rootId),
  );
  return nodes.filter((node) => visibleRootIds.has(rootNodeId(node)));
}
