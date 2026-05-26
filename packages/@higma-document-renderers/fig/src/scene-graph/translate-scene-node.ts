/** @file SceneGraph node translation for explicit editor operation inputs. */

import type { AffineMatrix } from "@higma-primitives/path";
import type {
  FrameNode,
  GroupNode,
  ImageNode,
  PathNode,
  RectNode,
  EllipseNode,
  SceneGraph,
  SceneNode,
  SceneNodeId,
  TextNode,
} from "./model";
import {
  readSceneGraphNodeChildren,
  replaceSceneGraphNodeChildren,
} from "./scene-graph-node-children";

export type SceneGraphNodeTranslation = {
  readonly nodeId: SceneNodeId;
  readonly dx: number;
  readonly dy: number;
};

type TranslatedSceneNode = {
  readonly node: SceneNode;
  readonly translated: boolean;
};

type TranslatedSceneNodeChildren = {
  readonly children: readonly SceneNode[];
  readonly translated: boolean;
};

type SceneNodeTransformReplacement = {
  readonly node: SceneNode;
  readonly replaced: boolean;
};

type SceneNodeChildrenTransformReplacement = {
  readonly children: readonly SceneNode[];
  readonly replaced: boolean;
};

/** Apply editor-authored scene node translation to one local transform. */
export function translateSceneNodeTransform(transform: AffineMatrix, dx: number, dy: number): AffineMatrix {
  return {
    ...transform,
    m02: transform.m02 + dx,
    m12: transform.m12 + dy,
  };
}

function sceneNodeWithTransform(node: SceneNode, transform: AffineMatrix): SceneNode {
  switch (node.type) {
    case "group":
      return sceneGroupNodeWithTransform(node, transform);
    case "frame":
      return sceneFrameNodeWithTransform(node, transform);
    case "rect":
      return sceneRectNodeWithTransform(node, transform);
    case "ellipse":
      return sceneEllipseNodeWithTransform(node, transform);
    case "path":
      return scenePathNodeWithTransform(node, transform);
    case "text":
      return sceneTextNodeWithTransform(node, transform);
    case "image":
      return sceneImageNodeWithTransform(node, transform);
  }
}

function sceneGroupNodeWithTransform(node: GroupNode, transform: AffineMatrix): GroupNode {
  return { ...node, transform };
}

function sceneFrameNodeWithTransform(node: FrameNode, transform: AffineMatrix): FrameNode {
  return { ...node, transform };
}

function sceneRectNodeWithTransform(node: RectNode, transform: AffineMatrix): RectNode {
  return { ...node, transform };
}

function sceneEllipseNodeWithTransform(node: EllipseNode, transform: AffineMatrix): EllipseNode {
  return { ...node, transform };
}

function scenePathNodeWithTransform(node: PathNode, transform: AffineMatrix): PathNode {
  return { ...node, transform };
}

function sceneTextNodeWithTransform(node: TextNode, transform: AffineMatrix): TextNode {
  return { ...node, transform };
}

function sceneImageNodeWithTransform(node: ImageNode, transform: AffineMatrix): ImageNode {
  return { ...node, transform };
}

function translateSceneNodeOwnTransform(node: SceneNode, dx: number, dy: number): SceneNode {
  const transform = translateSceneNodeTransform(node.transform, dx, dy);
  return sceneNodeWithTransform(node, transform);
}

function sceneNodeWithMaskContent(node: SceneNode, maskContent: SceneNode): SceneNode {
  const mask = node.mask;
  if (mask === undefined) {
    throw new Error(`SceneGraph node ${node.id} has no mask content to replace`);
  }
  switch (node.type) {
    case "group":
      return { ...node, mask: { ...mask, maskContent } };
    case "frame":
      return { ...node, mask: { ...mask, maskContent } };
    case "rect":
      return { ...node, mask: { ...mask, maskContent } };
    case "ellipse":
      return { ...node, mask: { ...mask, maskContent } };
    case "path":
      return { ...node, mask: { ...mask, maskContent } };
    case "text":
      return { ...node, mask: { ...mask, maskContent } };
    case "image":
      return { ...node, mask: { ...mask, maskContent } };
  }
}

function translateSceneNodeChildren(
  children: readonly SceneNode[],
  translation: SceneGraphNodeTranslation,
): TranslatedSceneNodeChildren {
  const translatedChildren = children.map((child) => translateSceneNode(child, translation));
  if (!translatedChildren.some((child) => child.translated)) {
    return { children, translated: false };
  }
  return {
    children: translatedChildren.map((child) => child.node),
    translated: true,
  };
}

function translateSceneNode(
  node: SceneNode,
  translation: SceneGraphNodeTranslation,
): TranslatedSceneNode {
  const ownTranslated = node.id === translation.nodeId;
  const ownNode = ownTranslatedNode(node, translation, ownTranslated);
  const mask = ownNode.mask;
  if (mask === undefined) {
    return translateSceneNodeChildrenAfterMask(ownNode, translation, ownTranslated);
  }
  const maskResult = translateSceneNode(mask.maskContent, translation);
  if (!maskResult.translated) {
    return translateSceneNodeChildrenAfterMask(ownNode, translation, ownTranslated);
  }
  const nodeWithMask = sceneNodeWithMaskContent(ownNode, maskResult.node);
  return translateSceneNodeChildrenAfterMask(nodeWithMask, translation, true);
}

function ownTranslatedNode(
  node: SceneNode,
  translation: SceneGraphNodeTranslation,
  ownTranslated: boolean,
): SceneNode {
  if (!ownTranslated) {
    return node;
  }
  return translateSceneNodeOwnTransform(node, translation.dx, translation.dy);
}

function translateSceneNodeChildrenAfterMask(
  node: SceneNode,
  translation: SceneGraphNodeTranslation,
  translatedBeforeChildren: boolean,
): TranslatedSceneNode {
  switch (node.type) {
    case "group":
    case "frame": {
      const childrenResult = translateSceneNodeChildren(node.children, translation);
      if (!childrenResult.translated) {
        return { node, translated: translatedBeforeChildren };
      }
      return {
        node: replaceSceneGraphNodeChildren(node, childrenResult.children),
        translated: true,
      };
    }
    case "rect":
    case "ellipse":
    case "path":
    case "text":
    case "image":
      return { node, translated: translatedBeforeChildren };
  }
}

function findSceneNodeMaskContent(node: SceneNode, nodeId: SceneNodeId): SceneNode | undefined {
  const maskContent = node.mask?.maskContent;
  if (maskContent === undefined) {
    return undefined;
  }
  return findSceneNode(maskContent, nodeId);
}

function findSceneNode(node: SceneNode, nodeId: SceneNodeId): SceneNode | undefined {
  if (node.id === nodeId) {
    return node;
  }
  const maskResult = findSceneNodeMaskContent(node, nodeId);
  if (maskResult !== undefined) {
    return maskResult;
  }
  return readSceneGraphNodeChildren(node).reduce<SceneNode | undefined>((found, child) => {
    if (found !== undefined) {
      return found;
    }
    return findSceneNode(child, nodeId);
  }, undefined);
}

function replaceSceneNodeMaskContentTransform(
  node: SceneNode,
  nodeId: SceneNodeId,
  transform: AffineMatrix,
): SceneNodeTransformReplacement {
  const maskContent = node.mask?.maskContent;
  if (maskContent === undefined) {
    return { node, replaced: false };
  }
  const result = replaceSceneNodeTransform(maskContent, nodeId, transform);
  if (!result.replaced) {
    return { node, replaced: false };
  }
  return {
    node: sceneNodeWithMaskContent(node, result.node),
    replaced: true,
  };
}

function replaceSceneNodeChildrenTransform(
  children: readonly SceneNode[],
  nodeId: SceneNodeId,
  transform: AffineMatrix,
): SceneNodeChildrenTransformReplacement {
  const results = children.map((child) => replaceSceneNodeTransform(child, nodeId, transform));
  if (!results.some((result) => result.replaced)) {
    return { children, replaced: false };
  }
  return {
    children: results.map((result) => result.node),
    replaced: true,
  };
}

function replaceSceneNodeChildrenTransformAfterMask(
  node: SceneNode,
  nodeId: SceneNodeId,
  transform: AffineMatrix,
  replacedBeforeChildren: boolean,
): SceneNodeTransformReplacement {
  switch (node.type) {
    case "group":
    case "frame": {
      const childrenResult = replaceSceneNodeChildrenTransform(node.children, nodeId, transform);
      if (!childrenResult.replaced) {
        return { node, replaced: replacedBeforeChildren };
      }
      return {
        node: replaceSceneGraphNodeChildren(node, childrenResult.children),
        replaced: true,
      };
    }
    case "rect":
    case "ellipse":
    case "path":
    case "text":
    case "image":
      return { node, replaced: replacedBeforeChildren };
  }
}

function replaceSceneNodeTransform(
  node: SceneNode,
  nodeId: SceneNodeId,
  transform: AffineMatrix,
): SceneNodeTransformReplacement {
  if (node.id === nodeId) {
    return { node: sceneNodeWithTransform(node, transform), replaced: true };
  }
  const maskResult = replaceSceneNodeMaskContentTransform(node, nodeId, transform);
  return replaceSceneNodeChildrenTransformAfterMask(maskResult.node, nodeId, transform, maskResult.replaced);
}

/** Find one SceneNode by its SceneGraph node id. */
export function findSceneGraphNode(sceneGraph: SceneGraph, nodeId: SceneNodeId): SceneNode | undefined {
  return findSceneNode(sceneGraph.root, nodeId);
}

/** Replace one SceneNode local transform in the shared SceneGraph render input. */
export function replaceSceneGraphNodeTransform(
  sceneGraph: SceneGraph,
  nodeId: SceneNodeId,
  transform: AffineMatrix,
): SceneGraph {
  const result = replaceSceneNodeTransform(sceneGraph.root, nodeId, transform);
  if (!result.replaced) {
    throw new Error(`replaceSceneGraphNodeTransform: SceneNode ${nodeId} is not present in the SceneGraph`);
  }
  if (result.node.type !== "group") {
    throw new Error("replaceSceneGraphNodeTransform: SceneGraph root must remain a group node");
  }
  return {
    ...sceneGraph,
    root: result.node,
  };
}

/** Apply one explicit node translation to the shared SceneGraph render input. */
export function translateSceneGraphNode(
  sceneGraph: SceneGraph,
  translation: SceneGraphNodeTranslation,
): SceneGraph {
  if (translation.dx === 0 && translation.dy === 0) {
    return sceneGraph;
  }
  const result = translateSceneNode(sceneGraph.root, translation);
  if (!result.translated) {
    throw new Error(`translateSceneGraphNode: SceneNode ${translation.nodeId} is not present in the SceneGraph`);
  }
  if (result.node.type !== "group") {
    throw new Error("translateSceneGraphNode: SceneGraph root must remain a group node");
  }
  return {
    ...sceneGraph,
    root: result.node,
  };
}
