/** @file Corner radius operations for Kiwi shape nodes. */
import type { FigNode } from "@higma-document-models/fig/types";

/** Return the editable uniform corner radius when the selected node carries one. */
export function readUniformCornerRadius(node: FigNode): number | undefined {
  if (typeof node.cornerRadius === "number") {
    return node.cornerRadius;
  }
  const radii = node.rectangleCornerRadii;
  if (radii === undefined || radii.length !== 4) {
    return undefined;
  }
  const [topLeft, topRight, bottomRight, bottomLeft] = radii;
  if (topLeft === topRight && topRight === bottomRight && bottomRight === bottomLeft) {
    return topLeft;
  }
  return undefined;
}
