/** @file Inspector tree projection from Kiwi FigNode values. */

import type { InspectorTreeNode } from "@higma-editor-kernel/core/inspector-types";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import type { FigNode } from "@higma-document-models/fig/types";

export type FigInspectorProjectionOptions = {
  readonly root: FigNode;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  readonly showHiddenNodes: boolean;
};

function requireGuid(node: FigNode): string {
  if (node.guid === undefined) {
    throw new Error(`fig inspector projection requires guid for "${node.name ?? "(unnamed)"}"`);
  }
  return guidToString(node.guid);
}

function requireSize(node: FigNode): NonNullable<FigNode["size"]> {
  if (node.size === undefined) {
    throw new Error(`fig inspector projection requires size for "${node.name ?? "(unnamed)"}"`);
  }
  return node.size;
}

/** Convert a Kiwi node subtree to the inspector tree node shape. */
export function figNodeToInspectorTree({
  root,
  childrenOf,
  showHiddenNodes,
}: FigInspectorProjectionOptions): InspectorTreeNode {
  const size = requireSize(root);
  return {
    id: requireGuid(root),
    name: root.name ?? getNodeType(root),
    nodeType: getNodeType(root),
    width: size.x,
    height: size.y,
    opacity: root.opacity ?? 1,
    visible: root.visible !== false,
    children: childrenOf(root)
      .filter((child) => showHiddenNodes || child.visible !== false)
      .map((child) => figNodeToInspectorTree({ root: child, childrenOf, showHiddenNodes })),
  };
}
