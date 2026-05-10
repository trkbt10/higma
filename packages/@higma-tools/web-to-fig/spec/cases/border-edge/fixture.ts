/**
 * @file `border-edge` — apply a border on a single edge only.
 *
 * Models the dividers / focus rings / tab strips real pages use.
 * The non-bordered edges keep `border-*-color: rgb(0, 0, 0)` (CSS
 * default for an unauthored colour) so the case can prove the
 * normaliser picks the *dominant* edge's colour, not just
 * `border-top-color` blindly.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export type EdgeSide = "top" | "right" | "bottom" | "left";

export const DEFAULT_EDGE: EdgeSide = "bottom";
export const DEFAULT_EDGE_WIDTH_PX = 2;
export const DEFAULT_EDGE_COLOR = "rgb(255, 0, 128)";

/** Apply a border on a single edge; non-bordered edges get width 0 and the CSS `rgb(0,0,0)` default colour. */
export function withSingleEdgeBorder(
  el: RawElement,
  side: EdgeSide = DEFAULT_EDGE,
  widthPx: number = DEFAULT_EDGE_WIDTH_PX,
  color: string = DEFAULT_EDGE_COLOR,
): RawElement {
  const sides: readonly EdgeSide[] = ["top", "right", "bottom", "left"];
  const overrides: Record<string, string> = {};
  for (const s of sides) {
    overrides[`border-${s}-width`] = s === side ? `${widthPx}px` : "0px";
    overrides[`border-${s}-color`] = s === side ? color : "rgb(0, 0, 0)";
  }
  return { ...el, computedStyle: { ...el.computedStyle, ...overrides } };
}
