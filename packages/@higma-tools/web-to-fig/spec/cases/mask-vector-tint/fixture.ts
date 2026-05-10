/**
 * @file `mask-vector-tint` — CSS `mask-image: url(...svg)` paints the
 * element's `background-color` (or `currentColor` when transparent)
 * silhouetted by the mask. The capture walker decodes the mask SVG
 * into `maskSvgContent`; the normaliser emits a vector node whose
 * paths are tinted with the host's CSS `color`.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const DEFAULT_TINT = "rgb(50, 100, 200)";
export const DEFAULT_MASK_PATH_D = "M0 0 L16 16";

/** Build a `<span>` with a `mask-image` SVG and CSS `color` for the tint. */
export function maskedSpan(): RawElement {
  return synthEl({
    id: "mask-1",
    tag: "span",
    rect: { x: 0, y: 0, width: 16, height: 16 },
    styleOverrides: {
      color: DEFAULT_TINT,
      "mask-image": 'url("https://example.com/m.svg")',
      "mask-size": "auto",
      "mask-position": "0% 0%",
      // Background must be transparent so the normaliser falls through
      // to `currentColor` (CSS `color`) for the tint.
      "background-color": "rgba(0, 0, 0, 0)",
    },
    maskImageId: "m",
    maskNaturalWidth: 16,
    maskNaturalHeight: 16,
    maskSvgContent: {
      viewBox: { minX: 0, minY: 0, width: 16, height: 16 },
      paths: [{ d: DEFAULT_MASK_PATH_D, fill: "rgb(0, 0, 0)" }],
    },
  });
}
