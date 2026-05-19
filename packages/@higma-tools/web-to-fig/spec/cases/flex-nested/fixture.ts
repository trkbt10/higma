/**
 * @file `flex-nested` — flex inside flex. Outer column, inner row.
 * Real-world: a card whose body is a horizontal action bar, stacked
 * under a title. Composes the existing flex-column and flex-row-gap
 * functions, proving the functions themselves compose to deeper trees.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const OUTER_GAP = 8;
export const INNER_GAP = 4;

/** Outer flex column containing a title TEXT and an inner flex row of buttons. */
export function nestedFlex(): RawElement {
  // Inner row: two buttons.
  const innerRow = synthEl({
    id: "outer/row",
    tag: "div",
    rect: { x: 0, y: 30, width: 200, height: 30 },
    styleOverrides: {
      display: "flex",
      "flex-direction": "row",
      gap: `${INNER_GAP}px`,
    },
    children: [
      synthEl({ id: "outer/row/a", tag: "button", rect: { x: 0, y: 30, width: 60, height: 30 } }),
      synthEl({ id: "outer/row/b", tag: "button", rect: { x: 64, y: 30, width: 60, height: 30 } }),
    ],
  });
  // Outer column: title + the inner row.
  return synthEl({
    id: "outer",
    tag: "div",
    rect: { x: 0, y: 0, width: 200, height: 60 },
    styleOverrides: {
      display: "flex",
      "flex-direction": "column",
      gap: `${OUTER_GAP}px`,
    },
    children: [
      synthEl({
        id: "outer/title",
        tag: "h2",
        rect: { x: 0, y: 0, width: 200, height: 22 },
        styleOverrides: { "font-size": "18px" },
        text: "Title",
      }),
      innerRow,
    ],
  });
}
