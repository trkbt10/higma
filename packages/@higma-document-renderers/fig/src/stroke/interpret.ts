/**
 * @file Stroke interpretation — shared SoT
 *
 * Pure functions that interpret Figma stroke properties into
 * platform-agnostic intermediate values. Both the SVG string renderer
 * and the SceneGraph builder consume these.
 *
 * Consumes decoded Kiwi enum payloads.
 */

import type { FigStrokeWeight, FigStrokeCap, FigStrokeJoin, KiwiEnumValue } from "@higma-document-models/fig/types";
import { kiwiEnumName } from "@higma-document-models/fig/constants";

// =============================================================================
// Stroke Weight
// =============================================================================

/**
 * Resolve a Figma stroke weight to a single numeric value.
 *
 * Figma supports per-side stroke weights ({ top, right, bottom, left }).
 * When per-side weights are provided, the maximum is used because SVG
 * and most raster backends apply a uniform stroke width.
 */
export function resolveStrokeWeight(strokeWeight: FigStrokeWeight | undefined): number {
  if (strokeWeight === undefined) {return 0;}
  if (typeof strokeWeight === "number") {return strokeWeight;}
  return Math.max(strokeWeight.top ?? 0, strokeWeight.right ?? 0, strokeWeight.bottom ?? 0, strokeWeight.left ?? 0);
}

// =============================================================================
// Stroke Cap
// =============================================================================

export type SvgStrokeCap = "butt" | "round" | "square";

/**
 * Map Figma stroke cap to SVG linecap value.
 *
 * Arrow caps (ARROW_LINES, ARROW_EQUILATERAL) fall back to "butt" —
 * arrow markers require separate SVG marker definitions not handled here.
 */
function enumName<T extends string>(value: KiwiEnumValue<T> | undefined | null): T | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const name = kiwiEnumName<T>(value, "stroke enum");
  if (name === undefined) {
    throw new Error("stroke enum was present but resolved to undefined");
  }
  return name;
}

export function mapStrokeCap(cap: KiwiEnumValue<FigStrokeCap> | undefined | null): SvgStrokeCap {
  switch (enumName(cap)) {
    case "ROUND":
      return "round";
    case "SQUARE":
      return "square";
    case "NONE":
    case "ARROW_LINES":
    case "ARROW_EQUILATERAL":
    default:
      return "butt";
  }
}

// =============================================================================
// Stroke Join
// =============================================================================

export type SvgStrokeJoin = "miter" | "round" | "bevel";

/**
 * Map Figma stroke join to SVG linejoin value.
 * Default is "miter" (SVG default and Figma default).
 */
export function mapStrokeJoin(join: KiwiEnumValue<FigStrokeJoin> | undefined | null): SvgStrokeJoin {
  switch (enumName(join)) {
    case "ROUND":
      return "round";
    case "BEVEL":
      return "bevel";
    case "MITER":
    default:
      return "miter";
  }
}
