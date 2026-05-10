/**
 * @file `paragraph-with-nested-em-strong` — Wikipedia article-body
 * pattern: a `<p>` with `<em>` and `<strong>` runs interleaved with
 * plain prose. Asserts that paragraph collapse preserves both italic
 * AND bold style deviations on the right character ranges.
 *
 * The wikipedia-tfa fixture's lead paragraph is dense with `<i>` /
 * `<em>` for book/film titles and `<b>` / `<strong>` for the
 * subject's bolded first occurrence — losing either style would
 * regress visual fidelity of the most visible paragraph on the page.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl, withStyle } from "../../synth-snapshot";

export const PARA_RECT: RawRect = { x: 0, y: 0, width: 600, height: 24 };

export const PREFIX = "The book ";
export const TITLE = "Foundation";
export const MIDDLE = " by ";
export const AUTHOR = "Asimov";
export const SUFFIX = " is a classic.";

/**
 * Build a `<p>` whose `<em>` carries italic text and whose `<strong>`
 * carries bold text, interleaved with plain prose via textFragments.
 */
export function paragraphWithEmAndStrong(): RawElement {
  const em = synthEl({
    id: "p/em",
    tag: "em",
    rect: { x: 50, y: 0, width: 80, height: 24 },
    computedStyle: withStyle({ "font-style": "italic", display: "inline" }),
    text: TITLE,
  });
  const strong = synthEl({
    id: "p/strong",
    tag: "strong",
    rect: { x: 200, y: 0, width: 60, height: 24 },
    computedStyle: withStyle({ "font-weight": "700", display: "inline" }),
    text: AUTHOR,
  });
  return synthEl({
    id: "p",
    tag: "p",
    rect: PARA_RECT,
    styleOverrides: { color: "rgb(32, 33, 34)", "font-size": "16px" },
    textFragments: [PREFIX, MIDDLE, SUFFIX],
    children: [em, strong],
  });
}
