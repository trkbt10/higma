/**
 * @file `flex-column` — same composition as `flex-row-gap` but with
 * `flex-direction: column`. Child rects are stacked vertically.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const DEFAULT_GAP_PX = 8;
export const DEFAULT_CHILD_HEIGHT = 40;
export const DEFAULT_CHILD_WIDTH = 100;
export const DEFAULT_CHILD_COUNT = 3;

/** Turn `parent` into a flex-column container with N gap-spaced child boxes. */
export function withFlexColumn(
  parent: RawElement,
  options: {
    readonly gapPx?: number;
    readonly childHeight?: number;
    readonly childWidth?: number;
    readonly childCount?: number;
  } = {},
): RawElement {
  const gap = options.gapPx ?? DEFAULT_GAP_PX;
  const childHeight = options.childHeight ?? DEFAULT_CHILD_HEIGHT;
  const childWidth = options.childWidth ?? DEFAULT_CHILD_WIDTH;
  const count = options.childCount ?? DEFAULT_CHILD_COUNT;

  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: positions must reflect the authored gap
  let cursorY = parent.contentRect.y;
  for (let i = 0; i < count; i += 1) {
    const rect: RawRect = {
      x: parent.contentRect.x,
      y: cursorY,
      width: childWidth,
      height: childHeight,
    };
    children.push(synthEl({ id: `${parent.id}/${i}`, tag: "div", rect }));
    cursorY += childHeight + gap;
  }
  return {
    ...parent,
    computedStyle: {
      ...parent.computedStyle,
      display: "flex",
      "flex-direction": "column",
      gap: `${gap}px`,
    },
    children,
  };
}
