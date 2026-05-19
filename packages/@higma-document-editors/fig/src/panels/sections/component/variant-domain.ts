/** @file Variant metadata readers for Kiwi component fields. */
import type { FigNode } from "@higma-document-models/fig/types";

/** Return variant property labels carried by a component node. */
export function readVariantLabels(node: FigNode): readonly string[] {
  return (node.variantPropSpecs ?? []).map((entry) => {
    if (entry.propDefId === undefined) {
      throw new Error("readVariantLabels: variantPropSpecs entry is missing propDefId");
    }
    return `${entry.propDefId.sessionID}:${entry.propDefId.localID}=${entry.value}`;
  });
}
