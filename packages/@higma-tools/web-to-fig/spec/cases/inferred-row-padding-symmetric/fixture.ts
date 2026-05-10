/**
 * @file `inferred-row-padding-symmetric` — `display: block` row whose
 * children have equal left and right padding inside the parent.
 * Asserts `computePadding` for the row branch returns the literal
 * `paddingLeft` and `paddingRight` from the first/last child's
 * offsets, and the top/bottom padding from the row's bbox.
 *
 * This isolates the `computePadding(axis: "row")` arithmetic from
 * the gap and counter-alignment branches (which other cases cover).
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

// Row spans 4×60 + 3×20 = 300 px starting at x=20; last right = 320.
// Parent width = 360 → paddingLeft=paddingRight=20. Height = 80 →
// paddingTop=paddingBottom=10.
export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 340, height: 80 };
export const HORIZ_PADDING = 20;
export const TOP_PADDING = 10;
export const BOTTOM_PADDING = 10;
export const CHILD_WIDTH = 60;
export const CHILD_HEIGHT = 60;
export const CHILD_GAP = 20;
export const CHILD_COUNT = 4;

/**
 * Build a row inside a parent with explicit horizontal padding. The
 * row spans `CHILD_COUNT * CHILD_WIDTH + (CHILD_COUNT - 1) * CHILD_GAP`
 * = 240 px, leaving `(320 - 240) / 2 = 40` ÷ ... wait, the inferer
 * derives padding from `first.x` and `parent.width - last.right`, so
 * authoring x-coords directly with a 20px inset on both sides is the
 * cleanest signal.
 */
export function withRowSymmetricPadding(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: x must skip the inset
  let cursorX = parent.contentRect.x + HORIZ_PADDING;
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    const rect: RawRect = {
      x: cursorX,
      y: parent.contentRect.y + TOP_PADDING,
      width: CHILD_WIDTH,
      height: CHILD_HEIGHT,
    };
    children.push(synthEl({ id: `${parent.id}/${i}`, tag: "div", rect }));
    cursorX += CHILD_WIDTH + CHILD_GAP;
  }
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children,
  };
}
