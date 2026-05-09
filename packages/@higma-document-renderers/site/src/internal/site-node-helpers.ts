/**
 * @file Internal helpers shared by edits.ts and index.ts for reading and
 * composing fig-canvas node transforms while resolving site render units.
 */

export type SiteAffineMatrix = {
  readonly m00: number;
  readonly m01: number;
  readonly m02: number;
  readonly m10: number;
  readonly m11: number;
  readonly m12: number;
};

export const IDENTITY_MATRIX: SiteAffineMatrix = {
  m00: 1,
  m01: 0,
  m02: 0,
  m10: 0,
  m11: 1,
  m12: 0,
};

export function asRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  throw new Error(`Expected ${fieldName} to be an object`);
}

export function asOptionalRecord(value: unknown, fieldName: string): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  return asRecord(value, fieldName);
}

export function readNumber(value: unknown, fieldName: string): number {
  if (typeof value === "number") {
    return value;
  }
  throw new Error(`Expected ${fieldName} to be a number`);
}

export function readString(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected ${fieldName} to be a string`);
}

export function readEnumName(value: unknown, fieldName: string): string {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value, fieldName);
  return readString(record.name, `${fieldName}.name`);
}

export function readGuidString(node: Record<string, unknown>): string | null {
  const guid = asOptionalRecord(node.guid, "node.guid");
  if (!guid) {
    return null;
  }
  return `${readNumber(guid.sessionID, "node.guid.sessionID")}:${readNumber(guid.localID, "node.guid.localID")}`;
}

export function readParentGuidString(node: Record<string, unknown>): string | null {
  const parentIndex = asOptionalRecord(node.parentIndex, "node.parentIndex");
  if (!parentIndex) {
    return null;
  }
  const guid = asRecord(parentIndex.guid, "node.parentIndex.guid");
  return `${readNumber(guid.sessionID, "node.parentIndex.guid.sessionID")}:${readNumber(guid.localID, "node.parentIndex.guid.localID")}`;
}

export function readNodeTransform(node: Record<string, unknown>, nodeId: string): SiteAffineMatrix {
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

export function nodeLocalMatrix(node: Record<string, unknown>, nodeId: string): SiteAffineMatrix {
  if (node.transform) {
    return readNodeTransform(node, nodeId);
  }
  if (!readParentGuidString(node)) {
    return IDENTITY_MATRIX;
  }
  throw new Error(`Site node transform required for non-root node ${nodeId}`);
}

export function multiplyMatrix(parent: SiteAffineMatrix, child: SiteAffineMatrix): SiteAffineMatrix {
  return {
    m00: parent.m00 * child.m00 + parent.m01 * child.m10,
    m01: parent.m00 * child.m01 + parent.m01 * child.m11,
    m02: parent.m00 * child.m02 + parent.m01 * child.m12 + parent.m02,
    m10: parent.m10 * child.m00 + parent.m11 * child.m10,
    m11: parent.m10 * child.m01 + parent.m11 * child.m11,
    m12: parent.m10 * child.m02 + parent.m11 * child.m12 + parent.m12,
  };
}

export function buildNodeMatrix(
  nodeId: string,
  nodesById: ReadonlyMap<string, Record<string, unknown>>,
  visited: ReadonlySet<string> = new Set(),
): SiteAffineMatrix {
  if (visited.has(nodeId)) {
    throw new Error(`Site node transform parent cycle at ${nodeId}`);
  }
  const node = nodesById.get(nodeId);
  if (!node) {
    throw new Error(`Site node transform could not find node ${nodeId}`);
  }
  const parentId = readParentGuidString(node);
  const local = nodeLocalMatrix(node, nodeId);
  if (!parentId) {
    return local;
  }
  return multiplyMatrix(buildNodeMatrix(parentId, nodesById, new Set([...visited, nodeId])), local);
}
