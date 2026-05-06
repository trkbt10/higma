/** @file Accessible labels for vector path draft handles. */

import type { VectorPathDraftHandle } from "./draft";

/** Return the accessible label for a vector path draft handle. */
export function getVectorPathDraftHandleLabel(handle: VectorPathDraftHandle): string {
  if (handle.role === "anchor") {
    return `Draft vector path anchor handle ${handle.index + 1}`;
  }
  return `Draft vector path control handle ${handle.index + 1}`;
}
