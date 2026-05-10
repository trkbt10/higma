/**
 * @file `inferred-column-from-block` — `display: block` parent whose
 * children stack vertically with a uniform gap. The dual of
 * `inferred-row-from-block`: it asserts the inferer's column branch
 * fires when the geometry says column.
 *
 * `display: block` is the default for `<div>`s; vertically stacked
 * blocks are by far the most common DOM shape (e.g. a card list). The
 * inferer has to detect that and emit `direction: "column"` so a
 * downstream resize keeps the cards on top of each other.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 200, height: 280 };
export const CHILD_WIDTH = 200;
export const CHILD_HEIGHT = 60;
export const CHILD_GAP = 20;
export const CHILD_COUNT = 3;
export const PARENT_PADDING_TOP = 20;

/**
 * Build a `display: block` parent with N vertically-stacked, uniformly
 * gapped child rects (no flex CSS — the inferer is the only signal).
 */
export function withInferredColumn(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: child rects must encode the gap the inferer should detect
  let cursorY = parent.contentRect.y + PARENT_PADDING_TOP;
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    const rect: RawRect = {
      x: parent.contentRect.x,
      y: cursorY,
      width: CHILD_WIDTH,
      height: CHILD_HEIGHT,
    };
    children.push(synthEl({ id: `${parent.id}/${i}`, tag: "div", rect }));
    cursorY += CHILD_HEIGHT + CHILD_GAP;
  }
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children,
  };
}
