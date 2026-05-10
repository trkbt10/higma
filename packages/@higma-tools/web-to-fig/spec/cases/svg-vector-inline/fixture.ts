/**
 * @file `svg-vector-inline` — an inline `<svg>` element with one `<path>`.
 * The capture walker resolves the SVG's path data + computed style;
 * here we hand-build that intermediate `svgContent` directly so the
 * normaliser sees the same shape Playwright would produce.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const DEFAULT_SVG_PATH_D = "M0 0 L24 0 L24 24 L0 24 Z";
export const DEFAULT_SVG_FILL = "rgb(255, 0, 0)";

/** Build an inline `<svg>` `RawElement` with one filled `<path>`. */
export function inlineSvgVector(): RawElement {
  return synthEl({
    id: "svg-1",
    tag: "svg",
    rect: { x: 0, y: 0, width: 24, height: 24 },
    svgContent: {
      viewBox: { minX: 0, minY: 0, width: 24, height: 24 },
      paths: [{ d: DEFAULT_SVG_PATH_D, fill: DEFAULT_SVG_FILL }],
    },
  });
}
