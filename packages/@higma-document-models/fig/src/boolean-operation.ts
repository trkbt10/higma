/**
 * @file Bridge between Figma's Kiwi `BooleanOperation` enum payload and
 * the renderer-/codegen-side `BooleanOperationType` literal owned by
 * `@higma-primitives/path`. The path-algebra evaluator itself lives in
 * primitives; this module owns:
 *
 *   - the Figma-faithful `BooleanOperation` string union and the
 *     schema-bound numeric mapping `BOOLEAN_OPERATION_VALUES` (the
 *     wire-format SoT — what real `.fig` files contain on disk), and
 *   - the bidirectional translation between that wire-format set and
 *     the path-algebra `BooleanOperationType` set.
 *
 * The schema (`figma-schema.json`) declares `BooleanOperation` with
 * member `XOR` (typeId 3). The path-algebra abstraction declares
 * `EXCLUDE` for the same operation. This module is the single
 * crosswalk: emitters write `XOR` (schema name) so the produced
 * `.fig` round-trips byte-for-byte with Figma's own exporter, while
 * `resolveBooleanOperationType` returns `EXCLUDE` so path-algebra
 * consumers keep their existing case-arm vocabulary.
 */

import type { BooleanOperationType } from "@higma-primitives/path";
import { isBooleanOperationName } from "@higma-primitives/path";
import { requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

import type { KiwiEnumValue } from "./types";

/**
 * Fig wire-format string union for the `BooleanOperation` enum.
 *
 * Schema authority: `figma-schema.json` → enum `BooleanOperation`
 * (typeId 20) members `UNION` (0) / `INTERSECT` (1) / `SUBTRACT` (2)
 * / `XOR` (3). Note the third operation: the schema calls it `XOR`,
 * while the path-algebra abstraction in `@higma-primitives/path`
 * calls the same operation `EXCLUDE`. Wire-format consumers
 * (`FigNode.booleanOperation`, the spec emitter, fixture writers)
 * use this `BooleanOperation` set; path-algebra consumers use
 * `BooleanOperationType` and pass through the translation helpers
 * defined below.
 */
export type BooleanOperation = "UNION" | "INTERSECT" | "SUBTRACT" | "XOR";

/**
 * Schema-bound numeric values for the `BooleanOperation` Kiwi enum.
 *
 * The values come from `figma-schema.json` via `requireFigEnumTable`:
 * the table will throw at module load time if the schema's value
 * assignments ever drift from this code. An earlier hand-rolled
 * revision swapped SUBTRACT and INTERSECT (assigned 1 to SUBTRACT
 * and 2 to INTERSECT). That inversion made every renderer that
 * calls `resolveBooleanOperationType` interpret real-Figma SUBTRACT
 * nodes as INTERSECT and vice-versa — visible on the
 * `composite-subtract-basic` (31.6%) and `composite-intersect-basic`
 * (21.0%) pixel-diff regressions. Binding to the schema-derived
 * table prevents that class of drift from happening again silently.
 */
export const BOOLEAN_OPERATION_VALUES: Readonly<Record<BooleanOperation, number>> = requireFigEnumTable(
  "BooleanOperation",
  ["UNION", "INTERSECT", "SUBTRACT", "XOR"],
);

const BOOLEAN_OPERATION_BY_VALUE: Readonly<Record<number, BooleanOperationType>> = {
  0: "UNION",
  1: "INTERSECT",
  2: "SUBTRACT",
  // Wire-format value 3 = schema `XOR` = path-algebra `EXCLUDE`. The
  // resolver returns the path-algebra name so consumers that switch
  // on `BooleanOperationType` need no change.
  3: "EXCLUDE",
};

/**
 * Translate the path-algebra operation name into the wire-format
 * (Figma schema) name. Only `EXCLUDE` ↔ `XOR` differs; the other
 * three operations share their name across both conventions.
 *
 * Exported so consumers that hand a path-algebra `BooleanOperationType`
 * to the spec builder can translate without re-deriving the crosswalk.
 */
export function pathOpToWireOp(operation: BooleanOperationType): BooleanOperation {
  if (operation === "EXCLUDE") {
    return "XOR";
  }
  return operation;
}

/**
 * Create the Kiwi enum payload used by Figma for live boolean
 * operation nodes. Accepts the path-algebra name (with `EXCLUDE`) and
 * writes the schema name (with `XOR`) so the produced fig matches
 * Figma's own exporter byte-for-byte.
 */
export function createBooleanOperationEnum(operation: BooleanOperationType): KiwiEnumValue<BooleanOperation> {
  const wireName = pathOpToWireOp(operation);
  return { value: BOOLEAN_OPERATION_VALUES[wireName], name: wireName };
}

/**
 * Resolve the canonical (path-algebra) boolean operation from a Kiwi
 * enum value/name payload. Tolerates both the schema name (`XOR`)
 * and the path-algebra alias (`EXCLUDE`) on the `name` side; matches
 * by numeric value first so a malformed `name` doesn't override the
 * authoritative tag.
 */
export function resolveBooleanOperationType(
  operation: KiwiEnumValue<BooleanOperation> | KiwiEnumValue | undefined,
): BooleanOperationType {
  if (!operation) {
    return "UNION";
  }
  const byValue = BOOLEAN_OPERATION_BY_VALUE[operation.value];
  if (byValue) {
    return byValue;
  }
  if (operation.name === "XOR") {
    return "EXCLUDE";
  }
  return isBooleanOperationName(operation.name) ? operation.name : "UNION";
}
