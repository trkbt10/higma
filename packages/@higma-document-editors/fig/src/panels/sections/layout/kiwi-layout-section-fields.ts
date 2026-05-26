/** @file Kiwi layout field projection for fig property sections. */

import {
  CONSTRAINT_TYPE_VALUES,
  STACK_ALIGN_VALUES,
  STACK_COUNTER_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_MODE_VALUES,
  STACK_POSITIONING_VALUES,
  STACK_SIZING_VALUES,
  STACK_WRAP_VALUES,
  type ConstraintType,
  type StackAlign,
  type StackCounterAlign,
  type StackJustify,
  type StackMode,
  type StackPositioning,
  type StackSizing,
  type StackWrap,
} from "@higma-document-models/fig/constants";
import type { KiwiEnumValue } from "@higma-document-models/fig/types";
import type {
  AutoLayoutPadding,
  StackAlignId,
  StackJustifyId,
  StackModeId,
  ConstraintTypeId,
  StackCounterAlignId,
  StackPositioningId,
  StackSizingId,
} from "@higma-editor-kernel/ui/property-sections";

type KiwiEnumTable<TName extends string> = Readonly<Record<TName, number>>;

function kiwiEnumValue<TName extends string>(
  values: KiwiEnumTable<TName>,
  name: TName,
): { readonly value: number; readonly name: TName } {
  return { value: values[name], name };
}

function kiwiEnumName<TName extends string>(
  values: KiwiEnumTable<TName>,
  value: KiwiEnumValue | undefined,
  omittedZeroName: TName,
  owner: string,
): TName {
  const name = value?.name ?? omittedZeroName;
  if (!Object.prototype.hasOwnProperty.call(values, name)) {
    throw new Error(`${owner} received unsupported Kiwi enum "${name}"`);
  }
  return name as TName;
}

/** Read the Kiwi stack mode enum from the document field encoding. */
export function readKiwiStackMode(value: KiwiEnumValue | undefined): StackModeId {
  return kiwiEnumName<StackMode>(STACK_MODE_VALUES, value, "NONE", "readKiwiStackMode");
}

/** Read the Kiwi primary-axis alignment enum used by auto layout. */
export function readKiwiStackPrimaryAlignItems(value: KiwiEnumValue | undefined): StackJustifyId {
  return kiwiEnumName<StackJustify>(STACK_JUSTIFY_VALUES, value, "MIN", "readKiwiStackPrimaryAlignItems");
}

/** Read a Kiwi cross-axis alignment enum for the named property owner. */
export function readKiwiStackAlign(value: KiwiEnumValue | undefined, owner: string): StackAlignId {
  return kiwiEnumName<StackAlign>(STACK_ALIGN_VALUES, value, "MIN", owner);
}

/** Read the Kiwi stack wrapping enum as the kernel UI boolean. */
export function readKiwiStackWrap(value: KiwiEnumValue<StackWrap> | undefined): boolean {
  return kiwiEnumName<StackWrap>(STACK_WRAP_VALUES, value, "NO_WRAP", "readKiwiStackWrap") === "WRAP";
}

/** Read Kiwi auto-layout padding fields as the kernel UI four-side value. */
export function readKiwiAutoLayoutPadding(input: {
  readonly stackPadding?: number;
  readonly stackVerticalPadding?: number;
  readonly stackHorizontalPadding?: number;
  readonly stackPaddingRight?: number;
  readonly stackPaddingBottom?: number;
}): AutoLayoutPadding {
  const uniform = input.stackPadding ?? 0;
  const vertical = input.stackVerticalPadding ?? uniform;
  const horizontal = input.stackHorizontalPadding ?? uniform;
  return {
    top: vertical,
    right: input.stackPaddingRight ?? horizontal,
    bottom: input.stackPaddingBottom ?? vertical,
    left: horizontal,
  };
}

/** Write the kernel UI stack mode back into the Kiwi enum field encoding. */
export function writeKiwiStackMode(mode: StackModeId): KiwiEnumValue<StackMode> {
  return kiwiEnumValue(STACK_MODE_VALUES, mode);
}

/** Write the kernel UI primary-axis alignment into the Kiwi enum field encoding. */
export function writeKiwiStackPrimaryAlignItems(align: StackJustifyId): KiwiEnumValue<StackJustify> {
  return kiwiEnumValue(STACK_JUSTIFY_VALUES, align);
}

/** Write the kernel UI cross-axis alignment into the Kiwi enum field encoding. */
export function writeKiwiStackAlign(align: StackAlignId): KiwiEnumValue<StackAlign> {
  return kiwiEnumValue(STACK_ALIGN_VALUES, align);
}

/** Write the kernel UI stack wrapping boolean into the Kiwi enum field encoding. */
export function writeKiwiStackWrap(wrap: boolean): KiwiEnumValue<StackWrap> {
  return kiwiEnumValue(STACK_WRAP_VALUES, wrap ? "WRAP" : "NO_WRAP");
}

/** Read the Kiwi child positioning enum used by auto-layout children. */
export function readKiwiStackPositioning(value: KiwiEnumValue | undefined): StackPositioningId {
  return kiwiEnumName<StackPositioning>(STACK_POSITIONING_VALUES, value, "AUTO", "readKiwiStackPositioning");
}

/** Read the Kiwi stack sizing enum for the named property owner. */
export function readKiwiStackSizing(value: KiwiEnumValue | undefined, owner: string): StackSizingId {
  return kiwiEnumName<StackSizing>(STACK_SIZING_VALUES, value, "FIXED", owner);
}

/** Read the Kiwi layout constraint enum for the named property owner. */
export function readKiwiConstraintType(value: KiwiEnumValue | undefined, owner: string): ConstraintTypeId {
  return kiwiEnumName<ConstraintType>(CONSTRAINT_TYPE_VALUES, value, "MIN", owner);
}

/** Read the Kiwi child self-alignment enum used by auto-layout children. */
export function readKiwiStackChildAlignSelf(value: KiwiEnumValue | undefined): StackCounterAlignId {
  return kiwiEnumName<StackCounterAlign>(STACK_COUNTER_ALIGN_VALUES, value, "MIN", "readKiwiStackChildAlignSelf");
}

/** Write the kernel UI child positioning enum into the Kiwi enum field encoding. */
export function writeKiwiStackPositioning(value: StackPositioningId): KiwiEnumValue<StackPositioning> {
  return kiwiEnumValue(STACK_POSITIONING_VALUES, value);
}

/** Write the kernel UI stack sizing enum into the Kiwi enum field encoding. */
export function writeKiwiStackSizing(value: StackSizingId): KiwiEnumValue<StackSizing> {
  return kiwiEnumValue(STACK_SIZING_VALUES, value);
}

/** Write the kernel UI layout constraint enum into the Kiwi enum field encoding. */
export function writeKiwiConstraintType(value: ConstraintTypeId): KiwiEnumValue<ConstraintType> {
  return kiwiEnumValue(CONSTRAINT_TYPE_VALUES, value);
}

/** Write the kernel UI child self-alignment enum into the Kiwi enum field encoding. */
export function writeKiwiStackChildAlignSelf(value: StackCounterAlignId): KiwiEnumValue<StackCounterAlign> {
  return kiwiEnumValue(STACK_COUNTER_ALIGN_VALUES, value);
}
