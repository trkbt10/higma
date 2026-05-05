/**
 * @file Product-free decoded node summaries for fig-family documents.
 */

export type FigmaNodeSummary = {
  readonly totalNodes: number;
  readonly nodeTypes: ReadonlyMap<string, number>;
  readonly topLevelFields: ReadonlyMap<string, number>;
};

function getNodeType(node: Record<string, unknown>): string {
  const direct = node.type;
  if (typeof direct === "string") {
    return direct;
  }
  if (direct && typeof direct === "object") {
    const name = (direct as Record<string, unknown>).name;
    if (typeof name === "string") {
      return name;
    }
  }
  return "UNKNOWN";
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Summarise decoded `Message.nodeChanges` entries without product semantics. */
export function summarizeFigmaNodes(nodeChanges: readonly unknown[]): FigmaNodeSummary {
  const nodeTypes = new Map<string, number>();
  const topLevelFields = new Map<string, number>();

  for (const node of nodeChanges) {
    if (!node || typeof node !== "object") {
      continue;
    }
    const record = node as Record<string, unknown>;
    increment(nodeTypes, getNodeType(record));
    for (const field of Object.keys(record)) {
      increment(topLevelFields, field);
    }
  }

  return {
    totalNodes: nodeChanges.length,
    nodeTypes,
    topLevelFields,
  };
}
