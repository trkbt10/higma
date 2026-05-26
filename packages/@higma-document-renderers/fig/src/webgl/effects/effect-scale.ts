/**
 * @file SoT for the world→backing-pixel scale that effect shaders need.
 *
 * FBO-based effects (drop shadow, inner shadow, layer blur, background
 * blur) render the silhouette into a backing-buffer-sized framebuffer
 * with the full world transform applied, then post-process it in
 * texCoord space using uniforms expressed in **backing-buffer pixels**:
 *
 *   - radius / spread (scalar) — Gaussian blur radius, alpha-morphology
 *     spread in pixels
 *   - offset (vector) — drop / inner shadow displacement in pixels
 *
 * The source data on the effect is in **world units** (Figma document
 * coordinates). Two conversions stack between those two spaces:
 *
 *   1. world → screen (CSS pixels) — the composed world transform
 *      `m00..m11`. Viewport zoom and any per-node scale/rotation are
 *      already baked into this matrix at the render call site.
 *   2. screen → backing buffer — `pixelRatio` (devicePixelRatio with
 *      higma's zoom-aware policy).
 *
 * Multiplying only by `pixelRatio` — as the effects renderer used to —
 * silently drops the world→screen factor, so at viewport zoom 200% a
 * drop shadow's offset and blur radius stay at their 100%-zoom
 * backing-pixel size while the shape itself doubles. The shadow then
 * detaches from the shape's apparent geometry as the user zooms.
 *
 * This module exposes the resolved scale as a single value object so
 * callers (and tests) cannot reintroduce the mix-up: the effect
 * renderer consumes `EffectBackingScale` and never sees `pixelRatio`
 * directly for these conversions.
 */

import type { AffineMatrix } from "@higma-primitives/path";

/**
 * Scale factors from world units to backing-buffer pixels for FBO
 * effect shaders. `pixelRatio` is already folded in — consumers must
 * NOT multiply by it again.
 *
 * - Scalar lengths (radius, spread) → `value * lengthScale`.
 * - Offset vectors → apply the 2×2 linear part:
 *     backing.x = m00·Ox + m01·Oy
 *     backing.y = m10·Ox + m11·Oy
 *   See `applyEffectOffsetScale`.
 */
export type EffectBackingScale = {
  /**
   * Uniform length scale (world unit → backing pixel) for radii / spreads.
   * `sqrt(|det|)` of the linear part, so it equals `|m00|` for uniform
   * scaling and stays well-defined under rotation/skew (area-preserving
   * magnification — the visual size that a small disk of radius 1
   * occupies after the transform).
   */
  readonly lengthScale: number;
  readonly m00: number;
  readonly m01: number;
  readonly m10: number;
  readonly m11: number;
};

/**
 * Resolve the effect backing scale for a node at `transform` rendered
 * into a canvas with `pixelRatio`.
 */
export function resolveEffectBackingScale(
  transform: AffineMatrix,
  pixelRatio: number,
): EffectBackingScale {
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new Error(`Effect backing scale pixelRatio must be finite and positive, got ${pixelRatio}`);
  }
  if (
    !Number.isFinite(transform.m00) ||
    !Number.isFinite(transform.m01) ||
    !Number.isFinite(transform.m10) ||
    !Number.isFinite(transform.m11)
  ) {
    throw new Error("Effect backing scale transform linear components must be finite");
  }
  const det = Math.abs(transform.m00 * transform.m11 - transform.m01 * transform.m10);
  return {
    lengthScale: Math.sqrt(det) * pixelRatio,
    m00: transform.m00 * pixelRatio,
    m01: transform.m01 * pixelRatio,
    m10: transform.m10 * pixelRatio,
    m11: transform.m11 * pixelRatio,
  };
}

/**
 * Apply the linear part of `scale` to a world-space offset vector,
 * returning the offset in backing-buffer pixels.
 */
export function applyEffectOffsetScale(
  scale: EffectBackingScale,
  ox: number,
  oy: number,
): { readonly x: number; readonly y: number } {
  return {
    x: scale.m00 * ox + scale.m01 * oy,
    y: scale.m10 * ox + scale.m11 * oy,
  };
}
