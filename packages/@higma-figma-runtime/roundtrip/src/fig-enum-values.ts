/**
 * @file Fig-family enum value maps used at the Kiwi roundtrip boundary.
 */

export const FIG_PAINT_TYPE_VALUES: Readonly<Record<string, number>> = {
  SOLID: 0,
  GRADIENT_LINEAR: 1,
  GRADIENT_RADIAL: 2,
  GRADIENT_ANGULAR: 3,
  GRADIENT_DIAMOND: 4,
  IMAGE: 5,
  EMOJI: 6,
  VIDEO: 7,
};

export const FIG_BLEND_MODE_VALUES: Readonly<Record<string, number>> = {
  PASS_THROUGH: 0,
  NORMAL: 1,
  DARKEN: 2,
  MULTIPLY: 3,
  LINEAR_BURN: 4,
  COLOR_BURN: 5,
  LIGHTEN: 6,
  SCREEN: 7,
  LINEAR_DODGE: 8,
  COLOR_DODGE: 9,
  OVERLAY: 10,
  SOFT_LIGHT: 11,
  HARD_LIGHT: 12,
  DIFFERENCE: 13,
  EXCLUSION: 14,
  HUE: 15,
  SATURATION: 16,
  COLOR: 17,
  LUMINOSITY: 18,
};

export const FIG_STROKE_CAP_VALUES: Readonly<Record<string, number>> = {
  NONE: 0,
  ROUND: 1,
  SQUARE: 2,
  ARROW_LINES: 3,
  ARROW_EQUILATERAL: 4,
};

export const FIG_STROKE_JOIN_VALUES: Readonly<Record<string, number>> = {
  MITER: 0,
  BEVEL: 1,
  ROUND: 2,
};

export const FIG_STROKE_ALIGN_VALUES: Readonly<Record<string, number>> = {
  CENTER: 0,
  INSIDE: 1,
  OUTSIDE: 2,
};

export const FIG_IMAGE_SCALE_MODE_VALUES: Readonly<Record<string, number>> = {
  FILL: 0,
  FIT: 1,
  STRETCH: 2,
  TILE: 3,
  CROP: 4,
};

export const FIG_EFFECT_TYPE_VALUES: Readonly<Record<string, number>> = {
  INNER_SHADOW: 0,
  DROP_SHADOW: 1,
  LAYER_BLUR: 2,
  FOREGROUND_BLUR: 2,
  BACKGROUND_BLUR: 3,
};
