/** @file Hit testing over renderer-derived SceneGraph node bounds. */
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import type { FigGuid, FigNode } from "@higma-document-models/fig/types";
import type { SceneGraphBoundsLike } from "@higma-document-renderers/fig/scene-graph";
import { guidToString } from "@higma-document-models/fig/domain";

export type PointLike = {
  readonly x: number;
  readonly y: number;
};

export type ExplicitKiwiSourceDocumentGuidSource = {
  readonly nodeChanges: readonly FigNode[];
};

export type RenderedNodeBoundsWithId = SceneGraphBoundsLike & {
  readonly id: string;
};

/** Return whether a point is inside or on the edge of an axis-aligned bounds. */
export function containsPointInBounds(bounds: SceneGraphBoundsLike, point: PointLike): boolean {
  return point.x >= bounds.x
    && point.y >= bounds.y
    && point.x <= bounds.x + bounds.width
    && point.y <= bounds.y + bounds.height;
}

/** Return the topmost/deepest bounds containing a point, optionally filtered. */
export function findDeepestBoundsAtPoint<T extends SceneGraphBoundsLike>(
  boundsList: readonly T[],
  point: PointLike,
  predicate?: (bounds: T) => boolean,
): T | undefined {
  for (const bounds of boundsList.toReversed()) {
    const predicateAccepts = predicate === undefined || predicate(bounds);
    if (containsPointInBounds(bounds, point) && predicateAccepts) {
      return bounds;
    }
  }
  return undefined;
}

function collectSelectedAncestors(
  document: FigKiwiDocumentIndex,
  selected: ReadonlySet<string>,
  ancestorsWithSelectedDescendant: Set<string>,
  parent: FigGuid | undefined,
): void {
  if (parent === undefined) {
    return;
  }
  const parentKey = guidToString(parent);
  if (selected.has(parentKey)) {
    ancestorsWithSelectedDescendant.add(parentKey);
  }
  collectSelectedAncestors(
    document,
    selected,
    ancestorsWithSelectedDescendant,
    document.nodesByGuid.get(parentKey)?.parentIndex?.guid,
  );
}

/** Remove ancestor hits when descendants are already hit by marquee selection. */
export function filterMarqueeSelectionByHierarchy(
  document: FigKiwiDocumentIndex,
  itemIds: readonly string[],
): readonly string[] {
  const selected = new Set(itemIds);
  const ancestorsWithSelectedDescendant = new Set<string>();
  for (const id of itemIds) {
    const node = document.nodesByGuid.get(id);
    if (node === undefined) {
      throw new Error(`filterMarqueeSelectionByHierarchy: node ${id} is not present`);
    }
    collectSelectedAncestors(document, selected, ancestorsWithSelectedDescendant, node.parentIndex?.guid);
  }
  return itemIds.filter((id) => !ancestorsWithSelectedDescendant.has(id));
}

/** Collect GUID keys from explicit Kiwi source documents used by SymbolResolver. */
export function collectExplicitKiwiSourceDocumentGuidKeys(
  sourceDocuments: readonly ExplicitKiwiSourceDocumentGuidSource[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const sourceDocument of sourceDocuments) {
    for (const node of sourceDocument.nodeChanges) {
      if (node.guid === undefined) {
        continue;
      }
      keys.add(guidToString(node.guid));
    }
  }
  return keys;
}

/**
 * Keep renderer-derived bounds that are editable in the primary Kiwi
 * document. Bounds owned by explicit source documents remain render
 * input only; an unknown id indicates a broken resolver/render pipeline.
 */
export function filterRenderedNodeBoundsToPrimaryKiwiDocument<T extends RenderedNodeBoundsWithId>({
  document,
  explicitSourceGuidKeys,
  bounds,
  owner,
}: {
  readonly document: FigKiwiDocumentIndex;
  readonly explicitSourceGuidKeys: ReadonlySet<string>;
  readonly bounds: readonly T[];
  readonly owner: string;
}): readonly T[] {
  const primaryBounds: T[] = [];
  for (const item of bounds) {
    if (document.nodesByGuid.has(item.id)) {
      primaryBounds.push(item);
      continue;
    }
    if (explicitSourceGuidKeys.has(item.id)) {
      continue;
    }
    throw new Error(`${owner}: rendered node ${item.id} is not present in the primary Kiwi document or explicit Kiwi source documents`);
  }
  return primaryBounds;
}
