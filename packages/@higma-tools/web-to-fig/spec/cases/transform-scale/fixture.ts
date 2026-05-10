/**
 * @file `transform-scale` — apply CSS `transform: scale(s)`.
 *
 * Real-browser `getBoundingClientRect` for a scaled element returns
 * the *visual* bounding box (so `width` and `height` in `el.rect`
 * are already multiplied by the scale factor) but the element's
 * *layout* size stays the original — children inside still measure
 * against the unscaled box. The fixture mirrors that: it scales the
 * rect's dimensions but keeps `contentRect` unchanged so a normaliser
 * that ignores `transform` would emit a frame whose box doesn't
 * match the visual bbox.
 *
 * The case asserts the IR carries the scale either through the box
 * dimensions or through an explicit transform field — silently
 * dropping the scale is forbidden.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_SCALE = 2;

/**
 * Apply `transform: matrix(s, 0, 0, s, 0, 0)` and grow the rect by
 * the same factor (mirrors `getBoundingClientRect` post-scale).
 * `contentRect` keeps the original layout size — children measure
 * against the unscaled box even when the visual box grew.
 */
export function withScale(el: RawElement, scale: number = DEFAULT_SCALE): RawElement {
  const cx = el.rect.x + el.rect.width / 2;
  const cy = el.rect.y + el.rect.height / 2;
  const newW = el.rect.width * scale;
  const newH = el.rect.height * scale;
  return {
    ...el,
    rect: {
      x: cx - newW / 2,
      y: cy - newH / 2,
      width: newW,
      height: newH,
    },
    computedStyle: {
      ...el.computedStyle,
      transform: `matrix(${scale}, 0, 0, ${scale}, 0, 0)`,
    },
  };
}
