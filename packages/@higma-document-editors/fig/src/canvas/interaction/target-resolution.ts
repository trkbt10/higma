/** @file Canvas hit target resolution. */
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { SceneGraphNodeBounds } from "@higma-document-renderers/fig/scene-graph";
import type { PointLike } from "./rendered-node-bounds";
import { findDeepestBoundsAtPoint } from "./rendered-node-bounds";
import { resolveNodeGuidFromCanvasId } from "./selection-resolution";

export type ResolveCanvasInteractionTargetOptions = {
  readonly document: FigKiwiDocumentIndex;
  readonly itemBounds: readonly SceneGraphNodeBounds[];
  readonly point: PointLike;
};

/** Resolve the deepest renderer-derived node bounds at a page point. */
export function resolveInteractionTargetGuid({
  document,
  itemBounds,
  point,
}: ResolveCanvasInteractionTargetOptions): FigGuid {
  const deepest = findDeepestBoundsAtPoint(itemBounds, point);
  if (deepest === undefined) {
    throw new Error(`resolveInteractionTargetGuid: no rendered SceneGraph bounds contain point (${point.x}, ${point.y})`);
  }
  return resolveNodeGuidFromCanvasId(document, deepest.id);
}
