/** @file Inspector projection from Kiwi FigNode values. */

import type { InspectorBoxInfo, InspectorTreeNode } from "@higma-editor-kernel/core/inspector-types";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import { IDENTITY_MATRIX, multiplyMatrices, readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigMatrix, FigNode } from "@higma-document-models/fig/types";

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

function toInspectorTransform(transform: FigMatrix): InspectorBoxInfo["transform"] {
  return [
    transform.m00,
    transform.m10,
    transform.m01,
    transform.m11,
    transform.m02,
    transform.m12,
  ];
}

function collectBoxesRecursive({
  node,
  childrenOf,
  showHiddenNodes,
  parentTransform,
  boxes,
}: {
  readonly node: FigNode;
  readonly childrenOf: (node: FigNode) => readonly FigNode[];
  readonly showHiddenNodes: boolean;
  readonly parentTransform: FigMatrix;
  readonly boxes: InspectorBoxInfo[];
}): void {
  if (node.visible === false && !showHiddenNodes) {
    return;
  }
  const transform = multiplyMatrices(parentTransform, readKiwiTransform(node.transform));
  const size = requireSize(node);
  boxes.push({
    nodeId: requireGuid(node),
    nodeType: getNodeType(node),
    nodeName: node.name ?? getNodeType(node),
    transform: toInspectorTransform(transform),
    width: size.x,
    height: size.y,
  });
  for (const child of childrenOf(node)) {
    collectBoxesRecursive({
      node: child,
      childrenOf,
      showHiddenNodes,
      parentTransform: transform,
      boxes,
    });
  }
}

/** Collect inspector boxes for a Kiwi node subtree. */
export function collectFigInspectorBoxes(options: FigInspectorProjectionOptions): readonly InspectorBoxInfo[] {
  const boxes: InspectorBoxInfo[] = [];
  collectBoxesRecursive({
    node: options.root,
    childrenOf: options.childrenOf,
    showHiddenNodes: options.showHiddenNodes,
    parentTransform: IDENTITY_MATRIX,
    boxes,
  });
  return boxes;
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
