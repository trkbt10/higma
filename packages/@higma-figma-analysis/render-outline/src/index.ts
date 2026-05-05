/**
 * @file Product-free render outline extraction for decoded fig-family nodes.
 */

export type FigmaRenderOutlineRoleDefinition<Role extends string = string> = {
  readonly nodeType: string;
  readonly role: Role;
};

export type FigmaRenderOutlineEntry<Role extends string = string> = {
  readonly id: string;
  readonly type: string;
  readonly role: Role;
  readonly name: string | null;
  readonly parentId: string | null;
  readonly childIds: readonly string[];
  readonly depth: number;
  readonly order: number;
};

export type FigmaRenderOutline<Role extends string = string> = {
  readonly entries: readonly FigmaRenderOutlineEntry<Role>[];
  readonly roles: readonly FigmaRenderOutlineRoleDefinition<Role>[];
};

type RawGuid = {
  readonly sessionID: number;
  readonly localID: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return null;
}

function readNodeType(node: Record<string, unknown>): string {
  const direct = node.type;
  if (typeof direct === "string") {
    return direct;
  }
  const directRecord = asRecord(direct);
  if (directRecord && typeof directRecord.name === "string") {
    return directRecord.name;
  }
  return "UNKNOWN";
}

function readName(node: Record<string, unknown>): string | null {
  if (typeof node.name === "string") {
    return node.name;
  }
  return null;
}

function readGuid(value: unknown): RawGuid | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  if (typeof record.sessionID !== "number" || typeof record.localID !== "number") {
    return null;
  }
  return {
    sessionID: record.sessionID,
    localID: record.localID,
  };
}

function guidToString(guid: RawGuid): string {
  return `${guid.sessionID}:${guid.localID}`;
}

function readNodeGuid(node: Record<string, unknown>): string | null {
  const guid = readGuid(node.guid);
  if (!guid) {
    return null;
  }
  return guidToString(guid);
}

function readParentGuid(node: Record<string, unknown>): string | null {
  const parentIndex = asRecord(node.parentIndex);
  if (!parentIndex) {
    return null;
  }
  const guid = readGuid(parentIndex.guid);
  if (!guid) {
    throw new Error("Invalid fig-family render outline parentIndex guid");
  }
  return guidToString(guid);
}

function rolesByNodeType<Role extends string>(
  roles: readonly FigmaRenderOutlineRoleDefinition<Role>[],
): ReadonlyMap<string, Role> {
  const map = new Map<string, Role>();
  for (const role of roles) {
    map.set(role.nodeType, role.role);
  }
  return map;
}

function collectNodeIds(nodeChanges: readonly unknown[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const nodeChange of nodeChanges) {
    const node = asRecord(nodeChange);
    if (!node) {
      continue;
    }
    const id = readNodeGuid(node);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function collectChildIds(nodeChanges: readonly unknown[]): ReadonlyMap<string, readonly string[]> {
  const children = new Map<string, string[]>();
  for (const nodeChange of nodeChanges) {
    const node = asRecord(nodeChange);
    if (!node) {
      continue;
    }
    const id = readNodeGuid(node);
    const parentId = readParentGuid(node);
    if (!id || !parentId) {
      continue;
    }
    const existing = children.get(parentId);
    if (existing) {
      existing.push(id);
      continue;
    }
    children.set(parentId, [id]);
  }
  return children;
}

function collectParentIds(
  nodeChanges: readonly unknown[],
  nodeIds: ReadonlySet<string>,
): ReadonlyMap<string, string | null> {
  const parents = new Map<string, string | null>();
  for (const nodeChange of nodeChanges) {
    const node = asRecord(nodeChange);
    if (!node) {
      continue;
    }
    const id = readNodeGuid(node);
    if (!id) {
      continue;
    }
    const parentId = readParentGuid(node);
    if (parentId && !nodeIds.has(parentId)) {
      throw new Error(`Invalid fig-family render outline parent guid ${parentId}`);
    }
    parents.set(id, parentId);
  }
  return parents;
}

function computeDepth(
  id: string,
  parents: ReadonlyMap<string, string | null>,
  visited: ReadonlySet<string> = new Set(),
): number {
  if (visited.has(id)) {
    throw new Error(`Invalid fig-family render outline parent cycle at ${id}`);
  }
  const parentId = parents.get(id);
  if (!parentId) {
    return 0;
  }
  return computeDepth(parentId, parents, new Set([...visited, id])) + 1;
}

function createEntry<Role extends string>(
  node: Record<string, unknown>,
  role: Role,
  order: number,
  childIds: ReadonlyMap<string, readonly string[]>,
  parents: ReadonlyMap<string, string | null>,
): FigmaRenderOutlineEntry<Role> {
  const id = readNodeGuid(node);
  if (!id) {
    throw new Error(`Selected fig-family render outline node ${readNodeType(node)} is missing guid`);
  }
  return {
    id,
    type: readNodeType(node),
    role,
    name: readName(node),
    parentId: parents.get(id) ?? null,
    childIds: childIds.get(id) ?? [],
    depth: computeDepth(id, parents),
    order,
  };
}

/**
 * Create a product-free render outline from decoded fig-family node changes.
 *
 * Role definitions are the only selection mechanism; this package does not
 * infer product semantics or silently invent renderable node types.
 */
export function createFigmaRenderOutline<Role extends string>(
  nodeChanges: readonly unknown[],
  roles: readonly FigmaRenderOutlineRoleDefinition<Role>[],
): FigmaRenderOutline<Role> {
  const roleMap = rolesByNodeType(roles);
  const nodeIds = collectNodeIds(nodeChanges);
  const childIds = collectChildIds(nodeChanges);
  const parentIds = collectParentIds(nodeChanges, nodeIds);
  const entries: FigmaRenderOutlineEntry<Role>[] = [];

  nodeChanges.forEach((nodeChange, order) => {
    const node = asRecord(nodeChange);
    if (!node) {
      return;
    }
    const role = roleMap.get(readNodeType(node));
    if (!role) {
      return;
    }
    entries.push(createEntry(node, role, order, childIds, parentIds));
  });

  return {
    entries,
    roles,
  };
}
