/**
 * @file `inferred-counter-stretch` — `display: block` parent whose
 * children fill the parent's full counter-axis (their counter-edge
 * starts at 0 and ends at parent.counter). The inferer's
 * `inferCounterAlignment` should classify this as `"stretch"`.
 *
 * This is the canonical block-layout default: a vertical stack of
 * full-width `<div>`s. If the inferer regressed to `"start"` here,
 * the downstream renderer would freeze the children at their
 * captured widths instead of letting them re-flow on resize.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 200, height: 220 };
// Children fill the full parent width so the inferer counter-axis
// detection picks `stretch`.
export const CHILD_HEIGHT = 60;
export const CHILD_GAP = 20;
export const CHILD_COUNT = 3;

/**
 * Build a `display: block` parent whose children stack vertically AND
 * occupy the full parent width — the trigger for `counterAlign: "stretch"`.
 */
export function withCounterStretchColumn(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: y-coords must encode the stack the inferer should detect
  let cursorY = parent.contentRect.y;
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    const rect: RawRect = {
      x: parent.contentRect.x,
      y: cursorY,
      width: PARENT_RECT.width,
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
