/**
 * @file Text-related constants for Figma fig format
 *
 * Numeric enum values are pinned to the canonical Figma Kiwi schema
 * via `@higma-figma-schema/profiles`. The schema is the SoT.
 */

import { requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

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
