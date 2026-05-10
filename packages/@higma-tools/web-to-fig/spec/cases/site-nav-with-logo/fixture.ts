/**
 * @file `site-nav-with-logo` — `<header><nav>` row containing a brand
 * logo and three menu links. The most common header pattern across
 * the entire web (every news / SaaS / docs site has a variant).
 *
 * Structural shape:
 *   - `<header>` is `display: block`; its only child is the `<nav>`.
 *   - `<nav>` is `display: flex; flex-direction: row` with a brand
 *     `<a>` plus a `<ul>` of menu links.
 *   - The brand `<a>` carries leaf text "Brand"; the `<ul>` contains
 *     three `<li>`s each carrying a leaf-text `<a>`.
 *
 * The case asserts the IR keeps the four-level nesting intact and
 * the `<nav>` recovers the row autoLayout from the explicit flex.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const HEADER_RECT: RawRect = { x: 0, y: 0, width: 1200, height: 64 };
export const NAV_RECT: RawRect = { x: 0, y: 0, width: 1200, height: 64 };
export const BRAND_TEXT = "Brand";
export const MENU_LABELS: readonly string[] = ["Docs", "Pricing", "Blog"];
export const MENU_GAP = 24;

const FLEX_ROW = {
  display: "flex",
  "flex-direction": "row",
  "align-items": "center",
} as const;

/** Build `<header><nav><a>Brand</a><ul><li><a>…</a></li>…</ul></nav></header>`. */
export function siteNavWithLogo(): RawElement {
  const brand = synthEl({
    id: "header/nav/brand",
    tag: "a",
    rect: { x: 24, y: 16, width: 80, height: 32 },
    styleOverrides: {
      display: "inline-block",
      color: "rgb(0, 0, 0)",
      "font-size": "20px",
      "font-weight": "700",
    },
    text: BRAND_TEXT,
  });
  const menuItems: RawElement[] = MENU_LABELS.map((label, i) => {
    const link = synthEl({
      id: `header/nav/ul/li-${i}/a`,
      tag: "a",
      rect: { x: 200 + i * (60 + MENU_GAP), y: 20, width: 60, height: 24 },
      styleOverrides: {
        display: "inline-block",
        color: "rgb(0, 102, 204)",
        "font-size": "16px",
      },
      text: label,
    });
    return synthEl({
      id: `header/nav/ul/li-${i}`,
      tag: "li",
      rect: { x: 200 + i * (60 + MENU_GAP), y: 20, width: 60, height: 24 },
      styleOverrides: { display: "list-item" },
      children: [link],
    });
  });
  const ul = synthEl({
    id: "header/nav/ul",
    tag: "ul",
    rect: { x: 200, y: 20, width: MENU_LABELS.length * 60 + (MENU_LABELS.length - 1) * MENU_GAP, height: 24 },
    styleOverrides: {
      display: "flex",
      "flex-direction": "row",
      gap: `${MENU_GAP}px`,
    },
    children: menuItems,
  });
  const nav = synthEl({
    id: "header/nav",
    tag: "nav",
    rect: NAV_RECT,
    contentRect: NAV_RECT,
    styleOverrides: FLEX_ROW,
    children: [brand, ul],
  });
  return synthEl({
    id: "header",
    tag: "header",
    rect: HEADER_RECT,
    contentRect: HEADER_RECT,
    styleOverrides: { display: "block" },
    children: [nav],
  });
}
