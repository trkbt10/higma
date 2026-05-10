/**
 * @file `corner-radius-asymmetric` — four different corner radii, in
 * CSS source order TL/TR/BR/BL. Pill-shaped buttons with only one
 * rounded edge or speech-bubble corners surface here.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_RADII_PX: readonly [number, number, number, number] = [1, 2, 3, 4];

/** Apply a per-corner radius quartet in TL/TR/BR/BL order. */
export function withAsymmetricRadius(
  el: RawElement,
  radii: readonly [number, number, number, number] = DEFAULT_RADII_PX,
): RawElement {
  const [tl, tr, br, bl] = radii;
  return {
    ...el,
    computedStyle: {
      ...el.computedStyle,
      "border-top-left-radius": `${tl}px`,
      "border-top-right-radius": `${tr}px`,
      "border-bottom-right-radius": `${br}px`,
      "border-bottom-left-radius": `${bl}px`,
    },
  };
}
