/**
 * @file `inferred-single-child-inset` — `display: block` parent with
 * exactly ONE child that's symmetrically inset on the horizontal axis
 * (margin: 0 auto pattern). Triggers the `inferInset` branch (the
 * `children.length === 1` short-circuit), which is the ONLY code
 * path that promotes horizontal symmetry to `counterAlign: "center"`
 * with zero horizontal padding (so the auto-layout INSTANCE re-centres
 * on resize).
 *
 * The companion case `inferred-counter-center` proves the multi-child
 * branch DOESN'T do this; this case proves the single-child branch
 * DOES. The asymmetry is intentional and documented in `infer.ts`.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 240, height: 80 };
export const CHILD_WIDTH = 160;
export const CHILD_HEIGHT = 60;
export const CHILD_TOP_INSET = 10;
export const CHILD_LEFT_INSET = (PARENT_RECT.width - CHILD_WIDTH) / 2;

/**
 * Build a parent with exactly one horizontally-centred child. The
 * inferer's `inferInset` should detect the symmetry and emit
 * `counterAlign: "center"` with paddingLeft = paddingRight = 0.
 */
export function withSingleCentredChild(parent: RawElement): RawElement {
  const child = synthEl({
    id: `${parent.id}/only`,
    tag: "div",
    rect: {
      x: parent.contentRect.x + CHILD_LEFT_INSET,
      y: parent.contentRect.y + CHILD_TOP_INSET,
      width: CHILD_WIDTH,
      height: CHILD_HEIGHT,
    },
  });
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children: [child],
  };
}
