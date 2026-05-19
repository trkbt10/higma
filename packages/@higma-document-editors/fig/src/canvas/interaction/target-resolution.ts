/** @file Canvas hit target resolution. */
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import type { NodeBounds, PointLike } from "./bounds";
import { findDeepestBoundsAtPoint } from "./bounds";
import { resolveNodeGuidFromCanvasId } from "./selection-resolution";

export type ResolveCanvasInteractionTargetOptions = {
  readonly document: FigKiwiDocumentIndex;
  readonly itemBounds: readonly NodeBounds[];
  readonly hitId: string;
  readonly point: PointLike;
};

/** Resolve the deepest node at a page point, falling back to the browser hit id only when no bound contains the point. */
export function resolveInteractionTargetGuid({
  document,
  itemBounds,
  hitId,
  point,
}: ResolveCanvasInteractionTargetOptions): FigGuid {
  const deepest = findDeepestBoundsAtPoint(itemBounds, point);
  return resolveNodeGuidFromCanvasId(document, deepest?.id ?? hitId);
}
