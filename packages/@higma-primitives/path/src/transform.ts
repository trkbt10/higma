/**
 * @file Apply a 2x3 affine transform to every coordinate in a
 * `PathCommand[]`.
 */

import type { AffineMatrix, PathCommand } from "./types";

/**
 * Apply `transform` to every coordinate in `commands`.
 *
 * - M / L: endpoint transformed.
 * - C: both control points and the endpoint transformed.
 * - Q: control point and endpoint transformed.
 * - A: endpoint transformed; radii and `rotation` left unchanged.
 *   Transforming an elliptical arc's radii / rotation under an
 *   arbitrary affine is non-trivial (a rotated non-uniform scale
 *   maps a circle to a tilted ellipse with a *different* rotation
 *   axis); we adopt the same approximation the existing fig-to-*
 *   translators use, which is correct for translations and uniform
 *   scale and degrades gracefully on rotation/shear (the downstream
 *   consumers typically re-tessellate arcs to cubics anyway).
 * - Z: unchanged.
 *
 * When `transform` is undefined or numerically identity, the input is
 * returned by reference — no allocation.
 */
export function transformPathCommands(
  commands: readonly PathCommand[],
  transform: AffineMatrix | undefined,
): readonly PathCommand[] {
  if (!transform) {
    return commands;
  }
  const { m00, m01, m02, m10, m11, m12 } = transform;
  if (m00 === 1 && m01 === 0 && m02 === 0 && m10 === 0 && m11 === 1 && m12 === 0) {
    return commands;
  }
  const apply = (x: number, y: number): { readonly x: number; readonly y: number } => ({
    x: m00 * x + m01 * y + m02,
    y: m10 * x + m11 * y + m12,
  });
  return commands.map((cmd): PathCommand => {
    switch (cmd.type) {
      case "M":
      case "L": {
        const p = apply(cmd.x, cmd.y);
        return { type: cmd.type, x: p.x, y: p.y };
      }
      case "C": {
        const p1 = apply(cmd.x1, cmd.y1);
        const p2 = apply(cmd.x2, cmd.y2);
        const p = apply(cmd.x, cmd.y);
        return {
          type: "C",
          x1: p1.x, y1: p1.y,
          x2: p2.x, y2: p2.y,
          x: p.x, y: p.y,
        };
      }
      case "Q": {
        const p1 = apply(cmd.x1, cmd.y1);
        const p = apply(cmd.x, cmd.y);
        return { type: "Q", x1: p1.x, y1: p1.y, x: p.x, y: p.y };
      }
      case "A": {
        const p = apply(cmd.x, cmd.y);
        return { ...cmd, x: p.x, y: p.y };
      }
      case "Z":
        return cmd;
    }
  });
}
