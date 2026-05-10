/**
 * @file Paint-related constants for Figma fig format
 *
 * Numeric enum values are pinned to the canonical Figma Kiwi schema
 * via `@higma-figma-schema/profiles`. The schema is the SoT — any
 * member missing from the schema fails fast at module load rather
 * than silently encoding the wrong byte at run time.
 */

import { requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

/** Paint type values — derived from the Figma Kiwi schema (`PaintType`). */
export const PAINT_TYPE_VALUES = requireFigEnumTable("PaintType", [
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
  "GRADIENT_ANGULAR",
  "GRADIENT_DIAMOND",
  "IMAGE",
  "EMOJI",
  "VIDEO",
]);

export type PaintType =
  | "SOLID"
  | "GRADIENT_LINEAR"
  | "GRADIENT_RADIAL"
  | "GRADIENT_ANGULAR"
  | "GRADIENT_DIAMOND"
  | "IMAGE"
  | "EMOJI"
  | "VIDEO";

/** Blend mode values — derived from the Figma Kiwi schema (`BlendMode`). */
export const BLEND_MODE_VALUES = requireFigEnumTable("BlendMode", [
  "PASS_THROUGH",
  "NORMAL",
  "DARKEN",
  "MULTIPLY",
  "LINEAR_BURN",
  "COLOR_BURN",
  "LIGHTEN",
  "SCREEN",
  "LINEAR_DODGE",
  "COLOR_DODGE",
  "OVERLAY",
  "SOFT_LIGHT",
  "HARD_LIGHT",
  "DIFFERENCE",
  "EXCLUSION",
  "HUE",
  "SATURATION",
  "COLOR",
  "LUMINOSITY",
]);

export type BlendMode =
  | "PASS_THROUGH"
  | "NORMAL"
  | "DARKEN"
  | "MULTIPLY"
  | "LINEAR_BURN"
  | "COLOR_BURN"
  | "LIGHTEN"
  | "SCREEN"
  | "LINEAR_DODGE"
  | "COLOR_DODGE"
  | "OVERLAY"
  | "SOFT_LIGHT"
  | "HARD_LIGHT"
  | "DIFFERENCE"
  | "EXCLUSION"
  | "HUE"
  | "SATURATION"
  | "COLOR"
  | "LUMINOSITY";

/**
 * Scale mode values for image fills — schema names only.
 *
 * The Figma binary format only knows STRETCH / FIT / FILL / TILE.
 * `CROP` is a UI-side label that maps to the same `FILL` Kiwi value
 * (both render as `xMidYMid slice`). Domain code that surfaces CROP
 * to humans should call `canonicaliseImageScaleMode()` before
 * handing the value to the encoder.
 */
export const SCALE_MODE_VALUES = requireFigEnumTable("ImageScaleMode", [
  "STRETCH",
  "FIT",
  "FILL",
  "TILE",
]);

export type ScaleMode = "STRETCH" | "FIT" | "FILL" | "TILE";

/**
 * Reduce a wide UI-level scale-mode label to the Figma Kiwi enum.
 *
 * Real Figma exports never carry `CROP` as a discrete value — the
 * schema does not declare one. `CROP` is the editor's UI alias for
 * `FILL` (both crop the image to fit the bounding box). Pass any
 * input through this helper before encoding so encoder bytes always
 * align with what Figma actually parses.
 */
export function canonicaliseImageScaleMode(value: string): ScaleMode {
  if (value === "CROP") {
    return "FILL";
  }
  if (value === "STRETCH" || value === "FIT" || value === "FILL" || value === "TILE") {
    return value;
  }
  throw new Error(`Unsupported imageScaleMode "${value}". Expected STRETCH | FIT | FILL | TILE | CROP.`);
}
