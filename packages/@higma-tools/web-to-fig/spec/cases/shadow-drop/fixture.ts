/**
 * @file `shadow-drop` — apply a single non-inset CSS `box-shadow`.
 *
 * Format follows what `getComputedStyle` returns: colour first, then
 * `<offsetX> <offsetY> <blur> <spread>`. Spread is non-zero so the
 * case proves it isn't dropped (the previous default-0 implementation
 * got it right, but a regression to "blur = 4th token" would lose it).
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_SHADOW = "rgba(0, 0, 0, 0.4) 2px 4px 8px 1px";

/** Apply a non-inset CSS `box-shadow` value to `el`. */
export function withDropShadow(el: RawElement, value: string = DEFAULT_SHADOW): RawElement {
  return {
    ...el,
    computedStyle: { ...el.computedStyle, "box-shadow": value },
  };
}
