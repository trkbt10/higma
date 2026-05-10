/**
 * @file `corner-radius-percent` — percentage radius, resolved at emit
 * time against `min(width, height)` of the owning element.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_RADIUS_PERCENT = 50;

/** Apply the same percentage corner radius to all four corners (resolved at emit time). */
export function withPercentRadius(
  el: RawElement,
  percent: number = DEFAULT_RADIUS_PERCENT,
): RawElement {
  const r = `${percent}%`;
  return {
    ...el,
    computedStyle: {
      ...el.computedStyle,
      "border-top-left-radius": r,
      "border-top-right-radius": r,
      "border-bottom-right-radius": r,
      "border-bottom-left-radius": r,
    },
  };
}
