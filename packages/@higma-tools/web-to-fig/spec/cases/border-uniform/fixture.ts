/**
 * @file `border-uniform` — apply a same-width same-colour border on
 * all four edges (the most common authored CSS border).
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_BORDER_WIDTH_PX = 2;
export const DEFAULT_BORDER_COLOR = "rgb(40, 40, 40)";

/** Apply a same-width same-colour border to all four edges of `el`. */
export function withUniformBorder(
  el: RawElement,
  widthPx: number = DEFAULT_BORDER_WIDTH_PX,
  color: string = DEFAULT_BORDER_COLOR,
): RawElement {
  const w = `${widthPx}px`;
  return {
    ...el,
    computedStyle: {
      ...el.computedStyle,
      "border-top-width": w,
      "border-right-width": w,
      "border-bottom-width": w,
      "border-left-width": w,
      "border-top-color": color,
      "border-right-color": color,
      "border-bottom-color": color,
      "border-left-color": color,
    },
  };
}
