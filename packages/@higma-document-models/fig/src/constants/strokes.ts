/**
 * @file Stroke-related constants for Figma fig format
 *
 * Numeric enum values are pinned to the canonical Figma Kiwi schema
 * via `@higma-figma-schema/profiles`. The schema is the SoT.
 */

import { requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

/**
 * Stroke cap values — derived from the Figma Kiwi schema (`StrokeCap`).
 *
 * The schema declares additional FigJam-specific shapes (DIAMOND_FILLED,
 * TRIANGLE_FILLED, HIGHLIGHT, WASHI_TAPE_*, CIRCLE_FILLED, ERD_*). They
 * are not surfaced through this constant because the design-product
 * builders here do not emit them; if a real file carries those caps we
 * read them as raw `{value, name}` pairs and write them back unchanged
 * via the runtime layer.
 */
export const STROKE_CAP_VALUES = requireFigEnumTable("StrokeCap", [
  "NONE",
  "ROUND",
  "SQUARE",
  "ARROW_LINES",
  "ARROW_EQUILATERAL",
]);

export type StrokeCap = "NONE" | "ROUND" | "SQUARE" | "ARROW_LINES" | "ARROW_EQUILATERAL";

/** Stroke join values — derived from the Figma Kiwi schema (`StrokeJoin`). */
export const STROKE_JOIN_VALUES = requireFigEnumTable("StrokeJoin", [
  "MITER",
  "BEVEL",
  "ROUND",
]);

export type StrokeJoin = "MITER" | "BEVEL" | "ROUND";

/** Stroke align values — derived from the Figma Kiwi schema (`StrokeAlign`). */
export const STROKE_ALIGN_VALUES = requireFigEnumTable("StrokeAlign", [
  "CENTER",
  "INSIDE",
  "OUTSIDE",
]);

export type StrokeAlign = "CENTER" | "INSIDE" | "OUTSIDE";
