/**
 * @file Fig-family enum value maps used at the Kiwi roundtrip boundary.
 *
 * Every table is derived from the canonical Figma Kiwi schema in
 * `@higma-figma-schema/profiles`. Hand-written maps drift silently
 * when Figma adds or renumbers enum members (we lived through
 * exactly that with `ImageScaleMode`); deriving them at module load
 * makes a future drift impossible for the names we exercise.
 *
 * Each `requireFigEnumTable` call also asserts that the schema
 * still contains every name the codebase expects — if a future
 * schema update drops one, this module throws at import time so
 * the failure surfaces in the test boot rather than in a corrupt
 * `.fig` payload weeks later.
 *
 */

import { requireFigEnumTable, type FigEnumTable } from "@higma-figma-schema/profiles/schema";

export const FIG_PAINT_TYPE_VALUES: FigEnumTable = requireFigEnumTable("PaintType", [
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
  "GRADIENT_ANGULAR",
  "GRADIENT_DIAMOND",
  "IMAGE",
  "EMOJI",
  "VIDEO",
]);

export const FIG_BLEND_MODE_VALUES: FigEnumTable = requireFigEnumTable("BlendMode", [
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

export const FIG_STROKE_CAP_VALUES: FigEnumTable = requireFigEnumTable("StrokeCap", [
  "NONE",
  "ROUND",
  "SQUARE",
  "ARROW_LINES",
  "ARROW_EQUILATERAL",
]);

export const FIG_STROKE_JOIN_VALUES: FigEnumTable = requireFigEnumTable("StrokeJoin", [
  "MITER",
  "BEVEL",
  "ROUND",
]);

export const FIG_STROKE_ALIGN_VALUES: FigEnumTable = requireFigEnumTable("StrokeAlign", [
  "CENTER",
  "INSIDE",
  "OUTSIDE",
]);

// ImageScaleMode SoT: schema is `0:STRETCH 1:FIT 2:FILL 3:TILE`.
// The repo previously hand-wrote `0:FILL ... 2:STRETCH`, which
// silently corrupted every image paint that round-tripped through
// the encoder. This is now driven from the schema.
export const FIG_IMAGE_SCALE_MODE_VALUES: FigEnumTable = requireFigEnumTable("ImageScaleMode", [
  "STRETCH",
  "FIT",
  "FILL",
  "TILE",
]);

// EffectType SoT: the schema names layer blur as FOREGROUND_BLUR.
export const FIG_EFFECT_TYPE_VALUES: FigEnumTable = requireFigEnumTable("EffectType", [
  "INNER_SHADOW",
  "DROP_SHADOW",
  "FOREGROUND_BLUR",
  "BACKGROUND_BLUR",
]);
