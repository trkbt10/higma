/** @file Kiwi node equality for transform-only edits. */
import type { FigNode } from "../types";

/** Return true when two Kiwi nodes differ only by their transform field. */
export function sameKiwiNodeExceptTransform(left: FigNode, right: FigNode): boolean {
  const keys = new Set<keyof FigNode>([
    ...Object.keys(left) as (keyof FigNode)[],
    ...Object.keys(right) as (keyof FigNode)[],
  ]);
  for (const key of keys) {
    if (key === "transform") {
      continue;
    }
    if (left[key] !== right[key]) {
      return false;
    }
  }
  return true;
}
