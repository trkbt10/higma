/**
 * @file `inferred-counter-center` — `display: block` parent whose
 * children stack vertically AND are horizontally centred (equal
 * left/right margin within the parent). The inferer's
 * `inferCounterAlignment` should fall through to `"center"` because
 * neither `start`/`end`/`stretch` matches.
 *
 * Real-world cause: `margin: 0 auto;` on a column of cards. The
 * inferer's job is to read that off the rects without seeing the
 * `margin: auto` declaration directly.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 240, height: 220 };
export const CHILD_WIDTH = 160;
export const CHILD_HEIGHT = 60;
export const CHILD_GAP = 20;
export const CHILD_COUNT = 3;
// Centred horizontally: left margin == right margin == 40
export const CHILD_LEFT_INSET = (PARENT_RECT.width - CHILD_WIDTH) / 2;

/**
 * Build a vertical block stack whose children are horizontally
 * centred within the parent — the trigger for `counterAlign: "center"`.
 */
export function withCounterCentredColumn(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: y-coords must encode the stack the inferer should detect
  let cursorY = parent.contentRect.y;
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    const rect: RawRect = {
      x: parent.contentRect.x + CHILD_LEFT_INSET,
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
