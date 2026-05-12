/**
 * @file Image paint filter transfer functions shared by SVG and WebGL.
 *
 * Pure RGB-channel transforms parameterised by Figma's `ImagePaintFilter`
 * field set. Outputs:
 *
 *  - `ImagePaintFilterUniforms` — the resolved (no-undefined) parameter
 *    bag consumed by WebGL shaders.
 *  - SVG `feComponentTransfer` lookup tables (one per RGB channel) plus
 *    a saturation multiplier consumed by `feColorMatrix`.
 *
 * Codec-layer module: contains the math only. The renderer maps the
 * resolved uniforms onto WebGL shader inputs / SVG filter primitives.
 */

import type { ImagePaintFilter, Rgb } from "./types";

export type ImagePaintFilterUniforms = {
  readonly exposure: number;
  readonly contrast: number;
  readonly brightness: number;
  readonly temperature: number;
  readonly tint: number;
  readonly saturation: number;
  readonly vibrance: number;
};

export const IDENTITY_IMAGE_PAINT_FILTER_UNIFORMS: ImagePaintFilterUniforms = {
  exposure: 0,
  contrast: 0,
  brightness: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
};

const TABLE_SAMPLE_COUNT = 64;
const SRGB_TRANSFER_EXPONENT = 2.4;
const SUPPORTED_FILTER_KEYS = [
  "exposure",
  "contrast",
  "brightness",
  "temperature",
  "tint",
  "saturation",
  "vibrance",
] as const;
const UNSUPPORTED_FILTER_KEYS = ["shadows", "highlights", "detail", "vignette"] as const;
const KNOWN_FILTER_KEYS = [...SUPPORTED_FILTER_KEYS, ...UNSUPPORTED_FILTER_KEYS] as const;

type KnownFilterKey = typeof KNOWN_FILTER_KEYS[number];

function isKnownFilterKey(key: string): key is KnownFilterKey {
  return KNOWN_FILTER_KEYS.includes(key as KnownFilterKey);
}

function isUnsupportedFilterKey(key: KnownFilterKey): key is typeof UNSUPPORTED_FILTER_KEYS[number] {
  return UNSUPPORTED_FILTER_KEYS.includes(key as typeof UNSUPPORTED_FILTER_KEYS[number]);
}

function valueOrZero(value: number | undefined): number {
  return value ?? 0;
}

/** Validate image filter fields before either backend applies them. */
export function assertImagePaintFilterSupported(filter: ImagePaintFilter | undefined): void {
  if (!filter) {
    return;
  }
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) {
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`IMAGE paintFilter.${key} requires a finite numeric value`);
    }
    if (!isKnownFilterKey(key)) {
      throw new Error(`IMAGE paintFilter.${key} is not supported by the renderer`);
    }
    if (isUnsupportedFilterKey(key) && value !== 0) {
      throw new Error(`IMAGE paintFilter.${key} is not supported by the renderer`);
    }
  }
}

function isSupportedVisibleAdjustment(key: string, value: number): boolean {
  return SUPPORTED_FILTER_KEYS.includes(key as typeof SUPPORTED_FILTER_KEYS[number]) && value !== 0;
}

/** Return true when at least one image filter field has a visible adjustment. */
export function hasImagePaintFilter(filter: ImagePaintFilter | undefined): filter is ImagePaintFilter {
  if (!filter) {
    return false;
  }
  assertImagePaintFilterSupported(filter);
  return Object.entries(filter).some(([key, value]) => isSupportedVisibleAdjustment(key, value ?? 0));
}

/** Convert optional image filter fields into the complete WebGL uniform set. */
export function resolveImagePaintFilterUniforms(filter: ImagePaintFilter | undefined): ImagePaintFilterUniforms {
  if (!filter) {
    return IDENTITY_IMAGE_PAINT_FILTER_UNIFORMS;
  }
  assertImagePaintFilterSupported(filter);
  return {
    exposure: valueOrZero(filter.exposure),
    contrast: valueOrZero(filter.contrast),
    brightness: valueOrZero(filter.brightness),
    temperature: valueOrZero(filter.temperature),
    tint: valueOrZero(filter.tint),
    saturation: valueOrZero(filter.saturation),
    vibrance: valueOrZero(filter.vibrance),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function decodeSrgb(value: number): number {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return Math.pow((value + 0.055) / 1.055, SRGB_TRANSFER_EXPONENT);
}

function encodeSrgb(value: number): number {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * Math.pow(value, 1 / SRGB_TRANSFER_EXPONENT) - 0.055;
}

function linearSrgbLuminance(color: Rgb): number {
  return encodeSrgb(
    0.2126 * decodeSrgb(color.r)
      + 0.7152 * decodeSrgb(color.g)
      + 0.0722 * decodeSrgb(color.b),
  );
}

function contrastTransfer(channel: number, amount: number): number {
  return (channel - 0.5) * (1 + amount) + 0.5;
}

function exposureTransfer(channel: number, amount: number): number {
  return channel * Math.pow(2, amount);
}

function channelTemperatureOffset(channel: "r" | "g" | "b", uniforms: ImagePaintFilterUniforms): number {
  if (channel === "r") {
    return uniforms.temperature * 0.08;
  }
  if (channel === "g") {
    return uniforms.tint * 0.08;
  }
  return uniforms.temperature * -0.08;
}

function transferChannel(value: number, uniforms: ImagePaintFilterUniforms): number {
  const exposed = exposureTransfer(value, uniforms.exposure);
  const brightened = exposed + uniforms.brightness;
  return contrastTransfer(brightened, uniforms.contrast);
}

/** Apply the shared image paint-filter transfer to one normalized RGB sample. */
export function applyImagePaintFilterToRgb(color: Rgb, filter: ImagePaintFilter): Rgb {
  const uniforms = resolveImagePaintFilterUniforms(filter);
  const gray = linearSrgbLuminance(color);
  const saturation = 1 + uniforms.saturation + uniforms.vibrance;
  const saturated = {
    r: gray + (color.r - gray) * saturation,
    g: gray + (color.g - gray) * saturation,
    b: gray + (color.b - gray) * saturation,
  };
  const channelAdjusted = {
    r: transferChannel(saturated.r, uniforms),
    g: transferChannel(saturated.g, uniforms),
    b: transferChannel(saturated.b, uniforms),
  };
  return {
    r: clamp01(channelAdjusted.r + channelTemperatureOffset("r", uniforms)),
    g: clamp01(channelAdjusted.g + channelTemperatureOffset("g", uniforms)),
    b: clamp01(channelAdjusted.b + channelTemperatureOffset("b", uniforms)),
  };
}

function formatTableValue(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function createChannelTable(channel: "r" | "g" | "b", uniforms: ImagePaintFilterUniforms): string {
  return Array.from({ length: TABLE_SAMPLE_COUNT }, (_value, index) => {
    const sample = index / (TABLE_SAMPLE_COUNT - 1);
    const base = transferChannel(sample, uniforms);
    return formatTableValue(clamp01(base + channelTemperatureOffset(channel, uniforms)));
  }).join(" ");
}

/** Build SVG component-transfer lookup tables from an image paint filter. */
export function createImagePaintFilterTables(filter: ImagePaintFilter): {
  readonly red: string;
  readonly green: string;
  readonly blue: string;
  readonly saturation: number;
} {
  const uniforms = resolveImagePaintFilterUniforms(filter);
  return {
    red: createChannelTable("r", uniforms),
    green: createChannelTable("g", uniforms),
    blue: createChannelTable("b", uniforms),
    saturation: 1 + uniforms.saturation + uniforms.vibrance,
  };
}
