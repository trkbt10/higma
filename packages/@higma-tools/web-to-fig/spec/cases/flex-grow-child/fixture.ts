/**
 * @file `flex-grow-child` — `display: flex` row whose middle child
 * carries `flex-grow: 1` so the browser stretches it to fill the
 * remaining track. The captured rect of the middle child is therefore
 * wider than its siblings, but the gap between siblings is uniform.
 *
 * The web-to-fig path takes `direction: "row"` from the explicit CSS
 * (no inference needed) and trusts the post-layout rects verbatim.
 * The grown child's rect is what it is; the IR records its width
 * faithfully and emits an absolute-sized child. (Encoding `flex-grow`
 * as a sizing.primary axis hint is a separate concern and not yet
 * wired through the IR.)
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl, withStyle } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 400, height: 60 };
export const SIDE_WIDTH = 60;
export const GAP = 10;
export const PARENT_PADDING = 0;
export const GROWN_INDEX = 1;
export const GROWN_WIDTH = PARENT_RECT.width - 2 * SIDE_WIDTH - 2 * GAP - 2 * PARENT_PADDING;

/**
 * Build a flex-row parent whose middle child has `flex-grow: 1` and a
 * post-layout rect that fills the remaining track.
 */
export function withFlexGrowChild(parent: RawElement): RawElement {
  const widths = [SIDE_WIDTH, GROWN_WIDTH, SIDE_WIDTH];
  const children: RawElement[] = [];
  // eslint-disable-next-line no-restricted-syntax -- explicit cursor: post-layout x-coords for each child
  let cursorX = parent.contentRect.x + PARENT_PADDING;
  for (let i = 0; i < widths.length; i += 1) {
    const rect: RawRect = {
      x: cursorX,
      y: parent.contentRect.y,
      width: widths[i]!,
      height: PARENT_RECT.height,
    };
    const childStyle = i === GROWN_INDEX ? withStyle({ "flex-grow": "1" }) : undefined;
    children.push(
      synthEl({
        id: `${parent.id}/${i}`,
        tag: "div",
        rect,
        computedStyle: childStyle,
      }),
    );
    cursorX += widths[i]! + GAP;
  }
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    computedStyle: {
      ...parent.computedStyle,
      display: "flex",
      "flex-direction": "row",
      gap: `${GAP}px`,
    },
    children,
  };
}
