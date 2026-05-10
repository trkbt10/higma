/**
 * @file `inferred-mixed-counter-falls-through` — `display: block`
 * parent whose children form a clean horizontal row on the primary
 * axis BUT have all-different `y` positions on the counter axis. The
 * inferer's `inferCounterAlignment` should fail (no alignment
 * matches: not all-start, not all-center, not all-end, not all-
 * stretch), causing the whole row inference to return `none`.
 *
 * Real cause: an authored grid with `align-self` overrides per cell,
 * or a row of components with mixed vertical baselines (icon vs
 * label). The IR is conservative: it doesn't pretend a row exists
 * when the counter axis is a free-for-all.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 360, height: 100 };
// Three children all at gap=20 on the primary axis but staggered y.
export const CHILD_X_OFFSETS = [0, 100, 200] as const;
export const CHILD_Y_OFFSETS = [0, 30, 60] as const;
export const CHILD_WIDTH = 80;
export const CHILD_HEIGHT = 30;
export const CHILD_COUNT = CHILD_X_OFFSETS.length;

/**
 * Build a row whose primary axis (x) is uniform but whose counter
 * axis (y) is staggered — no alignment label fits. The inferer must
 * reject the row.
 */
export function withMixedCounterAxis(parent: RawElement): RawElement {
  const children: RawElement[] = CHILD_X_OFFSETS.map((dx, i) => {
    const rect: RawRect = {
      x: parent.contentRect.x + dx,
      y: parent.contentRect.y + CHILD_Y_OFFSETS[i]!,
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
