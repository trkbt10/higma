/**
 * @file Figma BlendMode ↔ IR blend-mode conversion.
 *
 * The IR uses CSS `mix-blend-mode` keyword names verbatim. Figma's
 * BlendMode enum uses uppercase / underscored names with a couple of
 * extras (`PASS_THROUGH`, `LINEAR_BURN`, `LINEAR_DODGE`). We map the
 * extras to their CSS equivalent (`PASS_THROUGH` → `normal`,
 * `LINEAR_BURN` → `plus-darker` for fig-to-web parity), then back to
 * the closest Figma name on the inverse leg.
 */
import type { BlendMode } from "@higma-document-models/fig/types";
import type { StyleIR } from "../ir/types";

type IRBlendMode = StyleIR["blendMode"];

/** Translate Figma's BlendMode enum to the IR's CSS `mix-blend-mode` keywords. */
export function figBlendModeToIR(mode: BlendMode | undefined): IRBlendMode {
  if (mode === undefined) {
    return "normal";
  }
  switch (mode) {
    case "PASS_THROUGH":
    case "NORMAL":
      return "normal";
    case "MULTIPLY":
      return "multiply";
    case "SCREEN":
      return "screen";
    case "OVERLAY":
      return "overlay";
    case "DARKEN":
      return "darken";
    case "LIGHTEN":
      return "lighten";
    case "COLOR_DODGE":
      return "color-dodge";
    case "COLOR_BURN":
      return "color-burn";
    case "HARD_LIGHT":
      return "hard-light";
    case "SOFT_LIGHT":
      return "soft-light";
    case "DIFFERENCE":
      return "difference";
    case "EXCLUSION":
      return "exclusion";
    case "HUE":
      return "hue";
    case "SATURATION":
      return "saturation";
    case "COLOR":
      return "color";
    case "LUMINOSITY":
      return "luminosity";
    case "LINEAR_BURN":
    case "LINEAR_DODGE":
      // CSS has no first-class match; round-trip explicitly to `normal`
      // and let the caller emit a custom shader if it really cares.
      // Throwing would derail benign documents that include these as
      // implicit defaults; the IR doesn't claim to round-trip them.
      return "normal";
  }
}

/** Inverse of `figBlendModeToIR` — IR keyword → Figma BlendMode enum. */
export function irBlendModeToFig(mode: IRBlendMode): BlendMode {
  switch (mode) {
    case "normal":
      return "NORMAL";
    case "multiply":
      return "MULTIPLY";
    case "screen":
      return "SCREEN";
    case "overlay":
      return "OVERLAY";
    case "darken":
      return "DARKEN";
    case "lighten":
      return "LIGHTEN";
    case "color-dodge":
      return "COLOR_DODGE";
    case "color-burn":
      return "COLOR_BURN";
    case "hard-light":
      return "HARD_LIGHT";
    case "soft-light":
      return "SOFT_LIGHT";
    case "difference":
      return "DIFFERENCE";
    case "exclusion":
      return "EXCLUSION";
    case "hue":
      return "HUE";
    case "saturation":
      return "SATURATION";
    case "color":
      return "COLOR";
    case "luminosity":
      return "LUMINOSITY";
  }
}
