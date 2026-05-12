/**
 * @file Generate a star (alternating outer/inner radii) as a
 * `PathContour`.
 */

import type { PathCommand, PathContour } from "../types";

/** Options for `generateStarContour`. */
export type GenerateStarContourOptions = {
  readonly width: number;
  readonly height: number;
  readonly pointCount: number;
  /**
   * Inner radius as a ratio (0..1) of the outer radius. Matches
   * Figma's `starInnerRadius` / `starInnerScale` field. Default
   * `0.382` (the golden-ratio reciprocal — Figma's default
   * 5-point-star inner radius).
   */
  readonly innerRadiusRatio?: number;
};

/**
 * Generate a star contour inscribed in the `width × height` bounding
 * box. Alternates outer-radius and inner-radius vertices around the
 * inscribed ellipse, starting from top centre (-π/2) and going
 * clockwise. `pointCount` is clamped to a minimum of 3.
 */
export function generateStarContour({
  width,
  height,
  pointCount,
  innerRadiusRatio = 0.382,
}: GenerateStarContourOptions): PathContour {
  const n = Math.max(3, pointCount);
  const cx = width / 2;
  const cy = height / 2;
  const outerRx = width / 2;
  const outerRy = height / 2;
  const innerRx = outerRx * innerRadiusRatio;
  const innerRy = outerRy * innerRadiusRatio;

  const commands: PathCommand[] = [];
  const totalVertices = n * 2;

  for (let i = 0; i < totalVertices; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / totalVertices;
    const isOuter = i % 2 === 0;
    const rx = isOuter ? outerRx : innerRx;
    const ry = isOuter ? outerRy : innerRy;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    if (i === 0) {
      commands.push({ type: "M", x, y });
    } else {
      commands.push({ type: "L", x, y });
    }
  }

  commands.push({ type: "Z" });

  return { commands, windingRule: "nonzero" };
}
