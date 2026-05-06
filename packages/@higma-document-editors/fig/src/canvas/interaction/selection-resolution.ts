/** @file Canvas selection target resolution helpers. */

import type { FigDesignNode, FigNodeId } from "@higma-document-models/fig/domain";
import { canEnterVectorPathEdit } from "../../vector-path/editor-model";
import { filterMarqueeSelectionByHierarchy } from "./bounds";
import { resolveCanvasInteractionTarget, type CanvasTargetMode } from "./target-resolution";

type ActivePageChildren = {
  readonly children: readonly FigDesignNode[];
};

type ItemBounds = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** Resolve marquee IDs while preserving hierarchy selection rules. */
export function resolveSelectableMarqueeIds({
  activePage,
  itemIds,
}: {
  readonly activePage: ActivePageChildren | null | undefined;
  readonly itemIds: readonly string[];
}): readonly string[] {
  if (!activePage) {
    return itemIds;
  }
  return filterMarqueeSelectionByHierarchy(activePage.children, itemIds);
}

/** Resolve the fig node that should receive a canvas interaction. */
export function resolveInteractionTargetNodeId({
  activePage,
  itemBounds,
  hitNodeId,
  targetMode,
  point,
}: {
  readonly activePage: ActivePageChildren | null | undefined;
  readonly itemBounds: readonly ItemBounds[];
  readonly hitNodeId: FigNodeId;
  readonly targetMode: CanvasTargetMode;
  readonly point: { readonly x: number; readonly y: number };
}): FigNodeId {
  if (!activePage) {
    return hitNodeId;
  }
  return resolveCanvasInteractionTarget({
    pageChildren: activePage.children,
    itemBounds,
    point,
    hitNodeId,
    mode: targetMode,
    canEditPath: canEnterVectorPathEdit,
  });
}
