/**
 * @file Shared reducer helpers
 *
 * Utility functions used by multiple handler files.
 */

import type { FigDesignNode, FigNodeId, FigPageId, FigDesignDocument, FigPage } from "@higma/fig/domain";
import type { FigMatrix } from "@higma/fig/types";
import type { SimpleBounds } from "@higma/editor-core/geometry";
import { findNodeById as findInTree } from "@higma/fig-builder/node-ops";
import { extractRotationDeg, computePreRotationTopLeft } from "./rotation";
import { IDENTITY_MATRIX, composeTransforms } from "./matrix";

/**
 * Get local bounds from a FigDesignNode (position from transform, size from node).
 *
 * Uses the rotation SoT to derive pre-rotation top-left position.
 */
export function getNodeBounds(node: FigDesignNode): SimpleBounds & { readonly rotation: number } {
  const { x, y } = computePreRotationTopLeft(node.transform, node.size.x, node.size.y);
  return {
    x,
    y,
    width: node.size.x,
    height: node.size.y,
    rotation: extractRotationDeg(node.transform),
  };
}

/**
 * Compute absolute (page-space) bounds for a node at any depth in the tree.
 *
 * Walks the tree composing ancestor transforms to derive the node's absolute
 * position, which is what EditorCanvas uses for hit areas and selection boxes.
 *
 * This is critical for drag/resize/rotate preview calculations: the
 * initialBounds stored in DragState must match the coordinate space of the
 * itemBounds passed to EditorCanvas (absolute page coordinates). Otherwise,
 * applyDragPreview produces incorrect positions during drag.
 */
export function getAbsoluteNodeBounds(
  pageChildren: readonly FigDesignNode[],
  nodeId: FigNodeId,
): (SimpleBounds & { readonly rotation: number }) | undefined {
  return findAbsoluteBounds(pageChildren, nodeId, IDENTITY_MATRIX);
}

function findAbsoluteBounds(
  nodes: readonly FigDesignNode[],
  targetId: FigNodeId,
  parentTransform: FigMatrix,
): (SimpleBounds & { readonly rotation: number }) | undefined {
  /* eslint-disable custom/no-inline-dfs-by-id -- path-accumulating walk:
   composes ancestor transforms along the path to produce absolute bounds
   for the found node. `dfsById` returns only the node, not the composed
   transform chain, so this cannot be expressed as a plain lookup. */
  for (const node of nodes) {
    const absTransform = composeTransforms(parentTransform, node.transform);
    if (node.id === targetId) {
      const { x, y } = computePreRotationTopLeft(absTransform, node.size.x, node.size.y);
      return {
        x,
        y,
        width: node.size.x,
        height: node.size.y,
        rotation: extractRotationDeg(absTransform),
      };
    }
    if (node.children) {
      const found = findAbsoluteBounds(node.children, targetId, absTransform);
      if (found) {
        return found;
      }
    }
  }
  /* eslint-enable custom/no-inline-dfs-by-id -- Node geometry lookup is the local SoT for reducer bounds updates. */
  return undefined;
}

/**
 * Find the active page from the document.
 */
export function getActivePage(
  doc: FigDesignDocument,
  activePageId: FigPageId | undefined,
): FigPage | undefined {
  if (!activePageId) {
    return undefined;
  }
  return doc.pages.find((p) => p.id === activePageId);
}

/**
 * Find nodes by IDs within a page.
 */
export function findNodesByIds(
  page: FigPage,
  ids: readonly FigNodeId[],
): readonly FigDesignNode[] {
  const result: FigDesignNode[] = [];
  for (const id of ids) {
    const node = findInTree(page.children, id);
    if (node) {
      result.push(node);
    }
  }
  return result;
}
