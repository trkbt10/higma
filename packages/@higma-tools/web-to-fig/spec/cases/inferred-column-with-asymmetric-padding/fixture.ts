/**
 * @file `inferred-column-with-asymmetric-padding` — column whose top
 * padding ≠ bottom padding AND left padding ≠ right padding. The
 * inferer's `computePadding(axis: "column")` must derive each side
 * independently from the children's bbox, NOT collapse to a single
 * symmetric value.
 *
 * Mirrors the existing `inferred-row-padding-symmetric` case but
 * for the column branch and with all four sides distinct, which is
 * the most common shape for sidebars and side rails (16px top, 32px
 * bottom, 12px left, 8px right is a real Tailwind preset).
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

// Column geometry:
//   3 children of height 40 with 12px gaps span 40*3 + 12*2 = 144 px.
//   Top inset 16, bottom inset 32 → parent.height = 16 + 144 + 32 = 192.
//   Children width 60 inset by left=12 → parent.width = 12 + 60 + 8 = 80.
export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 80, height: 192 };
export const TOP_PADDING = 16;
export const BOTTOM_PADDING = 32;
export const LEFT_PADDING = 12;
export const RIGHT_PADDING = 8;
export const CHILD_WIDTH = 60;
export const CHILD_HEIGHT = 40;
export const CHILD_GAP = 12;
export const CHILD_COUNT = 3;

/**
 * Build a column with all four padding sides distinct. The inferer
 * must keep each one separate.
 */
export function withColumnAsymmetricPadding(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: y must accumulate gaps
  let cursorY = TOP_PADDING;
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    const rect: RawRect = {
      x: LEFT_PADDING,
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
