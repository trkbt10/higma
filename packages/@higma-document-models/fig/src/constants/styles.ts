/**
 * @file Style-related constants for Figma fig format.
 */

import { requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

/** Style type values derived from the Figma Kiwi schema (`StyleType`). */
export const STYLE_TYPE_VALUES = requireFigEnumTable("StyleType", [
  "FILL",
  "STROKE",
  "TEXT",
  "EFFECT",
  "EXPORT",
  "GRID",
]);

export type StyleType =
  | "FILL"
  | "STROKE"
  | "TEXT"
  | "EFFECT"
  | "EXPORT"
  | "GRID";
