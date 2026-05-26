/** @file Fig editor operation surface Kiwi node mutation primitives. */
import { NODE_TYPE_VALUES } from "@higma-document-models/fig/constants";
import { getNodeType, guidToString } from "@higma-document-models/fig/domain";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigNode } from "@higma-document-models/fig/types";
import type { FigEditorContextValue } from "../context/FigEditorContext";
import { parseEditablePathData } from "../vector-path/commands";
import { figEditorOperationSurfaceNodeByGuid, figEditorOperationSurfaceNodeGuidKey } from "./fig-editor-operation-surface-node-access";
import { requireFigEditorOperationSurfaceGuid } from "./fig-editor-operation-surface-guid";

/** Replace a Kiwi node with an explicitly supplied same-GUID node. */
export function replaceFigEditorOperationSurfaceKiwiNode(
  current: FigNode,
  replacement: FigNode,
  editor: FigEditorContextValue,
): FigNode {
  const currentGuid = requireFigEditorOperationSurfaceGuid(current.guid, "replaceFigEditorOperationSurfaceKiwiNode current");
  const replacementGuid = requireFigEditorOperationSurfaceGuid(replacement.guid, "replaceFigEditorOperationSurfaceKiwiNode replacement");
  if (guidToString(currentGuid) !== guidToString(replacementGuid)) {
    throw new Error("replaceFigEditorOperationSurfaceKiwiNode must not change Kiwi node guid");
  }
  const replacementParentGuid = replacement.parentIndex?.guid;
  if (replacementParentGuid !== undefined) {
    figEditorOperationSurfaceNodeByGuid(editor, replacementParentGuid, "replaceFigEditorOperationSurfaceKiwiNode parent");
  }
  return replacement;
}

/** Set the translation fields of a Kiwi transform while preserving rotation and scale. */
export function setFigEditorOperationSurfaceNodePosition(node: FigNode, x: number, y: number): FigNode {
  const transform = readKiwiTransform(node.transform);
  return {
    ...node,
    transform: { ...transform, m02: x, m12: y },
  };
}

/** Translate a Kiwi transform while preserving rotation and scale. */
export function translateFigEditorOperationSurfaceNode(node: FigNode, dx: number, dy: number): FigNode {
  const transform = readKiwiTransform(node.transform);
  return {
    ...node,
    transform: { ...transform, m02: transform.m02 + dx, m12: transform.m12 + dy },
  };
}

/** Resize a Kiwi node that explicitly carries `size`. */
export function resizeFigEditorOperationSurfaceNode(node: FigNode, width: number, height: number): FigNode {
  if (node.size === undefined) {
    throw new Error(`resizeFigEditorOperationSurfaceNode requires Kiwi size on ${node.name ?? figEditorOperationSurfaceNodeGuidKey(node, "resizeFigEditorOperationSurfaceNode")}`);
  }
  return { ...node, size: { x: width, y: height } };
}

function symbolNodeType(): FigNode["type"] {
  const value = NODE_TYPE_VALUES.SYMBOL;
  if (value === undefined) {
    throw new Error("convertFigEditorOperationSurfaceNodeToSymbol requires SYMBOL in Kiwi NODE_TYPE_VALUES");
  }
  return { value, name: "SYMBOL" };
}

/** Convert a Kiwi node to the SYMBOL encoding used by Figma components. */
export function convertFigEditorOperationSurfaceNodeToSymbol(node: FigNode): FigNode {
  const type = getNodeType(node);
  if (type === "DOCUMENT" || type === "CANVAS" || type === "INSTANCE") {
    throw new Error(`convertFigEditorOperationSurfaceNodeToSymbol cannot convert ${type} nodes`);
  }
  if (type === "SYMBOL") {
    throw new Error(`convertFigEditorOperationSurfaceNodeToSymbol received an existing SYMBOL ${figEditorOperationSurfaceNodeGuidKey(node, "convertFigEditorOperationSurfaceNodeToSymbol")}`);
  }
  return { ...node, type: symbolNodeType() };
}

function requireVectorPathIndex(paths: NonNullable<FigNode["vectorPaths"]>, pathIndex: number, owner: string): void {
  if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex >= paths.length) {
    throw new Error(`${owner} pathIndex ${pathIndex} is outside vectorPaths`);
  }
}

/** Replace one VECTOR path data string after validating the editable path syntax. */
export function setFigEditorOperationSurfaceVectorPathData(node: FigNode, pathIndex: number, data: string): FigNode {
  if (getNodeType(node) !== "VECTOR") {
    throw new Error("setFigEditorOperationSurfaceVectorPathData requires a VECTOR node");
  }
  const paths = node.vectorPaths;
  if (paths === undefined || paths.length === 0) {
    throw new Error("setFigEditorOperationSurfaceVectorPathData requires Kiwi vectorPaths");
  }
  requireVectorPathIndex(paths, pathIndex, "setFigEditorOperationSurfaceVectorPathData");
  parseEditablePathData(data);
  return {
    ...node,
    vectorPaths: paths.map((path, index) => {
      if (index !== pathIndex) {
        return path;
      }
      return { ...path, data };
    }),
  };
}
