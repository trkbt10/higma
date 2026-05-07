/**
 * @file FigColor conversion utilities
 *
 * Provides utility functions for working with FigColor (0-1 RGBA range).
 * FigColor is defined in types.ts — this module provides operations on it.
 */

import type { FigColor, FigPaint, FigSolidPaint, FigGradientPaint, FigImagePaint, FigPaintType } from "./types";

// =============================================================================
// Color Predicates
// =============================================================================

/**
 * @deprecated Pure red (#ff0000) is a valid color, not a reliable placeholder
 * indicator. Style resolution (resolveNodeStyleIds) handles stale paint caches
 * before rendering. Do not use this to suppress color output.
 */
export function isPlaceholderColor(color: FigColor): boolean {
  return color.r === 1 && color.g === 0 && color.b === 0;
}

// =============================================================================
// Color Conversion
// =============================================================================

/**
 * Convert Figma color (0-1 range) to CSS hex color
 */
export function figColorToHex(color: FigColor): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/**
 * Convert Figma color to CSS rgba
 */
export function figColorToRgba(color: FigColor): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${color.a})`;
}

/**
 * Parse a CSS hex color (`#RRGGBB`) into a FigColor (0-1 range).
 * The leading `#` is optional. Alpha defaults to 1 when omitted.
 */
export function hexToFigColor(hex: string, alpha = 1): FigColor {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16) / 255,
    g: parseInt(h.substring(2, 4), 16) / 255,
    b: parseInt(h.substring(4, 6), 16) / 255,
    a: alpha,
  };
}

// =============================================================================
// Paint Type Helper
// =============================================================================

/**
 * Get paint type as string.
 */
export function getPaintType(paint: { readonly type: unknown }): FigPaintType {
  const rawType: unknown = paint.type;
  if (isPaintType(rawType)) {
    return rawType;
  }
  if (isKiwiEnumPaintType(rawType)) {
    return rawType.name;
  }
  throw new Error("FigPaint.type must be a supported paint type");
}

/**
 * Extract color from a solid paint. Returns the FigColor if the
 * paint is SOLID, undefined otherwise. Narrowing is via the
 * discriminated union's `type` tag — no cast needed.
 */
export function getSolidPaintColor(paint: FigPaint): FigColor | undefined {
  return asSolidPaint(paint)?.color;
}

// =============================================================================
// Paint Narrowing Helpers (SSoT for FigPaint → variant)
// =============================================================================
//
// FigPaint can carry either parser-normalized string tags or decoded
// Kiwi enum-object tags. These helpers are the named entry points for
// variant access so call sites do not re-derive tag handling.

/**
 * Narrow a paint to `FigGradientPaint` when its type is one of the
 * gradient tags. Returns undefined otherwise.
 */
export function asGradientPaint(paint: FigPaint): FigGradientPaint | undefined {
  switch (getPaintType(paint)) {
    case "GRADIENT_LINEAR":
    case "GRADIENT_RADIAL":
    case "GRADIENT_ANGULAR":
    case "GRADIENT_DIAMOND":
      return paint as FigGradientPaint;
    default:
      return undefined;
  }
}

/**
 * Narrow a paint to `FigImagePaint` when its type is IMAGE.
 * Returns undefined otherwise.
 */
export function asImagePaint(paint: FigPaint): FigImagePaint | undefined {
  if (getPaintType(paint) === "IMAGE") {
    return paint as FigImagePaint;
  }
  return undefined;
}

/**
 * Narrow a paint to `FigSolidPaint` when its type is SOLID.
 * Returns undefined otherwise.
 */
export function asSolidPaint(paint: FigPaint): FigSolidPaint | undefined {
  if (getPaintType(paint) === "SOLID") {
    return paint as FigSolidPaint;
  }
  return undefined;
}

const PAINT_TYPES = [
  "SOLID",
  "GRADIENT_LINEAR",
  "GRADIENT_RADIAL",
  "GRADIENT_ANGULAR",
  "GRADIENT_DIAMOND",
  "IMAGE",
  "EMOJI",
  "VIDEO",
] as const;

function isPaintType(value: unknown): value is FigPaintType {
  return typeof value === "string" && PAINT_TYPES.includes(value as FigPaintType);
}

function isKiwiEnumPaintType(value: unknown): value is { readonly name: FigPaintType } {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (!("name" in value)) {
    return false;
  }
  return isPaintType(value.name);
}
