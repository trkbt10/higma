/** @file Selected Kiwi node drag projection for renderer-derived bounds. */
import { translateSceneGraphNodeBounds } from "@higma-document-renderers/fig/scene-graph";
import { guidToString } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";

export type FigEditorSelectedNodeDragBounds = {
  readonly id: string;
  readonly rootId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly aabb: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
};

export type FigEditorSelectedNodeDragBoundsTranslation = {
  readonly draggedGuidKey: string;
  readonly dx: number;
  readonly dy: number;
};

type FigEditorSelectedNodeDragMembershipCache = {
  readonly resolved: Map<string, boolean>;
  readonly resolving: Set<string>;
};

function createFigEditorSelectedNodeDragMembershipCache(
  draggedGuidKey: string,
): FigEditorSelectedNodeDragMembershipCache {
  return {
    resolved: new Map([[draggedGuidKey, true]]),
    resolving: new Set(),
  };
}

function figEditorSelectedNodeDragMovesGuidKey(
  nodesByGuid: ReadonlyMap<string, FigNode>,
  nodeKey: string,
  draggedGuidKey: string,
  cache: FigEditorSelectedNodeDragMembershipCache,
): boolean {
  const cached = cache.resolved.get(nodeKey);
  if (cached !== undefined) {
    return cached;
  }
  if (cache.resolving.has(nodeKey)) {
    throw new Error(`Fig editor selected node drag bounds found a Kiwi parent cycle at ${nodeKey}`);
  }
  const node = nodesByGuid.get(nodeKey);
  const parentGuid = node?.parentIndex?.guid;
  if (parentGuid === undefined) {
    cache.resolved.set(nodeKey, false);
    return false;
  }
  cache.resolving.add(nodeKey);
  const parentKey = guidToString(parentGuid);
  try {
    const result = figEditorSelectedNodeDragMovesGuidKey(
      nodesByGuid,
      parentKey,
      draggedGuidKey,
      cache,
    );
    cache.resolved.set(nodeKey, result);
    return result;
  } finally {
    cache.resolving.delete(nodeKey);
  }
}

/** Return whether one renderer-derived bounds belongs to the dragged Kiwi node subtree. */
export function figEditorSelectedNodeDragMovesBounds(
  nodesByGuid: ReadonlyMap<string, FigNode>,
  bounds: FigEditorSelectedNodeDragBounds,
  draggedGuidKey: string,
): boolean {
  return figEditorSelectedNodeDragMovesGuidKey(
    nodesByGuid,
    bounds.id,
    draggedGuidKey,
    createFigEditorSelectedNodeDragMembershipCache(draggedGuidKey),
  );
}

/** Translate one renderer-derived bounds when it belongs to the dragged Kiwi node subtree. */
export function translateFigEditorSelectedNodeDragBounds(
  nodesByGuid: ReadonlyMap<string, FigNode>,
  bounds: FigEditorSelectedNodeDragBounds,
  translation: FigEditorSelectedNodeDragBoundsTranslation,
): FigEditorSelectedNodeDragBounds {
  if (!figEditorSelectedNodeDragMovesGuidKey(
    nodesByGuid,
    bounds.id,
    translation.draggedGuidKey,
    createFigEditorSelectedNodeDragMembershipCache(translation.draggedGuidKey),
  )) {
    return bounds;
  }
  return translateSceneGraphNodeBounds(bounds, translation.dx, translation.dy);
}

/** Project a renderer-derived bounds list through one active selected Kiwi node drag. */
export function translateFigEditorSelectedNodeDragBoundsList(
  nodesByGuid: ReadonlyMap<string, FigNode>,
  bounds: readonly FigEditorSelectedNodeDragBounds[],
  translation: FigEditorSelectedNodeDragBoundsTranslation | undefined,
): readonly FigEditorSelectedNodeDragBounds[] {
  if (translation === undefined) {
    return bounds;
  }
  const cache = createFigEditorSelectedNodeDragMembershipCache(translation.draggedGuidKey);
  return bounds.map((candidate) => {
    if (!figEditorSelectedNodeDragMovesGuidKey(nodesByGuid, candidate.id, translation.draggedGuidKey, cache)) {
      return candidate;
    }
    return translateSceneGraphNodeBounds(candidate, translation.dx, translation.dy);
  });
}
