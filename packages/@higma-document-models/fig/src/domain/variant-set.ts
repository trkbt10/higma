/**
 * @file Variant Set detection (SoT, domain side).
 *
 * The Figma UI concepts "Component Set" / "Variant Set" are encoded on
 * disk as a FRAME bearing variant metadata. The canonical schema has
 * no COMPONENT_SET NodeType. See
 * `docs/refactor/component-type-cleanup.md` for the disk encoding.
 *
 * This module is the single source of truth for "is this node a
 * Variant Set?" against the high-level domain model (`FigDesignNode`).
 * The corresponding check for raw kiwi (`FigNode`) lives in
 * `../symbols/variant-set-kiwi`. Both modules implement the same
 * three-field SoT contract; if it changes, update both in lockstep.
 */

import type { FigDesignNode } from "./document";

/**
 * True when `node` is a Variant Set FRAME on disk.
 *
 * Disk SoT contract: a Variant Set is a FRAME that satisfies *all* of:
 *   1. `type === "FRAME"`
 *   2. `isStateGroup === true`
 *   3. `componentPropertyDefs` contains at least one VARIANT-typed entry
 *
 * The `Prop=Value` child-naming convention is decorative and must not
 * be used for detection — Figma reconstructs labels from
 * `stateGroupPropertyValueOrders` + `variantPropSpecs`, not from names.
 */
export function isVariantSetFrame(node: FigDesignNode): boolean {
  if (node.type !== "FRAME") {
    return false;
  }
  if (node.isStateGroup !== true) {
    return false;
  }
  const defs = node.componentPropertyDefs;
  if (!defs || defs.length === 0) {
    return false;
  }
  return defs.some((d) => d.type === "VARIANT");
}
