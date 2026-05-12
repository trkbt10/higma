/**
 * @file Generate a horizontal line as a (degenerate) `PathContour`.
 */

import type { PathContour } from "../types";

/**
 * Generate a line contour from `(0, 0)` to `(width, 0)`.
 *
 * Lines have no closed region — the contour is degenerate (no `Z`
 * command). Position and rotation are the caller's responsibility
 * (typically via the host node's transform). Fill never applies; the
 * contour exists so a stroke pipeline can paint along the segment.
 */
export function generateLineContour(width: number): PathContour {
  return {
    commands: [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: width, y: 0 },
    ],
    windingRule: "nonzero",
  };
}
