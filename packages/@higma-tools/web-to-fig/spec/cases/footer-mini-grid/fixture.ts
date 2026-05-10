/**
 * @file `footer-mini-grid` — `<footer>` with three columns of links.
 * Each column is a vertical stack of links under a heading. Common
 * to GitHub / Stripe / Vercel-style footers.
 *
 * Structural shape:
 *   - `<footer>` is a flex row of three columns.
 *   - Each column is a `<div>` with one `<h3>` heading and a `<ul>`
 *     of three `<li><a></a></li>` link rows.
 *
 * The case asserts both the row direction on the footer and the
 * column direction (inferred) on each column wrapper. The columns
 * have NO explicit `flex-direction: column`; the inferer is the
 * only signal that turns them into vertical stacks.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const FOOTER_RECT: RawRect = { x: 0, y: 0, width: 1200, height: 240 };
export const COLUMN_HEADINGS: readonly string[] = ["Product", "Company", "Resources"];
export const LINKS_PER_COLUMN: readonly string[] = ["Link A", "Link B", "Link C"];
export const COLUMN_GAP = 40;
export const COLUMN_WIDTH = 200;
export const ROW_HEIGHT = 24;
export const HEADING_HEIGHT = 32;

const FOOTER_FLEX = {
  display: "flex",
  "flex-direction": "row",
  gap: `${COLUMN_GAP}px`,
} as const;

/** Build `<footer>` with three columns of {heading + 3 links}. */
export function footerMiniGrid(): RawElement {
  const columns: RawElement[] = COLUMN_HEADINGS.map((headingText, ci) => {
    const colX = ci * (COLUMN_WIDTH + COLUMN_GAP);
    const heading = synthEl({
      id: `footer/col-${ci}/h3`,
      tag: "h3",
      rect: { x: colX, y: 0, width: COLUMN_WIDTH, height: HEADING_HEIGHT },
      styleOverrides: {
        display: "block",
        color: "rgb(255, 255, 255)",
        "font-size": "16px",
        "font-weight": "700",
      },
      text: headingText,
    });
    const linkItems: RawElement[] = LINKS_PER_COLUMN.map((label, li) => {
      const itemY = HEADING_HEIGHT + 12 + li * ROW_HEIGHT;
      const link = synthEl({
        id: `footer/col-${ci}/ul/li-${li}/a`,
        tag: "a",
        rect: { x: colX, y: itemY, width: COLUMN_WIDTH, height: ROW_HEIGHT },
        styleOverrides: {
          display: "inline-block",
          color: "rgb(180, 180, 200)",
          "font-size": "14px",
        },
        text: label,
      });
      return synthEl({
        id: `footer/col-${ci}/ul/li-${li}`,
        tag: "li",
        rect: { x: colX, y: itemY, width: COLUMN_WIDTH, height: ROW_HEIGHT },
        styleOverrides: { display: "list-item" },
        children: [link],
      });
    });
    const ul = synthEl({
      id: `footer/col-${ci}/ul`,
      tag: "ul",
      rect: { x: colX, y: HEADING_HEIGHT + 12, width: COLUMN_WIDTH, height: LINKS_PER_COLUMN.length * ROW_HEIGHT },
      styleOverrides: { display: "block" },
      children: linkItems,
    });
    const colRect: RawRect = {
      x: colX,
      y: 0,
      width: COLUMN_WIDTH,
      height: HEADING_HEIGHT + 12 + LINKS_PER_COLUMN.length * ROW_HEIGHT,
    };
    return synthEl({
      id: `footer/col-${ci}`,
      tag: "div",
      rect: colRect,
      contentRect: colRect,
      styleOverrides: { display: "block" },
      children: [heading, ul],
    });
  });
  return synthEl({
    id: "footer",
    tag: "footer",
    rect: FOOTER_RECT,
    contentRect: FOOTER_RECT,
    styleOverrides: { ...FOOTER_FLEX, "background-color": "rgb(20, 20, 30)" },
    children: columns,
  });
}
