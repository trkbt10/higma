/** @file Bounds calculation over Kiwi FigNode values. */
import type { FigKiwiDocumentIndex } from "@higma-document-models/fig/domain";
import { guidToString } from "@higma-document-models/fig/domain";
import { IDENTITY_MATRIX, multiplyMatrices, readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigGuid, FigMatrix, FigNode } from "@higma-document-models/fig/types";
import { computePreRotationTopLeft, extractRotationDeg } from "../../context/fig-editor/rotation";

export type NodeBounds = {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
};

export type BoundsLike = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type PointLike = {
  readonly x: number;
  readonly y: number;
};

function requireGuid(node: FigNode): FigGuid {
  if (node.guid === undefined) {
    throw new Error(`Kiwi node "${node.name ?? "(unnamed)"}" is missing guid`);
  }
  return node.guid;
}

function requireSize(node: FigNode): NonNullable<FigNode["size"]> {
  if (node.size === undefined) {
    throw new Error(`Kiwi node ${guidToString(requireGuid(node))} is missing size`);
  }
  return node.size;
}

function boundsForNode(node: FigNode, absoluteTransform: FigMatrix): NodeBounds {
  const size = requireSize(node);
  const topLeft = computePreRotationTopLeft(absoluteTransform, size.x, size.y);
  return {
    id: guidToString(requireGuid(node)),
    x: topLeft.x,
    y: topLeft.y,
    width: size.x,
    height: size.y,
    rotation: extractRotationDeg(absoluteTransform),
  };
}

/** Return whether a point is inside or on the edge of an axis-aligned bounds. */
export function containsPointInBounds(bounds: BoundsLike, point: PointLike): boolean {
  return point.x >= bounds.x
    && point.y >= bounds.y
    && point.x <= bounds.x + bounds.width
    && point.y <= bounds.y + bounds.height;
}

/** Return the topmost/deepest bounds containing a point, optionally filtered. */
export function findDeepestBoundsAtPoint<T extends BoundsLike>(
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

/** Recursively flatten Kiwi nodes into page-coordinate editor bounds. */
export function flattenAllNodeBounds(
  document: FigKiwiDocumentIndex,
  nodes: readonly FigNode[],
): readonly NodeBounds[] {
  const out: NodeBounds[] = [];
  flattenRecursive(document, nodes, IDENTITY_MATRIX, out);
  return out;
}

function flattenRecursive(
  document: FigKiwiDocumentIndex,
  nodes: readonly FigNode[],
  parentTransform: FigMatrix,
  out: NodeBounds[],
): void {
  for (const node of nodes) {
    if (node.visible === false) {
      continue;
    }
    const transform = multiplyMatrices(parentTransform, readKiwiTransform(node.transform));
    out.push(boundsForNode(node, transform));
    flattenRecursive(document, document.childrenOf(node), transform, out);
  }
}

/** Compute the absolute transform for a Kiwi node. */
export function computeAbsoluteTransform(
  document: FigKiwiDocumentIndex,
  target: FigGuid,
  roots: readonly FigNode[],
): FigMatrix | undefined {
  return computeAbsoluteTransformInner(document, roots, target, IDENTITY_MATRIX);
}

function computeAbsoluteTransformInner(
  document: FigKiwiDocumentIndex,
  nodes: readonly FigNode[],
  target: FigGuid,
  parentTransform: FigMatrix,
): FigMatrix | undefined {
  for (const node of nodes) {
    const transform = multiplyMatrices(parentTransform, readKiwiTransform(node.transform));
    if (guidToString(requireGuid(node)) === guidToString(target)) {
      return transform;
    }
    const childResult = computeAbsoluteTransformInner(document, document.childrenOf(node), target, transform);
    if (childResult !== undefined) {
      return childResult;
    }
  }
  return undefined;
}

/** Compute absolute bounds for a Kiwi node. */
export function computeAbsoluteNodeBounds(
  document: FigKiwiDocumentIndex,
  target: FigGuid,
  roots: readonly FigNode[],
): NodeBounds | undefined {
  const transform = computeAbsoluteTransform(document, target, roots);
  if (transform === undefined) {
    return undefined;
  }
  const node = document.nodesByGuid.get(guidToString(target));
  if (node === undefined) {
    return undefined;
  }
  return boundsForNode(node, transform);
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
