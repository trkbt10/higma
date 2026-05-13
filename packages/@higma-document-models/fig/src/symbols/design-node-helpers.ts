/** @file FigDesignNode helpers used during scene-graph construction. */

import type { FigDesignNode, MutableFigDesignNode } from "../domain";
import type { FigPaint } from "../types";
import { IDENTITY_MATRIX } from "../matrix";
import { resolveClipsContent as resolveGeometryClipsContent } from "../geometry-interpret";
import type { AffineMatrix, CornerRadius } from "@higma-primitives/path";

/** Get the already-normalized domain node type name. */
export function getDesignNodeTypeName(node: FigDesignNode): string {
  return node.type;
}

/** Convert a fig matrix-like object into a SceneGraph affine matrix. */
export function convertDesignTransform(
  matrix: { m00?: number; m01?: number; m02?: number; m10?: number; m11?: number; m12?: number } | undefined,
): AffineMatrix {
  if (!matrix) { return IDENTITY_MATRIX; }
  return {
    m00: matrix.m00 ?? 1,
    m01: matrix.m01 ?? 0,
    m02: matrix.m02 ?? 0,
    m10: matrix.m10 ?? 0,
    m11: matrix.m11 ?? 1,
    m12: matrix.m12 ?? 0,
  };
}

/** Extract a uniform or per-corner radius from a domain design node. */
export function extractDesignCornerRadius(node: FigDesignNode): CornerRadius | undefined {
  const radii = node.rectangleCornerRadii;
  if (radii && radii.length === 4) {
    const topLeft = radii[0];
    const topRight = radii[1];
    const bottomRight = radii[2];
    const bottomLeft = radii[3];
    if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
      return topLeft || undefined;
    }
    return [topLeft, topRight, bottomRight, bottomLeft];
  }
  return node.cornerRadius;
}

/** Resolve clipsContent from the domain value or shared geometry policy. */
export function resolveDesignClipsContent(node: FigDesignNode): boolean {
  if (node.clipsContent !== undefined) { return node.clipsContent; }
  return resolveGeometryClipsContent(undefined, undefined, getDesignNodeTypeName(node));
}

/** Return whether a paint field was explicitly declared. */
export function hasPaintDeclaration(paints: readonly FigPaint[] | undefined): boolean {
  return paints !== undefined && paints.length > 0;
}

/** Deep clone a FigDesignNode tree for mutation during instance resolution. */
export function deepCloneDesignNode(node: FigDesignNode): MutableFigDesignNode {
  if (!node.children || node.children.length === 0) {
    return { ...node };
  }
  return {
    ...node,
    children: node.children.map(deepCloneDesignNode),
  };
}
