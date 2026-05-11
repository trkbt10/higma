/**
 * @file Variant Set detection — raw Kiwi (`FigNode`) side.
 *
 * The Figma UI concepts "Component Set" / "Variant Set" are encoded on
 * disk as a FRAME bearing variant metadata. The canonical schema has
 * no COMPONENT_SET NodeType. See
 * `docs/refactor/component-type-cleanup.md`.
 *
 * This module is the single source of truth for "is this raw node a
 * Variant Set?" against the kiwi-level `FigNode` shape. The
 * corresponding check for the high-level domain model
 * (`FigDesignNode`) lives in `../domain/variant-set`. Both modules
 * follow the same SoT contract — keep them in sync if the contract
 * changes.
 */

import type { FigNode } from "../types";
import { FIG_NODE_TYPE } from "../types";
import { getNodeType } from "../domain/raw-node-tree";

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
