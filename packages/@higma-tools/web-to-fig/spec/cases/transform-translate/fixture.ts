/**
 * @file `transform-translate` — apply CSS `transform: translate(X, Y)`.
 *
 * Real-browser capture: `getBoundingClientRect` already returns the
 * post-transform rect for `transform: translate(...)`, so the
 * fixture moves `rect` by (tx, ty) at the same time it sets the
 * matrix. This mirrors what Playwright actually sees: the
 * computedStyle `transform` is `matrix(1, 0, 0, 1, tx, ty)`, but the
 * rect already accounts for the offset.
 *
 * The case asserts the resulting IR puts the frame at the
 * post-transform position — anything else means the normaliser is
 * over-counting the translation or losing it entirely.
 */
import type { RawElement } from "../../../src/web-source/snapshot";

export const DEFAULT_TX = 12;
export const DEFAULT_TY = 24;

/**
 * Apply a `transform: matrix(1, 0, 0, 1, tx, ty)` to `el` AND shift
 * its rect by (tx, ty) so the snapshot stays consistent with what
 * `getBoundingClientRect` returns in the browser.
 */
export function withTranslate(el: RawElement, tx: number = DEFAULT_TX, ty: number = DEFAULT_TY): RawElement {
  return {
    ...el,
    rect: { ...el.rect, x: el.rect.x + tx, y: el.rect.y + ty },
    contentRect: { ...el.contentRect, x: el.contentRect.x + tx, y: el.contentRect.y + ty },
    computedStyle: {
      ...el.computedStyle,
      transform: `matrix(1, 0, 0, 1, ${tx}, ${ty})`,
    },
  };
}
