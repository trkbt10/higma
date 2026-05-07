/**
 * @file Apply site render-unit move operations to fig-family canvas nodes.
 */

import type { SiteDocument } from "@higma-document-models/site";

export type SiteUnitMove = {
  readonly unitId: string;
  readonly deltaX: number;
  readonly deltaY: number;
};

type SiteAffineMatrix = {
  readonly m00: number;
  readonly m01: number;
  readonly m02: number;
  readonly m10: number;
  readonly m11: number;
  readonly m12: number;
};

const IDENTITY_MATRIX: SiteAffineMatrix = {
  m00: 1,
  m01: 0,
  m02: 0,
  m10: 0,
  m11: 1,
  m12: 0,
};

function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  throw new Error(`Expected ${fieldName} to be an object`);
}

function asOptionalRecord(value: unknown, fieldName: string): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  return asRecord(value, fieldName);
}

function readNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number") {
    return value;
  }
  throw new Error(`Expected ${fieldName} to be a number`);
}

function readGuidString(node: Record<string, unknown>): string | null {
  const guid = asOptionalRecord(node.guid, "node.guid");
  if (!guid) {
    return null;
  }
  return `${readNumber(guid.sessionID, "node.guid.sessionID")}:${readNumber(guid.localID, "node.guid.localID")}`;
}

function readParentGuidString(node: Record<string, unknown>): string | null {
  const parentIndex = asOptionalRecord(node.parentIndex, "node.parentIndex");
  if (!parentIndex) {
    return null;
  }
  const guid = asRecord(parentIndex.guid, "node.parentIndex.guid");
  return `${readNumber(guid.sessionID, "node.parentIndex.guid.sessionID")}:${readNumber(guid.localID, "node.parentIndex.guid.localID")}`;
}

function readNodeTransform(node: Record<string, unknown>, nodeId: string): SiteAffineMatrix {
  const transform = asRecord(node.transform, `node ${nodeId}.transform`);
  return {
    m00: readNumber(transform.m00, `node ${nodeId}.transform.m00`),
    m01: readNumber(transform.m01, `node ${nodeId}.transform.m01`),
    m02: readNumber(transform.m02, `node ${nodeId}.transform.m02`),
    m10: readNumber(transform.m10, `node ${nodeId}.transform.m10`),
    m11: readNumber(transform.m11, `node ${nodeId}.transform.m11`),
    m12: readNumber(transform.m12, `node ${nodeId}.transform.m12`),
  };
}

function nodeLocalMatrix(node: Record<string, unknown>, nodeId: string): SiteAffineMatrix {
  if (node.transform) {
    return readNodeTransform(node, nodeId);
  }
  if (!readParentGuidString(node)) {
    return IDENTITY_MATRIX;
  }
  throw new Error(`Site edit transform requires transform for non-root node ${nodeId}`);
}

function multiplyMatrix(parent: SiteAffineMatrix, child: SiteAffineMatrix): SiteAffineMatrix {
  return {
    m00: parent.m00 * child.m00 + parent.m01 * child.m10,
    m01: parent.m00 * child.m01 + parent.m01 * child.m11,
    m02: parent.m00 * child.m02 + parent.m01 * child.m12 + parent.m02,
    m10: parent.m10 * child.m00 + parent.m11 * child.m10,
    m11: parent.m10 * child.m01 + parent.m11 * child.m11,
    m12: parent.m10 * child.m02 + parent.m11 * child.m12 + parent.m12,
  };
}

function buildNodeMatrix(
  nodeId: string,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
  visited: ReadonlySet<string> = new Set(),
): SiteAffineMatrix {
  if (visited.has(nodeId)) {
    throw new Error(`Site edit transform parent cycle at ${nodeId}`);
  }
  const node = nodesById.get(nodeId);
  if (!node) {
    throw new Error(`Site edit transform could not find node ${nodeId}`);
  }
  const parentId = readParentGuidString(node);
  const local = nodeLocalMatrix(node, nodeId);
  if (!parentId) {
    return local;
  }
  return multiplyMatrix(buildNodeMatrix(parentId, nodesById, new Set([...visited, nodeId])), local);
}

function invertLinearDelta(
  matrix: SiteAffineMatrix,
  delta: { readonly x: number; readonly y: number },
  nodeId: string,
): { readonly x: number; readonly y: number } {
  const determinant = matrix.m00 * matrix.m11 - matrix.m01 * matrix.m10;
  if (determinant === 0) {
    throw new Error(`Site edit transform parent matrix is not invertible for ${nodeId}`);
  }
  return {
    x: (matrix.m11 * delta.x - matrix.m01 * delta.y) / determinant,
    y: (-matrix.m10 * delta.x + matrix.m00 * delta.y) / determinant,
  };
}

function createNodeById(nodeChanges: readonly unknown[]): ReadonlyMap<string, Record<string, unknown>> {
  return new Map(nodeChanges.flatMap((nodeChange) => {
    const node = asRecord(nodeChange, "nodeChange");
    const id = readGuidString(node);
    if (!id) {
      return [];
    }
    return [[id, node]];
  }));
}

function resolveMove(moves: readonly SiteUnitMove[], nodeId: string): SiteUnitMove | null {
  const move = moves.find((item) => item.unitId === nodeId);
  if (!move) {
    return null;
  }
  return move;
}

function readParentMatrix(
  node: Record<string, unknown>,
  nodeId: string,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
): SiteAffineMatrix {
  const parentId = readParentGuidString(node);
  if (!parentId) {
    return IDENTITY_MATRIX;
  }
  return buildNodeMatrix(parentId, nodesById);
}

function applyMoveToNode(
  node: Record<string, unknown>,
  nodeId: string,
  move: SiteUnitMove,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> {
  const transform = asRecord(node.transform, `node ${nodeId}.transform`);
  const localDelta = invertLinearDelta(
    readParentMatrix(node, nodeId, nodesById),
    { x: move.deltaX, y: move.deltaY },
    nodeId,
  );
  return {
    ...node,
    transform: {
      ...transform,
      m02: readNumber(transform.m02, `node ${nodeId}.transform.m02`) + localDelta.x,
      m12: readNumber(transform.m12, `node ${nodeId}.transform.m12`) + localDelta.y,
    },
  };
}

/** Apply direct site unit moves to raw fig-family node changes. */
export function applySiteUnitMovesToNodeChanges<NodeChange>(
  nodeChanges: readonly NodeChange[],
  moves: readonly SiteUnitMove[],
): readonly NodeChange[] {
  const nodesById = createNodeById(nodeChanges);
  return nodeChanges.map((nodeChange): NodeChange => {
    const node = asRecord(nodeChange, "nodeChange");
    const id = readGuidString(node);
    if (!id) {
      return nodeChange;
    }
    const move = resolveMove(moves, id);
    if (!move) {
      return nodeChange;
    }
    return applyMoveToNode(node, id, move, nodesById) as NodeChange;
  });
}

/** Create a draft site document whose canvas reflects direct unit moves. */
export function createSiteDocumentWithUnitMoves(
  document: SiteDocument,
  moves: readonly SiteUnitMove[],
): SiteDocument {
  return {
    ...document,
    canvas: {
      ...document.canvas,
      nodeChanges: applySiteUnitMovesToNodeChanges(document.canvas.nodeChanges, moves),
    },
  };
}
