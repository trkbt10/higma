/**
 * @file `inferred-counter-end-alignment` — `display: block` row whose
 * children share a common BOTTOM edge but have varying heights.
 * `inferCounterAlignment`'s `allEnd` branch must fire.
 *
 * Real cause: a row of icons / labels with `align-items: flex-end`
 * (in the captured CSS the `align-items` property doesn't reach the
 * inferer because the parent isn't `display: flex`; the geometry is
 * the only signal).
 *
 * The check order in `inferCounterAlignment` is stretch → start →
 * end → center. So this case also implicitly proves `allStart` does
 * NOT match (children have different y starts), forcing fall-through
 * to the `allEnd` branch.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 360, height: 80 };
// Children share bottom = 80 with varying heights.
export const CHILD_SPECS: ReadonlyArray<{ x: number; height: number }> = [
  { x: 0, height: 80 },
  { x: 120, height: 50 },
  { x: 240, height: 30 },
];
export const CHILD_WIDTH = 80;
export const CHILD_COUNT = CHILD_SPECS.length;
export const COMMON_BOTTOM = PARENT_RECT.height;

/**
 * Build a row whose children share a common bottom edge but have
 * different heights — the trigger for `counterAlign: "end"`.
 */
export function withCounterEndAlignment(parent: RawElement): RawElement {
  const children: RawElement[] = CHILD_SPECS.map((spec, i) => {
    const rect: RawRect = {
      x: spec.x,
      y: COMMON_BOTTOM - spec.height,
      width: CHILD_WIDTH,
      height: spec.height,
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
