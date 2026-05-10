/**
 * @file `gradient-linear` — apply a `background-image: linear-gradient(...)`
 * to a `RawElement`.
 *
 * The default gradient is `to right, rgb(255,0,0) → rgb(0,0,255)` so
 * the angle (90°) and stop colours both fall on distinct axes. Pairs
 * with `background-size: 100% 100%` + `background-repeat: no-repeat`
 * to avoid the natural-size synth path (out of scope for this
 * primitive — covered by the dedicated `image-bg-tile` case).
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_GRADIENT = "linear-gradient(to right, rgb(255, 0, 0), rgb(0, 0, 255))";

/** Apply a `background-image: linear-gradient(...)` (no-repeat, 100% size) to `el`. */
export function withLinearGradient(el: RawElement, value: string = DEFAULT_GRADIENT): RawElement {
  return {
    ...el,
    computedStyle: {
      ...el.computedStyle,
      "background-image": value,
      "background-repeat": "no-repeat",
      "background-size": "100% 100%",
    },
  };
}
