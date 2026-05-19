/**
 * @file Variant Set detection on Kiwi FigNode.
 *
 * The Figma UI concepts "Component Set" / "Variant Set" are encoded on
 * disk as a FRAME bearing variant metadata. The canonical schema has
 * no COMPONENT_SET NodeType. See
 * `docs/refactor/component-type-cleanup.md`.
 *
 * This module is the single source of truth for "is this Kiwi node a
 * Variant Set?" against the kiwi-level `FigNode` shape.
 */

import type { FigNode } from "../types";
import { FIG_NODE_TYPE } from "../types";
import { getNodeType } from "../domain";

/**
 * True when `node` is a Variant Set FRAME on disk.
 *
 * Disk SoT contract:
 *   1. `type === "FRAME"`
 *   2. `isStateGroup === true`
 *   3. `componentPropDefs` contains at least one VARIANT-typed entry
 */
export function isVariantSetFrame(node: FigNode): boolean {
  if (getNodeType(node) !== FIG_NODE_TYPE.FRAME) {
    return false;
  }
  if (node.isStateGroup !== true) {
    return false;
  }
  const defs = node.componentPropDefs ?? [];
  return defs.some((d) => d.type?.name === "VARIANT");
}
