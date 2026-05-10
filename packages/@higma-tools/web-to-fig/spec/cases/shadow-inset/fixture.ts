/**
 * @file `shadow-inset` — `box-shadow ... inset` should map to
 * `inner-shadow`, not `drop-shadow`. CSS author intent for "inner
 * highlight" / "pressed-button" surfaces here.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_INSET_SHADOW = "rgb(0, 0, 0) 0px 0px 4px 0px inset";

/** Apply an inset `box-shadow` value to `el`. */
export function withInsetShadow(el: RawElement, value: string = DEFAULT_INSET_SHADOW): RawElement {
  return {
    ...el,
    computedStyle: { ...el.computedStyle, "box-shadow": value },
  };
}
