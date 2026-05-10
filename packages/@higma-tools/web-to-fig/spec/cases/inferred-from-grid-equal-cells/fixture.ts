/**
 * @file `inferred-from-grid-equal-cells` — `display: grid` parent with
 * a single horizontal track (one row, N equal columns). web-to-fig's
 * `resolveAutoLayout` does not have a dedicated grid branch yet —
 * `display: grid` falls through to `inferAutoLayout`. For a 1×N grid
 * the children's rects look exactly like a flex row, so the inferer
 * should detect a row.
 *
 * This is the most common grid in real pages: `grid-template-columns:
 * repeat(3, 1fr)` for a card row. Detecting it as a row is the
 * difference between rendering as a responsive container and as
 * absolute pinned children.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 360, height: 80 };
export const CELL_WIDTH = 100;
export const CELL_HEIGHT = 80;
export const CELL_GAP = 30;
export const CELL_COUNT = 3;

/**
 * Build a `display: grid` parent with N equal cells laid out in one
 * row. The CSS only declares `display: grid`; cell positions come
 * from `getBoundingClientRect`.
 */
export function withGridSingleRow(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: cell rects must encode the gap the inferer should detect
  let cursorX = parent.contentRect.x;
  for (let i = 0; i < CELL_COUNT; i += 1) {
    const rect: RawRect = {
      x: cursorX,
      y: parent.contentRect.y,
      width: CELL_WIDTH,
      height: CELL_HEIGHT,
    };
    children.push(synthEl({ id: `${parent.id}/${i}`, tag: "div", rect }));
    cursorX += CELL_WIDTH + CELL_GAP;
  }
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    computedStyle: {
      ...parent.computedStyle,
      display: "grid",
    },
    children,
  };
}
