/** @file Resolve the property panel target from Kiwi editor selection. */
import type { FigNode } from "@higma-document-models/fig/types";

export type FigPropertyMutationTarget = {
  readonly node: FigNode;
};

/** Require a concrete primary node for property mutation. */
export function requirePropertyMutationTarget(node: FigNode | undefined): FigPropertyMutationTarget {
  if (node === undefined) {
    throw new Error("PropertyPanel requires a selected Kiwi node before mutating properties");
  }
  return { node };
}
