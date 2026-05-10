/**
 * @file `corner-radius-uniform` — same px radius on all four corners.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_RADIUS_PX = 8;

/** Apply the same px corner radius to all four corners. */
export function withUniformRadius(el: RawElement, radiusPx: number = DEFAULT_RADIUS_PX): RawElement {
  const r = `${radiusPx}px`;
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
