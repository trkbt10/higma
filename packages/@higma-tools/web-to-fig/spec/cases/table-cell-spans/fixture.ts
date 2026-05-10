/**
 * @file `table-cell-spans` — `<td colspan="2">` produces a wider
 * cell that visually spans two columns. The browser computes the
 * cell's rect to cover both columns; the IR consumes the rect as-is.
 *
 * The case asserts the wide cell's box matches the spanned width.
 * (HTML colspan/rowspan attributes themselves aren't in computedStyle
 * — they're DOM properties — so the IR can't express them, but the
 * resulting geometry must be correct.)
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const SPANNED_CELL_WIDTH = 200;
export const SINGLE_CELL_WIDTH = 100;

/** Two-row table where row 1 is one wide colspan=2 cell and row 2 has two single cells. */
export function tableWithColspan(): RawElement {
  // Row 1: one cell that spans 2 columns.
  const wide = synthEl({
    id: "table/tr-1/td-wide",
    tag: "td",
    rect: { x: 0, y: 0, width: SPANNED_CELL_WIDTH, height: 30 },
    styleOverrides: { display: "table-cell" },
    text: "wide",
  });
  const row1 = synthEl({
    id: "table/tr-1",
    tag: "tr",
    rect: { x: 0, y: 0, width: SPANNED_CELL_WIDTH, height: 30 },
    styleOverrides: { display: "table-row" },
    children: [wide],
  });
  // Row 2: two single-column cells.
  const left = synthEl({
    id: "table/tr-2/td-left",
    tag: "td",
    rect: { x: 0, y: 30, width: SINGLE_CELL_WIDTH, height: 30 },
    styleOverrides: { display: "table-cell" },
    text: "L",
  });
  const right = synthEl({
    id: "table/tr-2/td-right",
    tag: "td",
    rect: { x: SINGLE_CELL_WIDTH, y: 30, width: SINGLE_CELL_WIDTH, height: 30 },
    styleOverrides: { display: "table-cell" },
    text: "R",
  });
  const row2 = synthEl({
    id: "table/tr-2",
    tag: "tr",
    rect: { x: 0, y: 30, width: SPANNED_CELL_WIDTH, height: 30 },
    styleOverrides: { display: "table-row" },
    children: [left, right],
  });
  return synthEl({
    id: "table",
    tag: "table",
    rect: { x: 0, y: 0, width: SPANNED_CELL_WIDTH, height: 60 },
    styleOverrides: { display: "table" },
    children: [row1, row2],
  });
}
