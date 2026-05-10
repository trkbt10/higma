/**
 * @file `blockquote-nested-paragraph` — `<blockquote><p>quoted text</p></blockquote>`.
 * News article pull-quote pattern.
 *
 * Two block-level layers:
 *   - The outer `<blockquote>` is `display: block` but its only child
 *     is a `<p>` (also block-level). So `<blockquote>` is NOT a
 *     paragraph host (`everyDescendantIsInline` rejects the `<p>`
 *     child) and stays a FRAME.
 *   - The inner `<p>` is the actual paragraph host that collapses
 *     its inline contents to a TEXT IR.
 *
 * The risk here is the dual: a regression that promotes `<blockquote>`
 * to paragraph host would eat the `<p>` and lose the structural
 * nesting the designer relies on for the pull-quote indentation.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const QUOTE_RECT: RawRect = { x: 0, y: 0, width: 400, height: 60 };
export const PARA_RECT: RawRect = { x: 20, y: 20, width: 360, height: 24 };
export const QUOTE_TEXT = "Talk is cheap. Show me the code.";

/** Build `<blockquote><p>quoted text</p></blockquote>`. */
export function blockquoteWithNestedParagraph(): RawElement {
  const para = synthEl({
    id: "blockquote/p",
    tag: "p",
    rect: PARA_RECT,
    styleOverrides: { color: "rgb(60, 60, 60)", "font-size": "16px", "font-style": "italic" },
    text: QUOTE_TEXT,
  });
  return synthEl({
    id: "blockquote",
    tag: "blockquote",
    rect: QUOTE_RECT,
    styleOverrides: { display: "block" },
    children: [para],
  });
}
