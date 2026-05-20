/**
 * @file Pre-compute world-space axis-aligned bounding boxes for every
 * node on a fig page.
 *
 * The viewer needs node bounds for two things:
 *   - hover/click hit-testing in `hit-test.ts`
 *   - rendering selection / hover rectangles over the canvas
 *
 * The fig domain stores each node's `transform` *relative to its
 * parent*. To get a world-space AABB we walk the page once, compose
 * matrices down the tree, and transform the node's four local corners
 * before unioning min/max. The result is a flat list in painter order
 * (DFS pre-order) so that `findNodeAtPoint` can scan from the end and
 * return the topmost match without re-traversing.
 *
 * Clipping (`clipsContent` on FRAME / SECTION) is intentionally not
 * applied here. The renderer clips paint visually, but the inspect
 * tool still needs to surface overflow children — Figma's Dev Mode
 * does the same, treating clipping as a paint concern, not a hit
 * concern.
 */

import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import { IDENTITY_MATRIX, multiplyMatrices, readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigMatrix, FigNode, FigNodeType, FigVector } from "@higma-document-models/fig/types";

export type NodeBounds = {
  readonly id: string;
  readonly name: string;
  readonly type: FigNodeType;
  /** World-space (page-coord) AABB. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Local-space size (pre-transform) — useful for the inspect panel. */
  readonly localWidth: number;
  readonly localHeight: number;
  /** Composed parent-chain transform that produced `x/y/width/height`. */
  readonly worldTransform: FigMatrix;
  /** 0 for top-level children of the page. */
  readonly depth: number;
  /** `null` when the node is a top-level child of the page. */
  readonly parentId: string | null;
  /** Paint-order index (matches the order entries appear in the returned array). */
  readonly paintOrder: number;
  readonly visible: boolean;
};

function transformPoint(m: FigMatrix, x: number, y: number): { readonly x: number; readonly y: number } {
  return {
    x: m.m00 * x + m.m01 * y + m.m02,
    y: m.m10 * x + m.m11 * y + m.m12,
  };
}

function aabbOfTransformedRect(m: FigMatrix, w: number, h: number): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  const corners = [
    transformPoint(m, 0, 0),
    transformPoint(m, w, 0),
    transformPoint(m, w, h),
    transformPoint(m, 0, h),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

type WalkContext = {
  readonly results: NodeBounds[];
  readonly parentVisible: boolean;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
};

function requireSize(node: FigNode): FigVector {
  if (node.size === undefined) {
    throw new Error(`VSC fig viewer bounds require size for Kiwi node ${guidToString(node.guid)}`);
  }
  return node.size;
}

function walkNode(
  node: FigNode,
  parentTransform: FigMatrix,
  parentId: string | null,
  depth: number,
  ctx: WalkContext,
): void {
  const size = requireSize(node);
  const id = guidToString(node.guid);
  const worldTransform = multiplyMatrices(parentTransform, readKiwiTransform(node.transform));
  const aabb = aabbOfTransformedRect(worldTransform, size.x, size.y);
  const visible = ctx.parentVisible && node.visible !== false;
  ctx.results.push({
    id,
    name: node.name ?? getNodeType(node),
    type: getNodeType(node),
    x: aabb.x,
    y: aabb.y,
    width: aabb.width,
    height: aabb.height,
    localWidth: size.x,
    localHeight: size.y,
    worldTransform,
    depth,
    parentId,
    paintOrder: ctx.results.length,
    visible,
  });

  const children = ctx.childrenOf(node);
  if (children.length === 0) {
    return;
  }
  const childCtx: WalkContext = { results: ctx.results, parentVisible: visible, childrenOf: ctx.childrenOf };
  for (const child of children) {
    walkNode(child, worldTransform, id, depth + 1, childCtx);
  }
}

/**
 * Returns world-space bounds for every node on the page, in painter
 * order (DFS pre-order).
 */
export function computeNodeBounds(
  page: FigNode,
  childrenOf: (node: FigNode) => readonly FigNode[],
): readonly NodeBounds[] {
  const results: NodeBounds[] = [];
  const ctx: WalkContext = { results, parentVisible: true, childrenOf };
  for (const child of childrenOf(page)) {
    walkNode(child, IDENTITY_MATRIX, null, 0, ctx);
  }
  return results;
}

/**
 * O(1) lookup table from Kiwi GUID string to its `NodeBounds` entry.
 *
 * The viewer hits this on every hover frame and every selection
 * change, so the per-page Map pays for itself within a few mouse
 * moves.
 */
export function indexBoundsById(bounds: readonly NodeBounds[]): ReadonlyMap<string, NodeBounds> {
  const map = new Map<string, NodeBounds>();
  for (const entry of bounds) {
    map.set(entry.id, entry);
  }
  return map;
}
