/** @file Selection hit resolution for Kiwi editor bounds. */
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigGuid } from "@higma-document-models/fig/types";
import { filterMarqueeSelectionByHierarchy } from "./bounds";

/** Resolve a canvas hit string back to the Kiwi GUID carried by the node. */
export function resolveNodeGuidFromCanvasId(
  document: FigKiwiDocumentIndex,
  id: string,
): FigGuid {
  const node = document.nodesByGuid.get(id);
  if (node === undefined || node.guid === undefined) {
    throw new Error(`resolveNodeGuidFromCanvasId: node ${id} is not present in the Kiwi document`);
  }
  return node.guid;
}

/** Resolve marquee hits to selectable Kiwi GUIDs without ancestor duplicates. */
export function resolveSelectableMarqueeGuids(
  document: FigKiwiDocumentIndex,
  itemIds: readonly string[],
): readonly FigGuid[] {
  return filterMarqueeSelectionByHierarchy(document, itemIds).map((id) => resolveNodeGuidFromCanvasId(document, id));
}

/** Convert GUIDs to the canvas id strings required by the shared EditorCanvas. */
export function canvasIdsFromGuids(guids: readonly FigGuid[]): readonly string[] {
  return guids.map(guidToString);
}
