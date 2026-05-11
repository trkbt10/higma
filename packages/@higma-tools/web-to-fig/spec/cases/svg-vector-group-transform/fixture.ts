/**
 * @file `svg-vector-group-transform` — inline `<svg>` whose `<path>`
 * carries an accumulated `<g transform>` chain. The fixture mirrors
 * what the in-page walker captures (raw `d` plus `transform` metadata)
 * so the normaliser can verify it bakes the transform into `d` before
 * the path lands in Figma's VECTOR coordinate frame.
 */
import type { RawElement, RawAffine } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

/** Path drawn at origin; the transform shifts it into place. */
export const PATH_AT_ORIGIN_D = "M 0 0 L 10 0 L 10 10 Z";

/** translate(20, 30) — shifts the triangle into the captured area. */
export const GROUP_TRANSLATE: RawAffine = { a: 1, b: 0, c: 0, d: 1, e: 20, f: 30 };

export function svgWithGroupTransform(): RawElement {
  return synthEl({
    id: "svg-grp",
    tag: "svg",
    rect: { x: 0, y: 0, width: 50, height: 50 },
    svgContent: {
      viewBox: { minX: 0, minY: 0, width: 50, height: 50 },
      paths: [{
        d: PATH_AT_ORIGIN_D,
        fill: "rgb(0, 0, 255)",
        transform: GROUP_TRANSLATE,
      }],
    },
  });
}
