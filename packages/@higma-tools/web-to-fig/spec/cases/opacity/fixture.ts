/**
 * @file `opacity` — apply CSS `opacity: <0..1>` to a `RawElement`.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_OPACITY = 0.5;

/** Set CSS `opacity` on `el`. */
export function withOpacity(el: RawElement, value: number = DEFAULT_OPACITY): RawElement {
  return {
    ...el,
    computedStyle: { ...el.computedStyle, opacity: String(value) },
  };
}
