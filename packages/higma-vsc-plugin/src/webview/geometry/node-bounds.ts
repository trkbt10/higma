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

import type {
  FigDesignNode,
  FigNodeId,
  FigPage,
} from "@higma-document-models/fig/domain";
import type { FigMatrix } from "@higma-document-models/fig/types";

export type NodeBounds = {
  readonly id: FigNodeId;
  readonly name: string;
  readonly type: FigDesignNode["type"];
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
  readonly parentId: FigNodeId | null;
  /** Paint-order index (matches the order entries appear in the returned array). */
  readonly paintOrder: number;
  readonly visible: boolean;
};

const IDENTITY: FigMatrix = { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };

function multiply(a: FigMatrix, b: FigMatrix): FigMatrix {
  return {
    m00: a.m00 * b.m00 + a.m01 * b.m10,
    m01: a.m00 * b.m01 + a.m01 * b.m11,
    m02: a.m00 * b.m02 + a.m01 * b.m12 + a.m02,
    m10: a.m10 * b.m00 + a.m11 * b.m10,
    m11: a.m10 * b.m01 + a.m11 * b.m11,
    m12: a.m10 * b.m02 + a.m11 * b.m12 + a.m12,
  };
}

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
};

function walkNode(
  node: FigDesignNode,
  parentTransform: FigMatrix,
  parentId: FigNodeId | null,
  depth: number,
  ctx: WalkContext,
): void {
  const worldTransform = multiply(parentTransform, node.transform);
  const aabb = aabbOfTransformedRect(worldTransform, node.size.x, node.size.y);
  const visible = ctx.parentVisible && node.visible;
  ctx.results.push({
    id: node.id,
    name: node.name,
    type: node.type,
    x: aabb.x,
    y: aabb.y,
    width: aabb.width,
    height: aabb.height,
    localWidth: node.size.x,
    localHeight: node.size.y,
    worldTransform,
    depth,
    parentId,
    paintOrder: ctx.results.length,
    visible,
  });

  const children = node.children;
  if (!children || children.length === 0) {
    return;
  }
  const childCtx: WalkContext = { results: ctx.results, parentVisible: visible };
  for (const child of children) {
    walkNode(child, worldTransform, node.id, depth + 1, childCtx);
  }
}

/**
 * Returns world-space bounds for every node on the page, in painter
 * order (DFS pre-order).
 */
export function computeNodeBounds(page: FigPage): readonly NodeBounds[] {
  const results: NodeBounds[] = [];
  const ctx: WalkContext = { results, parentVisible: true };
  for (const child of page.children) {
    walkNode(child, IDENTITY, null, 0, ctx);
  }
  return results;
}

/**
 * O(1) lookup table from `FigNodeId` to its `NodeBounds` entry.
 *
 * The viewer hits this on every hover frame and every selection
 * change, so the per-page Map pays for itself within a few mouse
 * moves.
 */
export function indexBoundsById(bounds: readonly NodeBounds[]): ReadonlyMap<FigNodeId, NodeBounds> {
  const map = new Map<FigNodeId, NodeBounds>();
  for (const entry of bounds) {
    map.set(entry.id, entry);
  }
  return map;
}
