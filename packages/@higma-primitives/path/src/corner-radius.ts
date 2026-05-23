/**
 * @file Corner-radius normalisation helpers. Shared SoT across SVG,
 * WebGL, React, and code-emitting tools.
 */

import type { CornerRadius } from "./types";

/** Clamp a corner radius to a rectangle's geometric maximum. */
export function clampCornerRadius(
  radius: CornerRadius | undefined,
  width: number,
  height: number,
): CornerRadius | undefined {
  if (radius === undefined) { return undefined; }
  const max = Math.min(width, height) / 2;
  if (typeof radius === "number" && radius <= 0) { return undefined; }
  if (typeof radius === "number") { return Math.min(radius, max); }
  const clamped: readonly [number, number, number, number] = [
    Math.min(radius[0], max),
    Math.min(radius[1], max),
    Math.min(radius[2], max),
    Math.min(radius[3], max),
  ];
  if (clamped[0] === 0 && clamped[1] === 0 && clamped[2] === 0 && clamped[3] === 0) { return undefined; }
  return clamped;
}

/** Return a scalar corner radius for effects that only need the maximum radius. */
export function cornerRadiusScalar(radius: CornerRadius | undefined): number {
  if (typeof radius === "number") { return radius; }
  if (radius) {
    return Math.max(radius[0], radius[1], radius[2], radius[3]);
  }
  return 0;
}
