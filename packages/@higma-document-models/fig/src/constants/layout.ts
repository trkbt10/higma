/**
 * @file Layout/AutoLayout-related constants for Figma fig format
 *
 * Numeric enum values are pinned to the canonical Figma Kiwi schema
 * via `@higma-figma-schema/profiles`. The schema is the SoT.
 */

import { requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

/** Stack mode values — schema `StackMode`. */
export const STACK_MODE_VALUES = requireFigEnumTable("StackMode", [
  "NONE",
  "HORIZONTAL",
  "VERTICAL",
  "GRID",
]);

export type StackMode = "NONE" | "HORIZONTAL" | "VERTICAL" | "GRID";

/**
 * Counter-axis alignment for parent FRAMEs (`stackCounterAlignItems`).
 *
 * SoT: Figma's `StackAlign` Kiwi enum (figma-schema.json). STRETCH is
 * NOT a member — Figma encodes "stretch all children to fill the
 * counter axis" via each child's `stackChildAlignSelf=STRETCH` (see
 * {@link STACK_COUNTER_ALIGN_VALUES}) rather than a parent-level
 * enum. Writing STRETCH here would encode value 3 which the
 * round-trip decodes back as BASELINE — a silent corruption that
 * breaks auto-layout INSTANCE reflow.
 */
export const STACK_ALIGN_VALUES = requireFigEnumTable("StackAlign", [
  "MIN",
  "CENTER",
  "MAX",
  "BASELINE",
]);

export type StackAlign = "MIN" | "CENTER" | "MAX" | "BASELINE";

/**
 * Primary-axis alignment for parent FRAMEs (`stackPrimaryAlignItems`).
 *
 * SoT: Figma's `StackJustify` Kiwi enum. The space-distribution
 * variants live here — note the value order (`SPACE_EVENLY` precedes
 * `SPACE_BETWEEN`).
 */
export const STACK_JUSTIFY_VALUES = requireFigEnumTable("StackJustify", [
  "MIN",
  "CENTER",
  "MAX",
  "SPACE_EVENLY",
  "SPACE_BETWEEN",
]);

export type StackJustify = "MIN" | "CENTER" | "MAX" | "SPACE_EVENLY" | "SPACE_BETWEEN";

/** Stack wrapping values — schema `StackWrap`. */
export const STACK_WRAP_VALUES = requireFigEnumTable("StackWrap", [
  "NO_WRAP",
  "WRAP",
]);

export type StackWrap = "NO_WRAP" | "WRAP";

/**
 * Per-child counter-axis alignment override (`stackChildAlignSelf`).
 *
 * SoT: Figma's `StackCounterAlign` Kiwi enum. STRETCH (value 3) is
 * what "fill the parent's counter axis" actually serializes to — when
 * captured CSS resolves to a counter-stretch, every child carries this
 * override and the parent stays at MIN.
 */
export const STACK_COUNTER_ALIGN_VALUES = requireFigEnumTable("StackCounterAlign", [
  "MIN",
  "CENTER",
  "MAX",
  "STRETCH",
  "AUTO",
  "BASELINE",
]);

export type StackCounterAlign = "MIN" | "CENTER" | "MAX" | "STRETCH" | "AUTO" | "BASELINE";

/**
 * Counter-axis content distribution for wrapped auto-layout
 * (`stackCounterAlignContent`).
 *
 * SoT: Figma's `StackCounterAlignContent` Kiwi enum (typeId 42).
 * Only two values exist — `AUTO` (no special distribution) and
 * `SPACE_BETWEEN` (distribute rows/columns with equal gaps). Modern
 * Figma writes this slot when `stackWrap` is enabled; older fig
 * files omit it (the omitted-field zero-default decodes back as
 * `AUTO`, which is the documented default behaviour).
 */
export const STACK_COUNTER_ALIGN_CONTENT_VALUES = requireFigEnumTable("StackCounterAlignContent", [
  "AUTO",
  "SPACE_BETWEEN",
]);

export type StackCounterAlignContent = "AUTO" | "SPACE_BETWEEN";

/** Stack positioning values — schema `StackPositioning`. */
export const STACK_POSITIONING_VALUES = requireFigEnumTable("StackPositioning", [
  "AUTO",
  "ABSOLUTE",
]);

export type StackPositioning = "AUTO" | "ABSOLUTE";

/**
 * Stack sizing values — schema `StackSize` (the Kiwi name; the
 * project's TypeScript surface keeps the historical
 * `StackSizing` alias because every consumer already imports it).
 */
export const STACK_SIZING_VALUES = requireFigEnumTable("StackSize", [
  "FIXED",
  "RESIZE_TO_FIT",
  "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE",
]);

export type StackSizing = "FIXED" | "RESIZE_TO_FIT" | "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE";
export type StackSizingInput = StackSizing | "HUG";

/** Resolve builder sizing input to Figma's canonical StackSize enum name. */
export function resolveStackSizingInput(sizing: StackSizingInput): StackSizing {
  switch (sizing) {
    case "FIXED":
    case "RESIZE_TO_FIT":
    case "RESIZE_TO_FIT_WITH_IMPLICIT_SIZE":
      return sizing;
    case "HUG":
      return "RESIZE_TO_FIT";
  }
  throw new Error(`Unknown StackSizing input: ${sizing}`);
}

/**
 * Constraint type values — schema `ConstraintType`.
 *
 * The schema additionally declares `FIXED_MIN` (5) and `FIXED_MAX`
 * (6). These are emitted by newer Figma builds; round-tripping a
 * file that uses them is preserved through the runtime layer even
 * though no domain-level builder surfaces them yet.
 */
export const CONSTRAINT_TYPE_VALUES = requireFigEnumTable("ConstraintType", [
  "MIN",
  "CENTER",
  "MAX",
  "STRETCH",
  "SCALE",
]);

export type ConstraintType = "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";

/**
 * Winding rule values — schema `WindingRule`.
 *
 * The Figma Kiwi schema names the non-zero/odd winding rules
 * `NONZERO` and `ODD`. The repo historically used `EVENODD` (the
 * SVG/CSS name) for the "1" branch — that worked at the encode
 * level because the numeric value matched, but the round-trip
 * read-side compared the `name` string and got fooled. Both names
 * are kept here and mapped to the same value; consumers that read
 * `name` should treat `EVENODD` and `ODD` as equivalent. New
 * encode paths should prefer `ODD` so the on-disk shape mirrors a
 * genuine Figma export exactly.
 */
const WINDING_RULE_BASE = requireFigEnumTable("WindingRule", ["NONZERO", "ODD"]);

export const WINDING_RULE_VALUES = Object.freeze({
  ...WINDING_RULE_BASE,
  EVENODD: WINDING_RULE_BASE.ODD,
});

export type WindingRule = "NONZERO" | "ODD" | "EVENODD";
