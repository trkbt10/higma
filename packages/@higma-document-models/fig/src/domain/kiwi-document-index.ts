/**
 * @file Index over a Kiwi Fig document's nodeChanges array.
 */
import type { FigGuid, FigNode } from "../types";
import { guidToString } from "./fig-guid";
import { getNodeType } from "./kiwi-node";

const EMPTY_CHILDREN: readonly FigNode[] = [];

export type FigKiwiDocumentIndex = {
  readonly nodeChanges: readonly FigNode[];
  readonly roots: readonly FigNode[];
  readonly nodesByGuid: ReadonlyMap<string, FigNode>;
  readonly childrenByParent: ReadonlyMap<string, readonly FigNode[]>;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
};

function nodeGuidKey(node: FigNode): string | undefined {
  const guid = node.guid;
  if (guid === undefined) { return undefined; }
  return guidToString(guid);
}

function parentGuid(node: FigNode): FigGuid | undefined {
  return node.parentIndex?.guid;
}

function parentPosition(node: FigNode): string {
  return node.parentIndex?.position ?? "";
}

/**
 * Build lookup tables over the Kiwi `nodeChanges` SoT without materialising a second structure.
 */
export function indexFigKiwiDocument(nodeChanges: readonly FigNode[]): FigKiwiDocumentIndex {
  const nodesByGuid = new Map<string, FigNode>();
  for (const node of nodeChanges) {
    const key = nodeGuidKey(node);
    if (key !== undefined) {
      nodesByGuid.set(key, node);
    }
  }

  const mutableChildrenByParent = new Map<string, FigNode[]>();
  for (const node of nodeChanges) {
    const parent = parentGuid(node);
    if (parent === undefined) { continue; }
    const parentKey = guidToString(parent);
    const bucket = mutableChildrenByParent.get(parentKey);
    if (bucket === undefined) {
      mutableChildrenByParent.set(parentKey, [node]);
    } else {
      bucket.push(node);
    }
  }

  const childrenByParent = new Map<string, readonly FigNode[]>();
  for (const [parentKey, siblings] of mutableChildrenByParent) {
    siblings.sort((a, b) => {
      const pa = parentPosition(a);
      const pb = parentPosition(b);
      if (pa < pb) { return -1; }
      if (pa > pb) { return 1; }
      return 0;
    });
    childrenByParent.set(parentKey, siblings);
  }

  const roots: FigNode[] = [];
  for (const node of nodeChanges) {
    const parent = parentGuid(node);
    if (parent === undefined || !nodesByGuid.has(guidToString(parent))) {
      roots.push(node);
    }
  }

  const childrenOf = (node: FigNode): readonly FigNode[] => {
    const key = nodeGuidKey(node);
    if (key === undefined) { return EMPTY_CHILDREN; }
    return childrenByParent.get(key) ?? EMPTY_CHILDREN;
  };

  return { nodeChanges, roots, nodesByGuid, childrenByParent, childrenOf };
}

/**
 * Find every node whose Kiwi enum type name matches `nodeType`.
 */
export function findNodesByType(
  document: FigKiwiDocumentIndex,
  nodeType: string,
): FigNode[] {
  const result: FigNode[] = [];
  visitKiwiNodes(document.roots, document.childrenOf, (node) => {
    if (getNodeType(node) === nodeType) { result.push(node); }
  });
  return result;
}

function visitKiwiNodes(
  nodes: readonly FigNode[],
  childrenOf: (node: FigNode) => readonly FigNode[],
  visit: (node: FigNode) => void,
): void {
  for (const node of nodes) {
    visit(node);
    visitKiwiNodes(childrenOf(node), childrenOf, visit);
  }
}

/**
 * Find a node by its Kiwi GUID tuple.
 */
export function findNodeByGuid(
  document: FigKiwiDocumentIndex,
  guid: FigGuid,
): FigNode | undefined {
  return document.nodesByGuid.get(guidToString(guid));
}
