/**
 * @file `inferred-edge-touching-zero-gap` — `display: block` row whose
 * children sit edge-to-edge with no gap. The inferer should detect
 * a row with `gap: 0` exactly (the `min === max === 0` branch of
 * `uniformGap`).
 *
 * Real cause: navigation tabs, segmented controls, button groups
 * with `border-collapse`-like visuals — common in toolbars where the
 * designer wants visually-touching cells. The inferer must NOT
 * conflate "touching" with "overlapping" — the `nonOverlapping`
 * predicate uses `< prevEnd` (strict less), so cur.x === prev.right
 * is fine.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 240, height: 60 };
export const CHILD_WIDTH = 80;
export const CHILD_HEIGHT = 60;
export const CHILD_COUNT = 3;

/**
 * Build a row of touching children: child i sits at x = i * CHILD_WIDTH
 * with no inter-child gap.
 */
export function withEdgeTouchingChildren(parent: RawElement): RawElement {
  const children: RawElement[] = [];
  for (let i = 0; i < CHILD_COUNT; i += 1) {
    children.push(
      synthEl({
        id: `${parent.id}/${i}`,
        tag: "div",
        rect: { x: i * CHILD_WIDTH, y: 0, width: CHILD_WIDTH, height: CHILD_HEIGHT },
      }),
    );
  }
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children,
  };
}
