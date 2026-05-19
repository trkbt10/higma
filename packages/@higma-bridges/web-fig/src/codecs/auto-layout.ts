/**
 * @file AutoLayoutIR ↔ Kiwi stack-layout fields.
 *
 * Kiwi stores stack layout as fields on FigNode. The IR uses
 * CSS-flavoured keywords. This module maps the two without policy:
 * each IR value maps to exactly one Kiwi stack-layout shape.
 */
import type { FigNode, KiwiEnumValue } from "@higma-document-models/fig/types";
import {
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_MODE_VALUES,
  STACK_WRAP_VALUES,
  type StackAlign,
  type StackJustify,
  type StackMode,
  type StackWrap,
} from "@higma-document-models/fig/constants";
import type { AutoLayoutIR } from "../ir/types";

type FigStackLayoutFields = Pick<
  FigNode,
  | "stackMode"
  | "stackSpacing"
  | "stackPadding"
  | "stackVerticalPadding"
  | "stackHorizontalPadding"
  | "stackPaddingRight"
  | "stackPaddingBottom"
  | "stackPrimaryAlignItems"
  | "stackCounterAlignItems"
  | "stackWrap"
>;

type FigStackLayoutSpec = FigStackLayoutFields;

/**
 * Build a Kiwi enum value from a known enum table. The numeric value
 * must match the canonical Figma schema; using a stale or zero value
 * silently corrupts the encoded `.fig` (e.g. `{name:"VERTICAL", value:0}`
 * writes the StackMode `NONE` slot and loses the autoLayout direction
 * on round-trip).
 */
function kiwiEnum<T extends string>(name: T, value: number): KiwiEnumValue<T> {
  return { name, value };
}

/** Project an IR auto-layout into Kiwi stack-layout fields, or undefined when the layout is `none`. */
export function irAutoLayoutToFig(layout: AutoLayoutIR): FigStackLayoutSpec | undefined {
  if (layout.direction === "none") {
    return undefined;
  }
  const stackModeName: StackMode = layout.direction === "row" ? "HORIZONTAL" : "VERTICAL";
  const primaryName: StackJustify = primaryAlignToFig(layout.primaryAlign);
  const counterName: StackAlign = counterAlignToFig(layout.counterAlign);
  return {
    stackMode: kiwiEnum(stackModeName, STACK_MODE_VALUES[stackModeName]),
    stackSpacing: layout.gap,
    stackVerticalPadding: layout.paddingTop,
    stackHorizontalPadding: layout.paddingLeft,
    stackPaddingRight: layout.paddingRight,
    stackPaddingBottom: layout.paddingBottom,
    stackPrimaryAlignItems: kiwiEnum(primaryName, STACK_JUSTIFY_VALUES[primaryName]),
    stackCounterAlignItems: kiwiEnum(counterName, STACK_ALIGN_VALUES[counterName]),
    stackWrap: stackWrapToFig(layout.wrap),
  };
}

/** Project Kiwi stack-layout fields into the IR auto-layout shape. */
export function figAutoLayoutToIR(props: FigStackLayoutFields | undefined): AutoLayoutIR {
  if (!props) {
    return { direction: "none" };
  }
  const mode = props.stackMode?.name;
  if (mode !== "HORIZONTAL" && mode !== "VERTICAL") {
    return { direction: "none" };
  }
  return {
    direction: mode === "HORIZONTAL" ? "row" : "column",
    gap: props.stackSpacing ?? 0,
    paddingTop: stackPadding(props).top,
    paddingRight: stackPadding(props).right,
    paddingBottom: stackPadding(props).bottom,
    paddingLeft: stackPadding(props).left,
    primaryAlign: figPrimaryAlignToIR(props.stackPrimaryAlignItems?.name),
    counterAlign: figCounterAlignToIR(props.stackCounterAlignItems?.name),
    wrap: figStackWrapToIR(props.stackWrap?.name),
  };
}

function stackWrapToFig(wrap: boolean | undefined): KiwiEnumValue<StackWrap> | undefined {
  if (wrap !== true) {
    return undefined;
  }
  return kiwiEnum("WRAP", STACK_WRAP_VALUES.WRAP);
}

function figStackWrapToIR(name: string | undefined): boolean | undefined {
  switch (name) {
    case "WRAP":
      return true;
    case "NO_WRAP":
    case undefined:
      return undefined;
    default:
      throw new Error(`figAutoLayoutToIR: unknown stackWrap name "${name}"`);
  }
}

function stackPadding(
  props: FigStackLayoutFields,
): { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number } {
  const uniform = props.stackPadding ?? 0;
  const vertical = props.stackVerticalPadding ?? uniform;
  const horizontal = props.stackHorizontalPadding ?? uniform;
  return {
    top: vertical,
    right: props.stackPaddingRight ?? horizontal,
    bottom: props.stackPaddingBottom ?? vertical,
    left: horizontal,
  };
}

function primaryAlignToFig(align: "start" | "center" | "end" | "space-between"): StackJustify {
  switch (align) {
    case "start":
      return "MIN";
    case "center":
      return "CENTER";
    case "end":
      return "MAX";
    case "space-between":
      return "SPACE_BETWEEN";
  }
}

function counterAlignToFig(align: "start" | "center" | "end" | "stretch"): StackAlign {
  switch (align) {
    case "start":
      return "MIN";
    case "center":
      return "CENTER";
    case "end":
      return "MAX";
    case "stretch":
      // The `StackAlign` Kiwi enum (parent-level
      // `stackCounterAlignItems`) does not declare STRETCH — that
      // category is carried per-child via `stackChildAlignSelf=STRETCH`.
      // Parent alignment remains MIN; per-child stretch is applied at
      // emit time through the child field.
      return "MIN";
  }
}

function figPrimaryAlignToIR(name: string | undefined): "start" | "center" | "end" | "space-between" {
  switch (name) {
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "SPACE_BETWEEN":
    case "SPACE_EVENLY":
    case "SPACE_AROUND":
      return "space-between";
    case "MIN":
    case undefined:
      return "start";
    default:
      throw new Error(`figAutoLayoutToIR: unknown stackPrimaryAlignItems name "${name}"`);
  }
}

function figCounterAlignToIR(name: string | undefined): "start" | "center" | "end" | "stretch" {
  switch (name) {
    case "CENTER":
      return "center";
    case "MAX":
      return "end";
    case "STRETCH":
      return "stretch";
    case "BASELINE":
      // CSS baseline alignment exists but isn't a counter-stretch
      // category; treat as start to keep the IR closed under round-trip
      // for text-heavy designs that lean on baseline alignment.
      return "start";
    case "MIN":
    case undefined:
      return "start";
    default:
      throw new Error(`figAutoLayoutToIR: unknown stackCounterAlignItems name "${name}"`);
  }
}
