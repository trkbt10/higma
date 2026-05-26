/**
 * @file Browser-rendered Figma SVG blend-mode projection.
 *
 * Kiwi/Figma blend enums are converted to SceneGraph `BlendMode` tokens in
 * scene-graph/model/blend-mode.ts. This file owns the next boundary: projecting
 * those tokens onto the CSS `mix-blend-mode` surface that browser-rendered
 * Figma SVG exports actually use.
 */

import type { BlendMode } from "../model";

export type BrowserRenderedFigmaExportCssBlendMode = Exclude<BlendMode, "plus-darker">;

/**
 * Resolve a SceneGraph blend token to the browser-computed CSS blend token used
 * by Figma SVG export rendering.
 *
 * Chromium currently computes `mix-blend-mode: plus-darker` as `normal`
 * (`CSS.supports("mix-blend-mode", "plus-darker") === false`). The SVG/CSS
 * formatter omits the style for that normal projection, while WebGL maps the
 * same projection to shader blend code 0.
 */
export function resolveBrowserRenderedFigmaExportCssBlendMode(
  blendMode: BlendMode | undefined,
): BrowserRenderedFigmaExportCssBlendMode | undefined {
  if (blendMode === undefined) {
    return undefined;
  }
  switch (blendMode) {
    case "multiply":
    case "screen":
    case "darken":
    case "lighten":
    case "overlay":
    case "color-dodge":
    case "color-burn":
    case "hard-light":
    case "soft-light":
    case "difference":
    case "exclusion":
    case "hue":
    case "saturation":
    case "color":
    case "luminosity":
    case "plus-lighter":
      return blendMode;
    case "plus-darker":
      return undefined;
  }
}
