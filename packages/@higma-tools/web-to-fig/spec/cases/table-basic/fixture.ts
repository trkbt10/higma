/**
 * @file `table-basic` — `<table><tr><td>` shape with two cells.
 *
 * Browsers compute `display: table`, `display: table-row`,
 * `display: table-cell` on the corresponding tags. These ARE in the
 * `BLOCK_DISPLAYS` set the paragraph detector uses, but the rest of
 * the normaliser doesn't special-case them — they go through
 * `normalizeFrame` like any other frame.
 *
 * The case asserts the resulting tree is FRAME(table) → FRAME(tr) →
 * FRAME(td) with the right cell content.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

/** `<table><tr><td>A</td><td>B</td></tr></table>` shape. */
export function basicTable(): RawElement {
  const cell1 = synthEl({
    id: "table/tr/td-1",
    tag: "td",
    rect: { x: 0, y: 0, width: 100, height: 30 },
    styleOverrides: { display: "table-cell" },
    text: "A",
  });
  const cell2 = synthEl({
    id: "table/tr/td-2",
    tag: "td",
    rect: { x: 100, y: 0, width: 100, height: 30 },
    styleOverrides: { display: "table-cell" },
    text: "B",
  });
  const row = synthEl({
    id: "table/tr",
    tag: "tr",
    rect: { x: 0, y: 0, width: 200, height: 30 },
    styleOverrides: { display: "table-row" },
    children: [cell1, cell2],
  });
  return synthEl({
    id: "table",
    tag: "table",
    rect: { x: 0, y: 0, width: 200, height: 30 },
    styleOverrides: { display: "table" },
    children: [row],
  });
}
