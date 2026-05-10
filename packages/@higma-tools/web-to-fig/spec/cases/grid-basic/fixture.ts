/**
 * @file `grid-basic` — `display: grid` with two columns and a row gap.
 * The fixture lays out 4 children as a 2-column grid; `getBoundingClientRect`
 * returns the resolved positions just as if they were flex children.
 *
 * The normaliser today doesn't special-case `display: grid` — it
 * falls through to `inferAutoLayout`. This case proves whether the
 * inferer correctly recognises a 2-column grid as a horizontal-flow
 * layout (it probably won't, since the children are arranged in two
 * rows of two columns and the inferer expects single-axis flow).
 *
 * Either the IR carries a 2-direction grid, or the case at minimum
 * asserts the children land at the right positions — anything else
 * means the layout intent is lost.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const COL_WIDTH = 80;
export const ROW_HEIGHT = 40;
export const GAP = 8;

/** `display: grid` container with 2×2 child cells positioned by browser layout. */
export function twoColumnGrid(): RawElement {
  const childWidth = COL_WIDTH;
  const childHeight = ROW_HEIGHT;
  const positions: { x: number; y: number }[] = [
    { x: 0, y: 0 },
    { x: COL_WIDTH + GAP, y: 0 },
    { x: 0, y: ROW_HEIGHT + GAP },
    { x: COL_WIDTH + GAP, y: ROW_HEIGHT + GAP },
  ];
  const children = positions.map((p, i) =>
    synthEl({
      id: `grid/${i}`,
      tag: "div",
      rect: { x: p.x, y: p.y, width: childWidth, height: childHeight },
      styleOverrides: { "background-color": `rgb(${50 + i * 50}, 100, 200)` },
    }),
  );
  const totalW = COL_WIDTH * 2 + GAP;
  const totalH = ROW_HEIGHT * 2 + GAP;
  return synthEl({
    id: "grid",
    tag: "div",
    rect: { x: 0, y: 0, width: totalW, height: totalH },
    styleOverrides: {
      display: "grid",
      "grid-template-columns": `${COL_WIDTH}px ${COL_WIDTH}px`,
      gap: `${GAP}px`,
    },
    children,
  });
}
