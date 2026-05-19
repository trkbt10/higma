/**
 * @file Kiwi node enum accessors.
 */
import type { FigNode, FigNodeType } from "../types";
import { kiwiEnumName } from "../constants";

/**
 * Read the canonical Kiwi node type name from a decoded Kiwi enum object.
 */
export function getNodeType(node: { readonly type?: FigNode["type"]; readonly [key: string]: unknown }): FigNodeType {
  const name = kiwiEnumName<FigNodeType>(node.type, "FigNode.type");
  if (name === undefined) {
    throw new Error("FigNode.type is required");
  }
  return name;
}
