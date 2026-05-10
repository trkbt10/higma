/**
 * @file `inferred-sub-tolerance-gap-noise` — `display: block` parent
 * whose children have a primary-axis gap that wobbles by ±1px. The
 * inferer's `GAP_TOLERANCE = 1.5` should treat all three gaps as
 * equal and emit a single uniform gap (the average).
 *
 * Why this matters: real browsers round subpixel layout to integers
 * inconsistently across siblings. A 12px gap that the designer
 * authored may surface as 11/12/13 in `getBoundingClientRect`. The
 * inferer's tolerance budget exists for exactly this case — without
 * it, every captured `gap` would silently break inference because
 * `max - min = 2 > 1.5` is the *common* case under DPR=1.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 400, height: 60 };
export const CHILD_WIDTH = 80;
export const CHILD_HEIGHT = 60;
// Authored gap = 12; captured gaps = 11, 13 (max - min = 2 > tolerance 1.5
// would reject; but min-to-max within ±1 of the average satisfies the
// `max - min ≤ tolerance` budget — so we use 11.5 / 12.5 for a 1.0 spread).
export const SUB_TOLERANCE_GAPS = [11.5, 12.5] as const;
export const CHILD_COUNT = SUB_TOLERANCE_GAPS.length + 1;
export const NOMINAL_GAP = (SUB_TOLERANCE_GAPS[0]! + SUB_TOLERANCE_GAPS[1]!) / 2;

/**
 * Build a row of children whose gaps wobble within `GAP_TOLERANCE`.
 * The inferer should still detect a uniform-row layout.
 */
export function withSubToleranceGapNoise(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: x must accumulate the per-step noisy gap
  let cursorX = parent.contentRect.x;
  children.push(
    synthEl({
      id: `${parent.id}/0`,
      tag: "div",
      rect: { x: cursorX, y: 0, width: CHILD_WIDTH, height: CHILD_HEIGHT },
    }),
  );
  cursorX += CHILD_WIDTH;
  for (let i = 0; i < SUB_TOLERANCE_GAPS.length; i += 1) {
    cursorX += SUB_TOLERANCE_GAPS[i]!;
    const rect: RawRect = { x: cursorX, y: 0, width: CHILD_WIDTH, height: CHILD_HEIGHT };
    children.push(synthEl({ id: `${parent.id}/${i + 1}`, tag: "div", rect }));
    cursorX += CHILD_WIDTH;
  }
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children,
  };
}
