/**
 * @file `nested-ul-list` — Wikipedia table-of-contents pattern: a
 * `<ul>` whose `<li>` children include a nested `<ul>` of their own.
 *
 * Two structural facts the IR must respect:
 *   - `<ul>` is `display: block` and `<li>` is `display: list-item`.
 *     Both are paragraph-eligible IF their content is all-inline. A
 *     `<li>` containing a nested `<ul>` is NOT all-inline (the inner
 *     `<ul>` is a block-level descendant), so the outer `<li>` MUST
 *     stay a FRAME, not collapse to TEXT.
 *   - The nested `<ul>` itself contains `<li>` children with leaf
 *     text — those inner `<li>`s ARE paragraph-eligible (text-only)
 *     and collapse to TEXT IR.
 *
 * Real risk: if `everyDescendantIsInline` regressed to ignore the
 * `display: list-item` of nested `<li>`s, the outer `<li>` would
 * eat the entire subtree as a single TEXT and the visual hierarchy
 * would disappear.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const ROOT_RECT: RawRect = { x: 0, y: 0, width: 300, height: 120 };
export const TOP_LI_RECT: RawRect = { x: 0, y: 0, width: 300, height: 80 };
export const TOP_LI_TEXT = "Section A";
export const NESTED_UL_RECT: RawRect = { x: 20, y: 24, width: 280, height: 56 };
export const NESTED_LI_RECT: RawRect = { x: 20, y: 24, width: 280, height: 24 };
export const NESTED_LI_TEXT = "Subsection A.1";

const LIST_ITEM_STYLE = { display: "list-item" } as const;
const BLOCK_STYLE = { display: "block" } as const;

/**
 * Build `<ul><li>Section A<ul><li>Subsection A.1</li></ul></li></ul>`.
 * Each `<li>` carries `display: list-item`; each `<ul>` carries
 * `display: block`. Inner `<li>` is leaf-text and collapses to TEXT;
 * outer `<li>` has a nested-block child and stays a FRAME.
 */
export function nestedUnorderedList(): RawElement {
  const innerLi = synthEl({
    id: "ul/li/ul/li",
    tag: "li",
    rect: NESTED_LI_RECT,
    styleOverrides: { ...LIST_ITEM_STYLE, color: "rgb(0, 0, 0)", "font-size": "16px" },
    text: NESTED_LI_TEXT,
  });
  const innerUl = synthEl({
    id: "ul/li/ul",
    tag: "ul",
    rect: NESTED_UL_RECT,
    styleOverrides: BLOCK_STYLE,
    children: [innerLi],
  });
  const topLi = synthEl({
    id: "ul/li",
    tag: "li",
    rect: TOP_LI_RECT,
    styleOverrides: { ...LIST_ITEM_STYLE, color: "rgb(0, 0, 0)", "font-size": "16px" },
    // `textFragments[0]` is the prose before the inner <ul>; index 1
    // is the empty tail. Browsers render this as the label "Section A"
    // followed by the indented sublist.
    textFragments: [TOP_LI_TEXT, ""],
    children: [innerUl],
  });
  return synthEl({
    id: "ul",
    tag: "ul",
    rect: ROOT_RECT,
    styleOverrides: BLOCK_STYLE,
    children: [topLi],
  });
}
