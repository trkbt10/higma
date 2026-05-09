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
import type { AutoLayoutIR } from "../ir/types";

/** Build a Kiwi enum value with the conventional name; value left at 0. */
function kiwiEnum<T extends string>(name: T): KiwiEnumValue<T> {
  return { name, value: 0 };
}

/** Project an IR auto-layout into Figma's `AutoLayoutProps`, or undefined when the layout is `none`. */
export function irAutoLayoutToFig(layout: AutoLayoutIR): AutoLayoutProps | undefined {
  if (layout.direction === "none") {
    return undefined;
  }
  const stackMode = kiwiEnum(layout.direction === "row" ? "HORIZONTAL" : "VERTICAL");
  return {
    stackMode,
    stackSpacing: layout.gap,
    stackPadding: {
      top: layout.paddingTop,
      right: layout.paddingRight,
      bottom: layout.paddingBottom,
      left: layout.paddingLeft,
    },
    stackPrimaryAlignItems: kiwiEnum(primaryAlignToFig(layout.primaryAlign)),
    stackCounterAlignItems: kiwiEnum(counterAlignToFig(layout.counterAlign)),
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

function primaryAlignToFig(align: "start" | "center" | "end" | "space-between"): string {
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

function counterAlignToFig(align: "start" | "center" | "end" | "stretch"): string {
  switch (align) {
    case "start":
      return "MIN";
    case "center":
      return "CENTER";
    case "end":
      return "MAX";
    case "stretch":
      return "STRETCH";
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
