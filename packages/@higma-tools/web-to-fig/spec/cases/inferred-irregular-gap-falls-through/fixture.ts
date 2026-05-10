/**
 * @file `inferred-irregular-gap-falls-through` — `display: block`
 * parent whose children are non-uniformly spaced. The inferer's
 * `uniformGap` test must reject this layout (max-min > GAP_TOLERANCE)
 * and fall through to `direction: "none"`. The IR keeps the children
 * in flow but does NOT pretend the parent is a flex row/column.
 *
 * The inferer's conservatism here is the right call: a downstream
 * resize would otherwise pull the irregularly-spaced children into a
 * uniform row, distorting the visual.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 400, height: 80 };
// Three children at x = 0, 100, 250 (gaps 20 and 70 — outside GAP_TOLERANCE 1.5).
export const CHILD_X_OFFSETS = [0, 100, 250] as const;
export const CHILD_WIDTH = 80;
export const CHILD_HEIGHT = 80;
export const CHILD_COUNT = CHILD_X_OFFSETS.length;

/**
 * Build a `display: block` parent whose children sit at irregular
 * x-offsets so the inferer must reject the row pattern.
 */
export function withIrregularGapRow(parent: RawElement): RawElement {
  const children: RawElement[] = CHILD_X_OFFSETS.map((dx, i) => {
    const rect: RawRect = {
      x: parent.contentRect.x + dx,
      y: parent.contentRect.y,
      width: CHILD_WIDTH,
      height: CHILD_HEIGHT,
    };
    return synthEl({ id: `${parent.id}/${i}`, tag: "div", rect });
  });
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children,
  };
}
