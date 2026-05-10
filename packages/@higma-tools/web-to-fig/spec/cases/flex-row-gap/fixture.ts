/**
 * @file `flex-row-gap` — turn a `RawElement` into a flex-row container
 * with a non-zero gap, and slot in N children with rects matching the
 * row layout (so the inferer doesn't second-guess the authored flex).
 *
 * `withFlexRowGap(parent, gap, childWidth)` is the composable: it
 * returns a parent whose `display: flex` + `gap` + `flex-direction: row`
 * are set, plus sized child boxes. Composite cases (`solid-with-flex`)
 * pass a parent that already has fills / borders applied.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const DEFAULT_GAP_PX = 12;
export const DEFAULT_CHILD_WIDTH = 60;
export const DEFAULT_CHILD_COUNT = 3;
export const DEFAULT_CHILD_HEIGHT = 60;

/** Turn `parent` into a flex-row container with N gap-spaced child boxes. */
export function withFlexRowGap(
  parent: RawElement,
  options: {
    readonly gapPx?: number;
    readonly childWidth?: number;
    readonly childCount?: number;
    readonly childHeight?: number;
  } = {},
): RawElement {
  const gap = options.gapPx ?? DEFAULT_GAP_PX;
  const childWidth = options.childWidth ?? DEFAULT_CHILD_WIDTH;
  const childHeight = options.childHeight ?? DEFAULT_CHILD_HEIGHT;
  const count = options.childCount ?? DEFAULT_CHILD_COUNT;

  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: positions must reflect the authored gap
  let cursorX = parent.contentRect.x;
  for (let i = 0; i < count; i += 1) {
    const rect: RawRect = {
      x: cursorX,
      y: parent.contentRect.y,
      width: childWidth,
      height: childHeight,
    };
    children.push(synthEl({ id: `${parent.id}/${i}`, tag: "div", rect }));
    cursorX += childWidth + gap;
  }
  return {
    ...parent,
    computedStyle: {
      ...parent.computedStyle,
      display: "flex",
      "flex-direction": "row",
      gap: `${gap}px`,
    },
    children,
  };
}
