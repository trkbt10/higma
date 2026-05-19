/**
 * @file Effect-related constants for Figma fig format
 *
 * Numeric enum values are pinned to the canonical Figma Kiwi schema
 * via `@higma-figma-schema/profiles`. The schema is the SoT.
 */

import { requireFigEnumTable } from "@higma-figma-schema/profiles/schema";

/**
 * Effect type values — derived from the Figma Kiwi schema (`EffectType`).
 *
 * Figma's schema labels the layer-blur effect `FOREGROUND_BLUR`.
 */
export const EFFECT_TYPE_VALUES = requireFigEnumTable("EffectType", [
  "INNER_SHADOW",
  "DROP_SHADOW",
  "FOREGROUND_BLUR",
  "BACKGROUND_BLUR",
]);

export type EffectType = "INNER_SHADOW" | "DROP_SHADOW" | "FOREGROUND_BLUR" | "BACKGROUND_BLUR";
