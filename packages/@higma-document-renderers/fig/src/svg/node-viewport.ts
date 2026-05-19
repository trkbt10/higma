/**
 * @file Derive the required SVG renderer viewport from a Kiwi FigNode.
 */
import type { FigNode } from "@higma-document-models/fig/types";

export type FigNodeViewport = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Read the render viewport for one FigNode without rewriting its transform.
 *
 * `transform.m02/m12` omissions are Kiwi identity-translation fields, so
 * `0` is the schema value rather than a recovery default.
 */
export function requireFigNodeViewport(node: FigNode, operationName: string): FigNodeViewport {
  const size = node.size;
  if (size === undefined) {
    throw new Error(`${operationName}: node "${node.name ?? "?"}" has no size`);
  }
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || size.x <= 0 || size.y <= 0) {
    throw new Error(`${operationName}: node "${node.name ?? "?"}" has non-positive size`);
  }
  return {
    x: node.transform?.m02 ?? 0,
    y: node.transform?.m12 ?? 0,
    width: size.x,
    height: size.y,
  };
}
