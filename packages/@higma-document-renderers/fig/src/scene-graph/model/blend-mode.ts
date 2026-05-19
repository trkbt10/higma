/**
 * @file Figma blend mode → scene-graph BlendMode conversion.
 *
 * Maps the Figma `BlendMode` enum to the portable scene-graph
 * `BlendMode` token (a subset of CSS `mix-blend-mode` values plus
 * `plus-darker` / `plus-lighter`). Both source enum and destination
 * token live in this package, so the mapping is co-located with both
 * ends — renderers consume it directly.
 *
 * `NORMAL`, `PASS_THROUGH`, and any enum member without a defined
 * mapping return `undefined`; the `Partial<Record<…>>` keeps the
 * Figma enum as the exhaustive source.
 */

import { kiwiEnumName } from "@higma-document-models/fig/constants";
import type { BlendMode as FigBlendMode, KiwiEnumValue } from "@higma-document-models/fig/types";
import type { BlendMode } from "./types";

const FIGMA_BLEND_MODE_TO_SCENE: Partial<Record<FigBlendMode, BlendMode>> = {
  DARKEN: "darken",
  MULTIPLY: "multiply",
  LINEAR_BURN: "plus-darker",
  COLOR_BURN: "color-burn",
  LIGHTEN: "lighten",
  SCREEN: "screen",
  LINEAR_DODGE: "plus-lighter",
  COLOR_DODGE: "color-dodge",
  OVERLAY: "overlay",
  SOFT_LIGHT: "soft-light",
  HARD_LIGHT: "hard-light",
  DIFFERENCE: "difference",
  EXCLUSION: "exclusion",
  HUE: "hue",
  SATURATION: "saturation",
  COLOR: "color",
  LUMINOSITY: "luminosity",
};

export function convertFigmaBlendMode(
  blendMode: FigBlendMode | KiwiEnumValue<FigBlendMode> | undefined,
): BlendMode | undefined {
  const name = kiwiEnumName<FigBlendMode>(blendMode, "BlendMode");
  if (name === undefined) { return undefined; }
  return FIGMA_BLEND_MODE_TO_SCENE[name];
}
