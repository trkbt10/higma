/**
 * @file `solid-bg` — apply a CSS `background-color` to a `RawElement`.
 *
 * Composable: `withSolidBg(baseDiv())` returns the base with the
 * background colour layered on. The default colour `rgb(220, 50, 47)`
 * is chosen so each channel is distinct (so a normaliser bug that
 * swaps channels would surface, unlike a grey).
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_SOLID_COLOR = "rgb(220, 50, 47)";

/** Apply a `background-color` to `el` and return the updated `RawElement`. */
export function withSolidBg(el: RawElement, color: string = DEFAULT_SOLID_COLOR): RawElement {
  return {
    ...el,
    computedStyle: { ...el.computedStyle, "background-color": color },
  };
}
