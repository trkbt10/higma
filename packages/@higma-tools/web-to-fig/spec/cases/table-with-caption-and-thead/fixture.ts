/**
 * @file `table-with-caption-and-thead` — full real-world `<table>` shape:
 * `<caption>` + `<thead>` + `<tbody>` + cells inside `<tr>`s.
 *
 * Builds on the existing `table-basic` / `table-header-row` cases by
 * adding the `<caption>` (display: table-caption) and the explicit
 * `<thead>` / `<tbody>` row groups (display: table-header-group /
 * table-row-group) — both of which are common on real Wikipedia
 * infobox tables and Bootstrap doc tables.
 *
 * The IR contract is structural: each tag becomes a FRAME, with the
 * `<caption>` collapsing to TEXT (its content is leaf-text). The
 * row-group wrappers do NOT collapse — they're block-level with
 * non-inline (table-row) children, which `everyDescendantIsInline`
 * rejects.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const TABLE_RECT: RawRect = { x: 0, y: 0, width: 300, height: 96 };
export const CAPTION_TEXT = "Browser support";

const TABLE_STYLE = { display: "table" } as const;
const ROW_GROUP_STYLE = { display: "table-row-group" } as const;
const HEADER_GROUP_STYLE = { display: "table-header-group" } as const;
const ROW_STYLE = { display: "table-row" } as const;
const CELL_STYLE = { display: "table-cell" } as const;
const CAPTION_STYLE = {
  display: "table-caption",
  color: "rgb(0, 0, 0)",
  "font-size": "16px",
} as const;

/**
 * Build a `<table>` containing `<caption>`, `<thead><tr>` of `<th>` cells,
 * and `<tbody><tr>` of `<td>` cells.
 */
export function tableWithCaptionAndThead(): RawElement {
  const caption = synthEl({
    id: "table/caption",
    tag: "caption",
    rect: { x: 0, y: 0, width: TABLE_RECT.width, height: 24 },
    styleOverrides: CAPTION_STYLE,
    text: CAPTION_TEXT,
  });
  const headerCell1 = synthEl({
    id: "table/thead/tr/th-1",
    tag: "th",
    rect: { x: 0, y: 24, width: 150, height: 24 },
    styleOverrides: { ...CELL_STYLE, "font-weight": "700" },
    text: "Browser",
  });
  const headerCell2 = synthEl({
    id: "table/thead/tr/th-2",
    tag: "th",
    rect: { x: 150, y: 24, width: 150, height: 24 },
    styleOverrides: { ...CELL_STYLE, "font-weight": "700" },
    text: "Version",
  });
  const headerRow = synthEl({
    id: "table/thead/tr",
    tag: "tr",
    rect: { x: 0, y: 24, width: TABLE_RECT.width, height: 24 },
    styleOverrides: ROW_STYLE,
    children: [headerCell1, headerCell2],
  });
  const thead = synthEl({
    id: "table/thead",
    tag: "thead",
    rect: { x: 0, y: 24, width: TABLE_RECT.width, height: 24 },
    styleOverrides: HEADER_GROUP_STYLE,
    children: [headerRow],
  });
  const bodyCell1 = synthEl({
    id: "table/tbody/tr/td-1",
    tag: "td",
    rect: { x: 0, y: 48, width: 150, height: 24 },
    styleOverrides: CELL_STYLE,
    text: "Chrome",
  });
  const bodyCell2 = synthEl({
    id: "table/tbody/tr/td-2",
    tag: "td",
    rect: { x: 150, y: 48, width: 150, height: 24 },
    styleOverrides: CELL_STYLE,
    text: "120+",
  });
  const bodyRow = synthEl({
    id: "table/tbody/tr",
    tag: "tr",
    rect: { x: 0, y: 48, width: TABLE_RECT.width, height: 24 },
    styleOverrides: ROW_STYLE,
    children: [bodyCell1, bodyCell2],
  });
  const tbody = synthEl({
    id: "table/tbody",
    tag: "tbody",
    rect: { x: 0, y: 48, width: TABLE_RECT.width, height: 24 },
    styleOverrides: ROW_GROUP_STYLE,
    children: [bodyRow],
  });
  return synthEl({
    id: "table",
    tag: "table",
    rect: TABLE_RECT,
    styleOverrides: TABLE_STYLE,
    children: [caption, thead, tbody],
  });
}
