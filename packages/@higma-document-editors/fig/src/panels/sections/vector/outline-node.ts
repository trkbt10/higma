/** @file Convert Kiwi shape nodes into explicit VECTOR path nodes. */

import { getNodeType } from "@higma-document-models/fig/domain";
import { NODE_TYPE_VALUES, toEnumValue } from "@higma-document-models/fig/constants";
import type { FigNode, FigVectorPath } from "@higma-document-models/fig/types";

const CIRCLE_KAPPA = 0.5522847498307936;
const STAR_INNER_RADIUS_RATIO = 0.382;

function roundPathNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function path(data: string): FigVectorPath {
  return { windingRule: "NONZERO", data };
}

function rectPath(width: number, height: number): FigVectorPath {
  return path(`M 0 0 L ${width} 0 L ${width} ${height} L 0 ${height} Z`);
}

function roundedRectPath(width: number, height: number, radius: number | undefined): FigVectorPath {
  if (radius === undefined || radius === 0) {
    return rectPath(width, height);
  }
  const clamped = Math.max(0, Math.min(radius, width / 2, height / 2));
  const control = roundPathNumber(clamped * CIRCLE_KAPPA);
  return path([
    `M ${clamped} 0`,
    `L ${width - clamped} 0`,
    `C ${width - clamped + control} 0 ${width} ${clamped - control} ${width} ${clamped}`,
    `L ${width} ${height - clamped}`,
    `C ${width} ${height - clamped + control} ${width - clamped + control} ${height} ${width - clamped} ${height}`,
    `L ${clamped} ${height}`,
    `C ${clamped - control} ${height} 0 ${height - clamped + control} 0 ${height - clamped}`,
    `L 0 ${clamped}`,
    `C 0 ${clamped - control} ${clamped - control} 0 ${clamped} 0`,
    "Z",
  ].join(" "));
}

function ellipsePath(width: number, height: number): FigVectorPath {
  const rx = width / 2;
  const ry = height / 2;
  const cx = rx;
  const cy = ry;
  const ox = roundPathNumber(rx * CIRCLE_KAPPA);
  const oy = roundPathNumber(ry * CIRCLE_KAPPA);
  return path([
    `M ${cx} 0`,
    `C ${cx + ox} 0 ${width} ${cy - oy} ${width} ${cy}`,
    `C ${width} ${cy + oy} ${cx + ox} ${height} ${cx} ${height}`,
    `C ${cx - ox} ${height} 0 ${cy + oy} 0 ${cy}`,
    `C 0 ${cy - oy} ${cx - ox} 0 ${cx} 0`,
    "Z",
  ].join(" "));
}

function linePath(width: number, height: number): FigVectorPath {
  return path(`M 0 0 L ${width} ${height}`);
}

function requirePointCount(node: FigNode): number {
  if (node.pointCount === undefined) {
    throw new Error(`outlineKiwiNode: ${getNodeType(node)} requires pointCount`);
  }
  return Math.max(3, Math.floor(node.pointCount));
}

function regularPoints({
  width,
  height,
  pointCount,
  innerScale,
}: {
  readonly width: number;
  readonly height: number;
  readonly pointCount: number;
  readonly innerScale?: number;
}): readonly { readonly x: number; readonly y: number }[] {
  const cx = width / 2;
  const cy = height / 2;
  const outer = Math.min(width, height) / 2;
  const steps = innerScale === undefined ? pointCount : pointCount * 2;
  return Array.from({ length: steps }, (_, index) => {
    const radius = innerScale === undefined || index % 2 === 0 ? outer : outer * innerScale;
    const angle = -Math.PI / 2 + (index / steps) * Math.PI * 2;
    return {
      x: roundPathNumber(cx + Math.cos(angle) * radius),
      y: roundPathNumber(cy + Math.sin(angle) * radius),
    };
  });
}

function pointsPath(points: readonly { readonly x: number; readonly y: number }[]): FigVectorPath {
  const first = points[0];
  if (first === undefined) {
    throw new Error("outlineKiwiNode: point path requires at least one point");
  }
  return path([`M ${first.x} ${first.y}`, ...points.slice(1).map((point) => `L ${point.x} ${point.y}`), "Z"].join(" "));
}

function outlineVectorPaths(node: FigNode): readonly FigVectorPath[] {
  const size = node.size;
  if (size === undefined) {
    throw new Error(`outlineKiwiNode: ${getNodeType(node)} requires size`);
  }
  switch (getNodeType(node)) {
    case "VECTOR": {
      if (node.vectorPaths === undefined || node.vectorPaths.length === 0) {
        throw new Error("outlineKiwiNode: VECTOR requires vectorPaths");
      }
      return node.vectorPaths;
    }
    case "RECTANGLE":
      return [rectPath(size.x, size.y)];
    case "ROUNDED_RECTANGLE":
      return [roundedRectPath(size.x, size.y, node.cornerRadius)];
    case "ELLIPSE":
      return [ellipsePath(size.x, size.y)];
    case "LINE":
      return [linePath(size.x, size.y)];
    case "REGULAR_POLYGON":
      return [pointsPath(regularPoints({ width: size.x, height: size.y, pointCount: requirePointCount(node) }))];
    case "STAR":
      return [pointsPath(regularPoints({
        width: size.x,
        height: size.y,
        pointCount: requirePointCount(node),
        innerScale: node.starInnerScale ?? node.starInnerRadius ?? STAR_INNER_RADIUS_RATIO,
      }))];
    default:
      throw new Error(`outlineKiwiNode: unsupported node type ${getNodeType(node)}`);
  }
}

/** Convert a supported Kiwi node into a VECTOR while preserving its GUID and parentIndex. */
export function outlineKiwiNode(node: FigNode): FigNode {
  return {
    ...node,
    type: toEnumValue("VECTOR", NODE_TYPE_VALUES)!,
    name: getNodeType(node) === "VECTOR" ? node.name : `${node.name ?? getNodeType(node)} Outline`,
    vectorPaths: outlineVectorPaths(node),
    textData: undefined,
    derivedTextData: undefined,
    arcData: undefined,
    cornerRadius: undefined,
    rectangleCornerRadii: undefined,
    pointCount: undefined,
    starInnerRadius: undefined,
    starInnerScale: undefined,
  };
}

/** Return true when the outline operation is defined for a Kiwi node. */
export function canOutlineKiwiNode(node: FigNode): boolean {
  switch (getNodeType(node)) {
    case "VECTOR":
    case "RECTANGLE":
    case "ROUNDED_RECTANGLE":
    case "ELLIPSE":
    case "LINE":
    case "REGULAR_POLYGON":
    case "STAR":
      return true;
    default:
      return false;
  }
}
