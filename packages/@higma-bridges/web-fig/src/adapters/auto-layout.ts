/**
 * @file AutoLayoutIR ↔ AutoLayoutProps conversion.
 *
 * Figma's AutoLayoutProps mirrors the Kiwi schema (KiwiEnumValue
 * placeholders for every alignment field). The IR uses CSS-flavoured
 * keywords. This adapter translates the two without policy: each IR
 * value maps to exactly one AutoLayoutProps shape.
 */
import type { AutoLayoutProps } from "@higma-document-models/fig/domain";
import type { KiwiEnumValue } from "@higma-document-models/fig/types";
import {
  STACK_ALIGN_VALUES,
  STACK_JUSTIFY_VALUES,
  STACK_MODE_VALUES,
  type StackAlign,
  type StackJustify,
  type StackMode,
} from "@higma-document-models/fig/constants";
import type { AutoLayoutIR } from "../ir/types";

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

/** Project an IR auto-layout into Figma's `AutoLayoutProps`, or undefined when the layout is `none`. */
export function irAutoLayoutToFig(layout: AutoLayoutIR): AutoLayoutProps | undefined {
  if (layout.direction === "none") {
    return undefined;
  }
  const stackModeName: StackMode = layout.direction === "row" ? "HORIZONTAL" : "VERTICAL";
  const primaryName: StackJustify = primaryAlignToFig(layout.primaryAlign);
  const counterName: StackAlign = counterAlignToFig(layout.counterAlign);
  return {
    stackMode: kiwiEnum(stackModeName, STACK_MODE_VALUES[stackModeName]),
    stackSpacing: layout.gap,
    stackPadding: {
      top: layout.paddingTop,
      right: layout.paddingRight,
      bottom: layout.paddingBottom,
      left: layout.paddingLeft,
    },
    stackPrimaryAlignItems: kiwiEnum(primaryName, STACK_JUSTIFY_VALUES[primaryName]),
    stackCounterAlignItems: kiwiEnum(counterName, STACK_ALIGN_VALUES[counterName]),
    stackWrap: layout.wrap,
  };
}

/** Project Figma's `AutoLayoutProps` into the IR auto-layout shape. */
export function figAutoLayoutToIR(props: AutoLayoutProps | undefined): AutoLayoutIR {
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
    paddingTop: props.stackPadding?.top ?? 0,
    paddingRight: props.stackPadding?.right ?? 0,
    paddingBottom: props.stackPadding?.bottom ?? 0,
    paddingLeft: props.stackPadding?.left ?? 0,
    primaryAlign: figPrimaryAlignToIR(props.stackPrimaryAlignItems?.name),
    counterAlign: figCounterAlignToIR(props.stackCounterAlignItems?.name),
    wrap: props.stackWrap,
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
      // Fall back to MIN for the parent encoding; the per-child stretch
      // is applied at emit time elsewhere.
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
