/**
 * @file `inferred-row-from-block` — `display: block` parent whose
 * children happen to lay out horizontally with a uniform gap.
 *
 * The CSS itself does NOT declare flex; only the captured rects do.
 * `resolveAutoLayout` therefore has nothing to short-circuit on and
 * MUST hand the children to `inferAutoLayout`. If the inferer is
 * wired correctly, the resulting AutoLayoutIR is `direction: "row"`
 * with the authored gap.
 *
 * Why this matters in practice: a real page often uses `display: inline-block`
 * or floats to lay out a horizontal toolbar, with no `display: flex`
 * anywhere. fig-to-web needs that toolbar as a row container so a
 * downstream resize pushes the children apart consistently — falling
 * back to `direction: "none"` would freeze them as absolute children.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 360, height: 80 };
export const CHILD_WIDTH = 80;
export const CHILD_HEIGHT = 80;
export const CHILD_GAP = 20;
export const CHILD_COUNT = 3;
export const PARENT_PADDING_LEFT = 20;
export const PARENT_PADDING_TOP = 0;

/**
 * Build a `display: block` parent whose children are sized + positioned
 * as if they were a flex row. The inferer is the only path that can
 * recover the row layout.
 */
export function withInferredRow(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: child rects must encode the gap the inferer should detect
  let cursorX = parent.contentRect.x + PARENT_PADDING_LEFT;
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    const rect: RawRect = {
      x: cursorX,
      y: parent.contentRect.y + PARENT_PADDING_TOP,
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
