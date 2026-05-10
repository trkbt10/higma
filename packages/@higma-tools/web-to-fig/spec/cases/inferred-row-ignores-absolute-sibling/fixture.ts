/**
 * @file `inferred-row-ignores-absolute-sibling` — `display: block` row
 * with three flow children PLUS one `position: absolute` overlay
 * sibling whose rect lands inside the row band. The inferer must
 * see only the three flow children (the absolute sibling is filtered
 * out before reaching `inferAutoLayout`).
 *
 * Real cause: a card with a "NEW" badge or a notification dot
 * positioned absolutely at the top-right corner of the card. If the
 * badge leaked into the inferer's child set, its overlapping rect
 * would either reject the row (`nonOverlapping` fails) or distort
 * the inferred gap. Either way, the row would silently lose its
 * auto-layout intent.
 *
 * This case is the canary for the Layer 1 fix that added `position:
 * absolute` to the out-of-flow filter in `resolveAutoLayout`.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl, withStyle } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 360, height: 80 };
export const FLOW_CHILD_WIDTH = 80;
export const FLOW_CHILD_HEIGHT = 80;
export const FLOW_GAP = 20;
export const FLOW_CHILD_COUNT = 3;
// Badge sits inside the row band, overlapping the third flow child.
// Without the absolute filter, it would either trip nonOverlapping
// or shift the inferred padding.
export const BADGE_RECT: RawRect = { x: 320, y: 4, width: 36, height: 16 };

/**
 * Build a parent with three flow children PLUS one absolutely-
 * positioned badge inside the row band.
 */
export function withRowAndAbsoluteSibling(parent: RawElement): RawElement {
  const flowChildren: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: row geometry
  let cursorX = 0;
  for (let i = 0; i < FLOW_CHILD_COUNT; i += 1) {
    flowChildren.push(
      synthEl({
        id: `${parent.id}/${i}`,
        tag: "div",
        rect: { x: cursorX, y: 0, width: FLOW_CHILD_WIDTH, height: FLOW_CHILD_HEIGHT },
      }),
    );
    cursorX += FLOW_CHILD_WIDTH + FLOW_GAP;
  }
  const badge = synthEl({
    id: `${parent.id}/badge`,
    tag: "div",
    rect: BADGE_RECT,
    computedStyle: withStyle({ position: "absolute", "background-color": "rgb(255, 0, 0)" }),
  });
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children: [...flowChildren, badge],
  };
}
