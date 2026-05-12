/**
 * @file Generate a rectangle (with optional rounded corners) as a
 * `PathContour`.
 */

import type { CornerRadius, PathContour } from "../types";

/**
 * `KAPPA = 4·(√2−1)/3` — the cubic-Bézier control-point ratio that
 * approximates a quarter-circle to within ~0.027% of the exact arc.
 * Used by every primitive contour generator that needs a circular
 * arc segment.
 */
export const KAPPA = 0.5522847498307936;

/**
 * Generate a rectangle contour. Pass `cornerRadius` to round corners
 * — either a uniform scalar or a 4-tuple `[tl, tr, br, bl]`.
 *
 * Sharp-cornered rectangles emit four `L` segments + `Z`. Rounded
 * rectangles emit an `M / L / C / L / C / L / C / L / C / Z` cycle
 * with one cubic Bézier per corner.
 */
export function generateRectContour(
  width: number,
  height: number,
  cornerRadius?: CornerRadius,
): PathContour {
  const [tl, tr, br, bl] = resolveCornerRadii(cornerRadius);
  if (tl === 0 && tr === 0 && br === 0 && bl === 0) {
    return {
      commands: [
        { type: "M", x: 0, y: 0 },
        { type: "L", x: width, y: 0 },
        { type: "L", x: width, y: height },
        { type: "L", x: 0, y: height },
        { type: "Z" },
      ],
      windingRule: "nonzero",
    };
  }
  return generateRoundedRectContour({
    width,
    height,
    topLeft: tl,
    topRight: tr,
    bottomRight: br,
    bottomLeft: bl,
  });
}

type GenerateRoundedRectContourOptions = {
  readonly width: number;
  readonly height: number;
  readonly topLeft: number;
  readonly topRight: number;
  readonly bottomRight: number;
  readonly bottomLeft: number;
};

function generateRoundedRectContour({
  width,
  height,
  topLeft,
  topRight,
  bottomRight,
  bottomLeft,
}: GenerateRoundedRectContourOptions): PathContour {
  const tl = clampRadius(topLeft, width, height);
  const tr = clampRadius(topRight, width, height);
  const br = clampRadius(bottomRight, width, height);
  const bl = clampRadius(bottomLeft, width, height);
  const ctl = tl * KAPPA;
  const ctr = tr * KAPPA;
  const cbr = br * KAPPA;
  const cbl = bl * KAPPA;
  return {
    commands: [
      { type: "M", x: tl, y: 0 },
      { type: "L", x: width - tr, y: 0 },
      { type: "C", x1: width - tr + ctr, y1: 0, x2: width, y2: tr - ctr, x: width, y: tr },
      { type: "L", x: width, y: height - br },
      { type: "C", x1: width, y1: height - br + cbr, x2: width - br + cbr, y2: height, x: width - br, y: height },
      { type: "L", x: bl, y: height },
      { type: "C", x1: bl - cbl, y1: height, x2: 0, y2: height - bl + cbl, x: 0, y: height - bl },
      { type: "L", x: 0, y: tl },
      { type: "C", x1: 0, y1: tl - ctl, x2: tl - ctl, y2: 0, x: tl, y: 0 },
      { type: "Z" },
    ],
    windingRule: "nonzero",
  };
}

function clampRadius(radius: number, width: number, height: number): number {
  return Math.max(0, Math.min(radius, width / 2, height / 2));
}

function resolveCornerRadii(
  cornerRadius: CornerRadius | undefined,
): readonly [number, number, number, number] {
  if (cornerRadius === undefined) {
    return [0, 0, 0, 0];
  }
  if (typeof cornerRadius === "number") {
    return [cornerRadius, cornerRadius, cornerRadius, cornerRadius];
  }
  return cornerRadius;
}
