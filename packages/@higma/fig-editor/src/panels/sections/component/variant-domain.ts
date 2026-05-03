/** @file Variant property editing domain shared by component property sections. */

import type { FigNodeId, VariantPropSpec } from "@higma/fig/domain";

export function updateVariantSpec(
  specs: readonly VariantPropSpec[],
  propDefId: FigNodeId,
  value: string,
): readonly VariantPropSpec[] {
  const exists = specs.some((spec) => spec.propDefId === propDefId);
  if (!exists) {
    return [...specs, { propDefId, value }];
  }
  return specs.map((spec) => (
    spec.propDefId === propDefId ? { ...spec, value } : spec
  ));
}

export function findVariantSpec(
  specs: readonly VariantPropSpec[],
  propDefId: FigNodeId,
): VariantPropSpec | undefined {
  return specs.find((spec) => spec.propDefId === propDefId);
}
