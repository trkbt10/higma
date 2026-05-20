/** @file Kiwi vector path editor model. */
import { getNodeType } from "@higma-document-models/fig/domain";
import type { FigBlob } from "@higma-document-models/fig/domain";
import { readKiwiTransform } from "@higma-document-models/fig/matrix";
import type { FigGuid, FigMatrix, FigNode, FigVectorPath } from "@higma-document-models/fig/types";
import {
  applyEditableVectorPathOperation,
  getEditableCommandEndpoint,
  getEditableCommandPoints,
  getEditableControlLines,
  parseEditablePathData,
  serializeEditablePathData,
  type EditablePathCommand,
  type EditableVectorPathOperation,
} from "./commands";
import type { VectorPathPoint } from "./geometry";

export type VectorPathHandle = {
  readonly key: string;
  readonly nodeGuid: FigGuid;
  readonly pathIndex: number;
  readonly commandIndex: number;
  readonly valueIndex: number;
  readonly role: "anchor" | "control";
  readonly x: number;
  readonly y: number;
};

export type VectorPathDragState = {
  readonly handle: VectorPathHandle;
};

export type EditableVectorPathSource = readonly FigVectorPath[];

export type VectorPathControlLine = {
  readonly key: string;
  readonly from: VectorPathPoint;
  readonly to: VectorPathPoint;
};

export type EditableVectorPathOverlay = {
  readonly key: string;
  readonly pathIndex: number;
  readonly data: string;
  readonly transform?: string;
};

function requireSize(node: FigNode): NonNullable<FigNode["size"]> {
  if (node.size === undefined) {
    throw new Error(`vector-path editor requires size for ${node.name ?? "(unnamed)"}`);
  }
  return node.size;
}

function requireGuid(node: FigNode): FigGuid {
  if (node.guid === undefined) {
    throw new Error(`vector-path editor requires a Kiwi guid for ${node.name ?? "(unnamed)"}`);
  }
  return node.guid;
}

function rectanglePath(node: FigNode): FigVectorPath {
  const size = requireSize(node);
  return { windingRule: "NONZERO", data: `M 0 0 L ${size.x} 0 L ${size.x} ${size.y} L 0 ${size.y} Z` };
}

function ellipsePath(node: FigNode): FigVectorPath {
  const size = requireSize(node);
  const rx = size.x / 2;
  const ry = size.y / 2;
  const k = 0.5522847498307936;
  return {
    windingRule: "NONZERO",
    data: [
      `M ${rx} 0`,
      `C ${rx + rx * k} 0 ${size.x} ${ry - ry * k} ${size.x} ${ry}`,
      `C ${size.x} ${ry + ry * k} ${rx + rx * k} ${size.y} ${rx} ${size.y}`,
      `C ${rx - rx * k} ${size.y} 0 ${ry + ry * k} 0 ${ry}`,
      `C 0 ${ry - ry * k} ${rx - rx * k} 0 ${rx} 0`,
      "Z",
    ].join(" "),
  };
}

function linePath(node: FigNode): FigVectorPath {
  const size = requireSize(node);
  return { windingRule: "NONZERO", data: `M 0 0 L ${size.x} ${size.y}` };
}

function syntheticEditableVectorPaths(node: FigNode): EditableVectorPathSource | undefined {
  switch (getNodeType(node)) {
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
      return [rectanglePath(node)];
    case "ELLIPSE":
      return [ellipsePath(node)];
    case "LINE":
      return [linePath(node)];
    default:
      return undefined;
  }
}

/** Return editable vector paths directly from the Kiwi node. */
export function resolveEditableVectorPaths(
  node: FigNode | undefined,
  _blobs: readonly FigBlob[] = [],
): EditableVectorPathSource | undefined {
  if (node === undefined) {
    return undefined;
  }
  if (node.vectorPaths !== undefined && node.vectorPaths.length > 0) {
    return node.vectorPaths;
  }
  return syntheticEditableVectorPaths(node);
}

/** Collect committed vector path handles from a Kiwi VECTOR node. */
export function collectVectorPathHandles(
  node: FigNode | undefined,
  _activePage: FigNode | null | undefined,
  paths: EditableVectorPathSource | undefined,
): readonly VectorPathHandle[] {
  if (node === undefined || paths === undefined) {
    return [];
  }
  const nodeGuid = requireGuid(node);
  return paths.flatMap((path, pathIndex) => {
    const commands = editablePathCommands(path, "collectVectorPathHandles");
    return commands.flatMap((command, commandIndex) => commandPointHandles(command, commands, nodeGuid, pathIndex, commandIndex));
  });
}

function commandPointHandles(
  command: EditablePathCommand,
  commands: readonly EditablePathCommand[],
  nodeGuid: FigGuid,
  pathIndex: number,
  commandIndex: number,
): readonly VectorPathHandle[] {
  return getEditableCommandPoints(command).filter((point) => !isClosingDuplicateAnchor({
    commands,
    commandIndex,
    point,
  })).map((point) => ({
    key: `${pathIndex}:${commandIndex}:${point.valueIndex}`,
    nodeGuid,
    pathIndex,
    commandIndex,
    valueIndex: point.valueIndex,
    role: point.role,
    x: point.x,
    y: point.y,
  }));
}

function isClosingDuplicateAnchor({
  commands,
  commandIndex,
  point,
}: {
  readonly commands: readonly EditablePathCommand[];
  readonly commandIndex: number;
  readonly point: { readonly x: number; readonly y: number; readonly role: "anchor" | "control" };
}): boolean {
  if (point.role !== "anchor") {
    return false;
  }
  if (commands[commandIndex + 1]?.type !== "Z") {
    return false;
  }
  const firstCommand = commands[0];
  if (firstCommand === undefined) {
    throw new Error("vector-path editor cannot resolve a closed path without commands");
  }
  const start = getEditableCommandEndpoint(firstCommand);
  if (start === undefined) {
    throw new Error("vector-path editor cannot resolve a closed path without a start anchor");
  }
  return point.x === start.x && point.y === start.y;
}

function editablePathCommands(path: FigVectorPath | undefined, owner: string): readonly EditablePathCommand[] {
  if (path?.data === undefined) {
    throw new Error(`${owner} requires vector path data`);
  }
  return parseEditablePathData(path.data);
}

function editablePathsForUpdate(node: FigNode): EditableVectorPathSource {
  const paths = resolveEditableVectorPaths(node);
  if (paths === undefined) {
    throw new Error(`vector-path editor cannot edit ${getNodeType(node)} node ${node.name ?? "(unnamed)"}`);
  }
  return paths;
}

function updateVectorPathAt(
  node: FigNode,
  pathIndex: number,
  commands: readonly EditablePathCommand[],
): FigNode {
  const paths = editablePathsForUpdate(node);
  const target = paths[pathIndex];
  if (target === undefined) {
    throw new Error(`vector-path editor missing path ${pathIndex}`);
  }
  return {
    ...node,
    vectorPaths: paths.map((path, index) => {
      if (index !== pathIndex) {
        return path;
      }
      return {
        ...target,
        data: serializeEditablePathData(commands),
      };
    }),
  };
}

/** Return control guide lines for committed paths. */
export function collectVectorPathControlLines(
  _node: FigNode | undefined,
  _activePage: FigNode | null | undefined,
  paths: EditableVectorPathSource | undefined,
): readonly VectorPathControlLine[] {
  if (paths === undefined) {
    return [];
  }
  return paths.flatMap((path, pathIndex) => {
    const commands = editablePathCommands(path, "collectVectorPathControlLines");
    return getEditableControlLines(commands).map((line) => ({
      key: `${pathIndex}:${line.key}`,
      from: line.from,
      to: line.to,
    }));
  });
}

/** Return path overlays for hit testing committed vector paths. */
export function collectEditableVectorPathOverlays(
  _node: FigNode | undefined,
  _activePage: FigNode | null | undefined,
  paths: EditableVectorPathSource | undefined,
): readonly EditableVectorPathOverlay[] {
  if (paths === undefined) {
    return [];
  }
  return paths.map((path, pathIndex) => ({
    key: `path:${pathIndex}`,
    pathIndex,
    data: path.data ?? "",
  }));
}

/** Find the nearest vector handle. */
export function findNearestVectorHandle(
  handles: readonly VectorPathHandle[],
  point: VectorPathPoint,
): VectorPathHandle | undefined {
  return handles.reduce<VectorPathHandle | undefined>((best, handle) => {
    const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
    if (best === undefined) {
      return handle;
    }
    const bestDistance = Math.hypot(best.x - point.x, best.y - point.y);
    return distance < bestDistance ? handle : best;
  }, undefined);
}

/** Resolve a context-menu handle at a page point. */
export function resolveContextVectorHandle(
  handles: readonly VectorPathHandle[],
  point: VectorPathPoint,
): VectorPathHandle | undefined {
  return findNearestVectorHandle(handles, point);
}

/** Return whether this Kiwi node supports vector path editing. */
export function canEnterVectorPathEdit(node: FigNode | undefined): boolean {
  return resolveEditableVectorPaths(node) !== undefined;
}

/** Add a point to a vector path. */
export function addVectorPathPoint({
  node,
  pathIndex,
  point,
}: {
  readonly node: FigNode;
  readonly pathIndex: number;
  readonly point: VectorPathPoint;
}): FigNode {
  const paths = editablePathsForUpdate(node);
  const commands = editablePathCommands(paths[pathIndex], "addVectorPathPoint");
  return updateVectorPathAt(
    node,
    pathIndex,
    applyEditableVectorPathOperation(commands, { type: "insert-point-at-nearest-segment", point }),
  );
}

/** Replace vector path commands on the selected node. */
export function updateVectorPathCommands({
  node,
  pathIndex,
  commands,
}: {
  readonly node: FigNode;
  readonly pathIndex: number;
  readonly commands: readonly EditablePathCommand[];
}): FigNode {
  return updateVectorPathAt(node, pathIndex, commands);
}

/** Update one command endpoint on a vector path. */
export function updateVectorPathEndpoint({
  node,
  pathIndex,
  commandIndex,
  point,
}: {
  readonly node: FigNode;
  readonly pathIndex: number;
  readonly commandIndex: number;
  readonly point: VectorPathPoint;
}): FigNode {
  const paths = editablePathsForUpdate(node);
  const commands = editablePathCommands(paths[pathIndex], "updateVectorPathEndpoint");
  const command = commands[commandIndex];
  if (command === undefined) {
    throw new Error(`updateVectorPathEndpoint missing command ${commandIndex}`);
  }
  const anchor = getEditableCommandPoints(command).find((candidate) => candidate.role === "anchor");
  if (anchor === undefined) {
    throw new Error(`updateVectorPathEndpoint command ${commandIndex} has no anchor`);
  }
  return updateVectorPathCommands({
    node,
    pathIndex,
    commands: applyEditableVectorPathOperation(commands, {
      type: "move-command-point",
      commandIndex,
      valueIndex: anchor.valueIndex,
      point,
    }),
  });
}

/** Apply an editable vector path operation to the Kiwi node path. */
export function updateVectorPathWithOperation({
  node,
  pathIndex,
  operation,
}: {
  readonly node: FigNode;
  readonly pathIndex: number;
  readonly operation: EditableVectorPathOperation;
}): FigNode {
  const paths = editablePathsForUpdate(node);
  const commands = editablePathCommands(paths[pathIndex], "updateVectorPathWithOperation");
  return updateVectorPathAt(node, pathIndex, applyEditableVectorPathOperation(commands, operation));
}

/** Convert a page-space point to drawing-local coordinates. */
export function pageToDrawingLocalPoint(
  parent: { readonly parentTransform?: FigMatrix },
  point: VectorPathPoint,
): VectorPathPoint {
  if (parent.parentTransform === undefined) {
    return point;
  }
  return worldToLocalPoint(parent.parentTransform, point);
}

/** Human-readable label for a vector path handle. */
export function getVectorHandleAriaLabel(handle: VectorPathHandle): string {
  if (handle.role === "anchor") {
    return `Vector path anchor handle ${handle.commandIndex + 1}`;
  }
  return `Vector path control handle ${handle.commandIndex + 1}`;
}

/** Convert world point to local point using the inverse 2x3 transform. */
export function worldToLocalPoint(transform: FigMatrix, point: VectorPathPoint): VectorPathPoint {
  const matrix = readKiwiTransform(transform);
  const determinant = matrix.m00 * matrix.m11 - matrix.m01 * matrix.m10;
  if (determinant === 0) {
    throw new Error("worldToLocalPoint requires an invertible transform");
  }
  const x = point.x - matrix.m02;
  const y = point.y - matrix.m12;
  return {
    x: (matrix.m11 * x - matrix.m01 * y) / determinant,
    y: (-matrix.m10 * x + matrix.m00 * y) / determinant,
  };
}
