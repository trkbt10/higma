/**
 * @file `transform-rotate` — apply CSS `transform: rotate(deg)`.
 *
 * `getBoundingClientRect` for a rotated element returns the AABB
 * (axis-aligned bounding box) that contains the rotated rectangle.
 * For a 45° rotation of a w×h rect the AABB has side length
 * `(w+h)/√2 * √2 = w + h` — the bbox is bigger than the original.
 *
 * Capturing rotation faithfully into Figma needs an explicit
 * transform on the node; a normaliser that emits only the AABB as
 * the box would render a non-rotated rectangle of the wrong size.
 * The case asserts SOME representation reflects either the rotation
 * angle or that the IR has a separate transform field.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_ROTATION_DEG = 45;

/** Rotate `el` by `deg` degrees: emit the matrix and grow rect to the AABB. */
export function withRotate(el: RawElement, deg: number = DEFAULT_ROTATION_DEG): RawElement {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // AABB after rotating w×h around centre.
  const w = el.rect.width;
  const h = el.rect.height;
  const aabbW = Math.abs(w * cos) + Math.abs(h * sin);
  const aabbH = Math.abs(w * sin) + Math.abs(h * cos);
  const cx = el.rect.x + w / 2;
  const cy = el.rect.y + h / 2;
  return {
    ...el,
    rect: {
      x: cx - aabbW / 2,
      y: cy - aabbH / 2,
      width: aabbW,
      height: aabbH,
    },
    computedStyle: {
      ...el.computedStyle,
      transform: `matrix(${cos}, ${sin}, ${-sin}, ${cos}, 0, 0)`,
    },
  };
}
