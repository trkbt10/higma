/**
 * @file Layout/AutoLayout-related constants for Figma fig format
 */

/** Stack mode values (for AutoLayout) */
export const STACK_MODE_VALUES = {
  NONE: 0,
  HORIZONTAL: 1,
  VERTICAL: 2,
  WRAP: 3,
} as const;

export type StackMode = keyof typeof STACK_MODE_VALUES;

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
export const STACK_ALIGN_VALUES = {
  MIN: 0,
  CENTER: 1,
  MAX: 2,
  BASELINE: 3,
} as const;

export type StackAlign = keyof typeof STACK_ALIGN_VALUES;

/**
 * Primary-axis alignment for parent FRAMEs (`stackPrimaryAlignItems`).
 *
 * SoT: Figma's `StackJustify` Kiwi enum. The space-distribution
 * variants live here — note the value order (`SPACE_EVENLY` precedes
 * `SPACE_BETWEEN`).
 */
export const STACK_JUSTIFY_VALUES = {
  MIN: 0,
  CENTER: 1,
  MAX: 2,
  SPACE_EVENLY: 3,
  SPACE_BETWEEN: 4,
} as const;

export type StackJustify = keyof typeof STACK_JUSTIFY_VALUES;

/**
 * Per-child counter-axis alignment override (`stackChildAlignSelf`).
 *
 * SoT: Figma's `StackCounterAlign` Kiwi enum. STRETCH (value 3) is
 * what "fill the parent's counter axis" actually serializes to — when
 * captured CSS resolves to a counter-stretch, every child carries this
 * override and the parent stays at MIN.
 */
export const STACK_COUNTER_ALIGN_VALUES = {
  MIN: 0,
  CENTER: 1,
  MAX: 2,
  STRETCH: 3,
  AUTO: 4,
  BASELINE: 5,
} as const;

export type StackCounterAlign = keyof typeof STACK_COUNTER_ALIGN_VALUES;

/** Stack positioning values (for child constraints in AutoLayout) */
export const STACK_POSITIONING_VALUES = {
  AUTO: 0,
  ABSOLUTE: 1,
} as const;

export type StackPositioning = keyof typeof STACK_POSITIONING_VALUES;

/** Stack sizing values (for child sizing in AutoLayout) */
export const STACK_SIZING_VALUES = {
  FIXED: 0,
  FILL: 1,
  HUG: 2,
} as const;

export type StackSizing = keyof typeof STACK_SIZING_VALUES;

/** Constraint type values (for fixed positioning) */
export const CONSTRAINT_TYPE_VALUES = {
  MIN: 0,
  CENTER: 1,
  MAX: 2,
  STRETCH: 3,
  SCALE: 4,
} as const;

export type ConstraintType = keyof typeof CONSTRAINT_TYPE_VALUES;

/** Winding rule values (for vector paths) */
export const WINDING_RULE_VALUES = {
  NONZERO: 0,
  EVENODD: 1,
} as const;

export type WindingRule = keyof typeof WINDING_RULE_VALUES;
