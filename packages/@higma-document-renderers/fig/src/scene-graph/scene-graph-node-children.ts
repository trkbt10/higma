/** @file SceneGraph node child accessors. */

import type { FrameNode, GroupNode, SceneNode } from "./model";

export type SceneGraphNodeWithChildren = GroupNode | FrameNode;

/** Return whether a SceneGraph node owns an ordered child list. */
export function sceneGraphNodeOwnsChildren(node: SceneNode): node is SceneGraphNodeWithChildren {
  return node.type === "group" || node.type === "frame";
}

/** Read the ordered child list owned by a SceneGraph node. */
export function readSceneGraphNodeChildren(node: SceneNode): readonly SceneNode[] {
  if (!sceneGraphNodeOwnsChildren(node)) {
    return [];
  }
  return node.children;
}

/** Replace the ordered child list owned by a SceneGraph container node. */
export function replaceSceneGraphNodeChildren(
  node: SceneGraphNodeWithChildren,
  children: readonly SceneNode[],
): SceneGraphNodeWithChildren {
  switch (node.type) {
    case "group":
      return { ...node, children };
    case "frame":
      return { ...node, children };
  }
}
