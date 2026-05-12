/**
 * @file Bridge between Figma's Kiwi `BooleanOperation` enum payload and
 * the renderer-/codegen-side `BooleanOperationType` literal owned by
 * `@higma-primitives/path`. The path-algebra evaluator itself lives in
 * primitives; this module only owns the Figma-specific numeric mapping
 * and the Kiwi enum construction/parsing helpers.
 */

import type { BooleanOperationType } from "@higma-primitives/path";
import { isBooleanOperationName } from "@higma-primitives/path";

import type { KiwiEnumValue } from "./types";

/** Canonical numeric values Figma uses for the `BooleanOperation` Kiwi enum. */
export const BOOLEAN_OPERATION_VALUES: Record<BooleanOperationType, number> = {
  UNION: 0,
  SUBTRACT: 1,
  INTERSECT: 2,
  EXCLUDE: 3,
};

const BOOLEAN_OPERATION_BY_VALUE: Record<number, BooleanOperationType> = {
  0: "UNION",
  1: "SUBTRACT",
  2: "INTERSECT",
  3: "EXCLUDE",
};

/** Create the Kiwi enum payload used by Figma for live boolean operation nodes. */
export function createBooleanOperationEnum(operation: BooleanOperationType): KiwiEnumValue {
  return { value: BOOLEAN_OPERATION_VALUES[operation], name: operation };
}

/** Resolve the canonical boolean operation from Kiwi enum value/name data. */
export function resolveBooleanOperationType(operation: KiwiEnumValue | undefined): BooleanOperationType {
  if (!operation) {
    return "UNION";
  }
  const byValue = BOOLEAN_OPERATION_BY_VALUE[operation.value];
  if (byValue) {
    return byValue;
  }
  return isBooleanOperationName(operation.name) ? operation.name : "UNION";
}
