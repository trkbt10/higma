/**
 * @file `blur` — apply CSS `filter: blur(<r>px)`. The current
 * normaliser only matches the `blur(...)` filter form (drop-shadow,
 * grayscale etc. are out of scope until they land in the IR).
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_BLUR_PX = 6;

/** Apply CSS `filter: blur(<radiusPx>px)` to `el`. */
export function withBlur(el: RawElement, radiusPx: number = DEFAULT_BLUR_PX): RawElement {
  return {
    ...el,
    computedStyle: { ...el.computedStyle, filter: `blur(${radiusPx}px)` },
  };
}
