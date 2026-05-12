/**
 * @file Generate a regular polygon as a `PathContour`.
 */

import type { PathCommand, PathContour } from "../types";

/**
 * Generate a regular polygon contour inscribed in the `width × height`
 * bounding box.
 *
 * Vertices are placed on the inscribed ellipse, starting from top
 * centre (-π/2) and going clockwise. `pointCount` is clamped to a
 * minimum of 3 (a triangle is the smallest closed polygon).
 */
export function generatePolygonContour(
  width: number,
  height: number,
  pointCount: number,
): PathContour {
  const n = Math.max(3, pointCount);
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;

  const commands: PathCommand[] = [];

  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
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
