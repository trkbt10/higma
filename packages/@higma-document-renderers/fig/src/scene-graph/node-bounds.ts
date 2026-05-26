/** @file SceneGraph-derived node bounds for editor overlays and hit testing. */

import { pathContoursBoundingBox } from "@higma-primitives/path";
import {
  computePreRotationTopLeft,
  extractRotationDegrees,
  IDENTITY_MATRIX,
  multiplyMatrices,
} from "@higma-document-models/fig/matrix";
import type { FigMatrix } from "@higma-document-models/fig/types";
import type { SceneGraph, SceneNode } from "./model";
import { readSceneGraphNodeChildren } from "./scene-graph-node-children";

export type SceneGraphNodeBounds = {
  readonly id: string;
  readonly rootId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly aabb: SceneGraphBoundsLike;
};

export type SceneGraphBoundsLike = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type SceneGraphNodeLocalBounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function sceneNodeLocalOriginBounds(width: number, height: number): SceneGraphNodeLocalBounds {
  return { x: 0, y: 0, width, height };
}

function rotatedAabb(bounds: Omit<SceneGraphBoundsLike, "rotation"> & { readonly rotation: number }): SceneGraphBoundsLike {
  if (bounds.rotation === 0) {
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const radians = bounds.rotation * (Math.PI / 180);
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const points = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => {
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    return {
      x: centerX + dx * cos - dy * sin,
      y: centerY + dx * sin + dy * cos,
    };
  });
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function sceneNodeLocalBounds(node: SceneNode): SceneGraphNodeLocalBounds | undefined {
  switch (node.type) {
    case "frame":
    case "rect":
    case "text":
    case "image":
      return sceneNodeLocalOriginBounds(node.width, node.height);
    case "ellipse":
      return sceneNodeLocalOriginBounds(node.rx * 2, node.ry * 2);
    case "path": {
      const contourBounds = pathContoursBoundingBox(node.contours);
      if (contourBounds !== undefined) {
        return {
          x: contourBounds.x,
          y: contourBounds.y,
          width: contourBounds.w,
          height: contourBounds.h,
        };
      }
      if (node.width !== undefined && node.height !== undefined) {
        return sceneNodeLocalOriginBounds(node.width, node.height);
      }
      throw new Error(`SceneGraph node bounds require contours or explicit width and height for path node ${node.id}`);
    }
    case "group":
      return undefined;
  }
}

function computePreRotationLocalBoundsTopLeft(
  transform: FigMatrix,
  localBounds: SceneGraphNodeLocalBounds,
): { readonly x: number; readonly y: number } {
  if (localBounds.x === 0 && localBounds.y === 0) {
    return computePreRotationTopLeft(transform, localBounds.width, localBounds.height);
  }
  const localCenterX = localBounds.x + localBounds.width / 2;
  const localCenterY = localBounds.y + localBounds.height / 2;
  const centerX = transform.m00 * localCenterX + transform.m01 * localCenterY + transform.m02;
  const centerY = transform.m10 * localCenterX + transform.m11 * localCenterY + transform.m12;
  return {
    x: centerX - localBounds.width / 2,
    y: centerY - localBounds.height / 2,
  };
}

function boundsFromSceneNodeLocalBounds(
  node: SceneNode,
  transform: FigMatrix,
  rootId: string,
  localBounds: SceneGraphNodeLocalBounds,
): SceneGraphNodeBounds {
  const topLeft = computePreRotationLocalBoundsTopLeft(transform, localBounds);
  const rotation = extractRotationDegrees(transform);
  const base = {
    x: topLeft.x,
    y: topLeft.y,
    width: localBounds.width,
    height: localBounds.height,
    rotation,
  };
  return {
    id: node.id,
    rootId,
    ...base,
    aabb: rotatedAabb(base),
  };
}

function unionSceneGraphNodeBounds(
  id: string,
  rootId: string,
  descendants: readonly SceneGraphNodeBounds[],
): SceneGraphNodeBounds | undefined {
  if (descendants.length === 0) {
    return undefined;
  }
  const minX = Math.min(...descendants.map((bounds) => bounds.aabb.x));
  const minY = Math.min(...descendants.map((bounds) => bounds.aabb.y));
  const maxX = Math.max(...descendants.map((bounds) => bounds.aabb.x + bounds.aabb.width));
  const maxY = Math.max(...descendants.map((bounds) => bounds.aabb.y + bounds.aabb.height));
  const aabb = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return {
    id,
    rootId,
    x: aabb.x,
    y: aabb.y,
    width: aabb.width,
    height: aabb.height,
    rotation: 0,
    aabb,
  };
}

function nodeRootId(node: SceneNode, inheritedRootId: string | undefined): string | undefined {
  if (node.id === "root") {
    return inheritedRootId;
  }
  if (node.type === "group" && node.rendererStructure?.kind === "mask-wrapper") {
    return inheritedRootId;
  }
  return inheritedRootId ?? node.id;
}

function sceneNodePublishesOwnBounds(node: SceneNode): boolean {
  if (node.type === "group" && node.rendererStructure?.kind === "mask-wrapper") {
    return false;
  }
  return true;
}

function flattenSceneGraphNodeBoundsRecursive(
  node: SceneNode,
  parentTransform: FigMatrix,
  inheritedRootId: string | undefined,
): readonly SceneGraphNodeBounds[] {
  const absoluteTransform = multiplyMatrices(parentTransform, node.transform);
  const rootId = nodeRootId(node, inheritedRootId);
  const childBounds = readSceneGraphNodeChildren(node).flatMap((child) => (
    flattenSceneGraphNodeBoundsRecursive(child, absoluteTransform, rootId)
  ));
  if (rootId === undefined) {
    return childBounds;
  }
  const localBounds = sceneNodeLocalBounds(node);
  if (localBounds !== undefined) {
    return [
      boundsFromSceneNodeLocalBounds(node, absoluteTransform, rootId, localBounds),
      ...childBounds,
    ];
  }
  if (!sceneNodePublishesOwnBounds(node)) {
    return childBounds;
  }
  const groupBounds = unionSceneGraphNodeBounds(node.id, rootId, childBounds);
  if (groupBounds === undefined) {
    return childBounds;
  }
  return [groupBounds, ...childBounds];
}

/** Flatten the renderer SceneGraph into page-coordinate node bounds. */
export function flattenSceneGraphNodeBounds(sceneGraph: SceneGraph): readonly SceneGraphNodeBounds[] {
  return flattenSceneGraphNodeBoundsRecursive(sceneGraph.root, IDENTITY_MATRIX, undefined);
}

/** Translate renderer-derived node bounds by one editor-authored scene delta. */
export function translateSceneGraphNodeBounds(
  bounds: SceneGraphNodeBounds,
  dx: number,
  dy: number,
): SceneGraphNodeBounds {
  return {
    ...bounds,
    x: bounds.x + dx,
    y: bounds.y + dy,
    aabb: {
      ...bounds.aabb,
      x: bounds.aabb.x + dx,
      y: bounds.aabb.y + dy,
    },
  };
}
