/**
 * @file Figma blend mode → scene-graph BlendMode conversion.
 *
 * Maps the Figma `BlendMode` enum to the portable scene-graph
 * `BlendMode` token (a subset of CSS `mix-blend-mode` values plus
 * `plus-darker` / `plus-lighter`). The source enum and destination
 * token are co-located here because this file is the renderer-side SoT
 * for projecting Kiwi blend enum values into renderable blend tokens.
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

/**
 * Convert the blend enum carried by `FigNode.blendMode`.
 *
 * Figma's SVG exporter applies `SOFT_LIGHT` when it is carried by a
 * paint/effect layer, but not when it is carried by the node itself.
 * The iOS App Store template's official export proves the distinction:
 * node 2307:33706 (`ROUNDED_RECTANGLE`, "Rectangle 14") has
 * `FigNode.blendMode = SOFT_LIGHT`, while the exported SVG writes the
 * layer as a plain white `<rect>` with no `mix-blend-mode`. Keeping the
 * node path separate from paint/effect conversion prevents that Kiwi
 * node metadata from becoming a second, conflicting paint SoT.
 */
export function convertFigmaNodeBlendMode(
  blendMode: FigBlendMode | KiwiEnumValue<FigBlendMode> | undefined,
): BlendMode | undefined {
  const name = kiwiEnumName<FigBlendMode>(blendMode, "BlendMode");
  if (name === undefined || name === "SOFT_LIGHT") { return undefined; }
  return FIGMA_BLEND_MODE_TO_SCENE[name];
}
