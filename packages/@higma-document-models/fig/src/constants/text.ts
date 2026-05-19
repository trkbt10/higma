/**
 * @file Text-related constants for Figma fig format
 *
 * Numeric enum values are pinned to the canonical Figma Kiwi schema
 * via `@higma-figma-schema/profiles`. The schema is the SoT.
 */

import { kiwiOmittedEnumName, requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

/** Text horizontal alignment values — schema `TextAlignHorizontal`. */
export const TEXT_ALIGN_H_VALUES = requireFigEnumTable("TextAlignHorizontal", [
  "LEFT",
  "CENTER",
  "RIGHT",
  "JUSTIFIED",
]);

export type TextAlignHorizontal = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";

/** Text vertical alignment values — schema `TextAlignVertical`. */
export const TEXT_ALIGN_V_VALUES = requireFigEnumTable("TextAlignVertical", [
  "TOP",
  "CENTER",
  "BOTTOM",
]);

export type TextAlignVertical = "TOP" | "CENTER" | "BOTTOM";

/** Text auto resize values — schema `TextAutoResize`. */
export const TEXT_AUTO_RESIZE_VALUES = requireFigEnumTable("TextAutoResize", [
  "NONE",
  "WIDTH_AND_HEIGHT",
  "HEIGHT",
]);

export type TextAutoResize = "NONE" | "WIDTH_AND_HEIGHT" | "HEIGHT";

/**
 * Default `textAutoResize` name applied when the field is omitted
 * from a Kiwi `MESSAGE` payload. Per schema, this is the enum entry
 * with numeric value 0 — `"NONE"`. Consumers MUST use this constant
 * instead of hard-coding a fallback string; otherwise the consumer
 * silently disagrees with the binary encoding's own semantics.
 *
 * `NONE` means "fixed bounds, wrap inside the authored box" (the
 * opposite of `WIDTH_AND_HEIGHT`, which means "grow to fit content
 * without wrapping"). A downstream renderer that mis-defaults to
 * `WIDTH_AND_HEIGHT` will visibly fail to wrap text that Figma's
 * own renderer wraps.
 */
export const TEXT_AUTO_RESIZE_OMITTED_DEFAULT: TextAutoResize =
  kiwiOmittedEnumName("TextAutoResize", ["NONE", "WIDTH_AND_HEIGHT", "HEIGHT"]);

/** Text decoration values — schema `TextDecoration`. */
export const TEXT_DECORATION_VALUES = requireFigEnumTable("TextDecoration", [
  "NONE",
  "UNDERLINE",
  "STRIKETHROUGH",
]);

export type TextDecoration = "NONE" | "UNDERLINE" | "STRIKETHROUGH";

/** Text case values — schema `TextCase`. */
export const TEXT_CASE_VALUES = requireFigEnumTable("TextCase", [
  "ORIGINAL",
  "UPPER",
  "LOWER",
  "TITLE",
  "SMALL_CAPS",
  "SMALL_CAPS_FORCED",
]);

export type TextCase = "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";

/** Number units values — schema `NumberUnits`. */
export const NUMBER_UNITS_VALUES = requireFigEnumTable("NumberUnits", [
  "RAW",
  "PIXELS",
  "PERCENT",
]);

export type NumberUnits = "RAW" | "PIXELS" | "PERCENT";
