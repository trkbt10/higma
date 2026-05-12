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

import type { BlendMode as FigBlendMode, KiwiEnumValue } from "../types";
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
  if (!blendMode) { return undefined; }
  if (typeof blendMode === "string") {
    return FIGMA_BLEND_MODE_TO_SCENE[blendMode];
  }
  return FIGMA_BLEND_MODE_TO_SCENE[blendMode.name];
}
