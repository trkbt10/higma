/**
 * @file Shared reducer helpers
 *
 * Utility functions used by multiple handler files.
 */

import type { FigDesignNode, FigNodeId, FigPageId, FigDesignDocument, FigPage } from "@higma-document-models/fig/domain";
import type { FigMatrix } from "@higma-document-models/fig/types";
import type { SimpleBounds } from "@higma-editor-kernel/core/geometry";
import { findNodeById as findInTree } from "@higma-document-io/fig/node-ops";
import { dfsByIdWithContext } from "@higma-primitives/tree";
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
  const found = dfsByIdWithContext(nodes, targetId, {
    getId: (node) => node.id,
    getChildren: (node) => node.children ?? [],
    initialContext: parentTransform,
    deriveContext: (node, context) => composeTransforms(context, node.transform),
  });
  if (!found) {
    return undefined;
  }
  const { x, y } = computePreRotationTopLeft(found.context, found.node.size.x, found.node.size.y);
  return {
    x,
    y,
    width: found.node.size.x,
    height: found.node.size.y,
    rotation: extractRotationDeg(found.context),
  };
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
