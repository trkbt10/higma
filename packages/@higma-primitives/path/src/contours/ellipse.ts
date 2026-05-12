/**
 * @file Generate an ellipse as a `PathContour` using four cubic
 * Béziers (one per quadrant).
 */

import type { PathContour } from "../types";
import { KAPPA } from "./rect";

/**
 * Generate an ellipse contour inscribed in the `width × height`
 * bounding box. Uses the classical four-cubic approximation with the
 * `KAPPA` control-point ratio for ~0.027% peak deviation from a true
 * ellipse.
 */
export function generateEllipseContour(width: number, height: number): PathContour {
  const rx = width / 2;
  const ry = height / 2;
  const cx = rx;
  const cy = ry;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return {
    commands: [
      { type: "M", x: cx, y: 0 },
      { type: "C", x1: cx + ox, y1: 0, x2: width, y2: cy - oy, x: width, y: cy },
      { type: "C", x1: width, y1: cy + oy, x2: cx + ox, y2: height, x: cx, y: height },
      { type: "C", x1: cx - ox, y1: height, x2: 0, y2: cy + oy, x: 0, y: cy },
      { type: "C", x1: 0, y1: cy - oy, x2: cx - ox, y2: 0, x: cx, y: 0 },
      { type: "Z" },
    ],
    windingRule: "nonzero",
  };
}
