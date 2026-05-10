/**
 * @file `pseudo-after-arrow` — `<a class="external"> with `::after { content: " →"; }`.
 *
 * Same shape as `pseudo-before-bullet` but on the trailing edge.
 * Asserts both insertion sides of the pseudo walker work.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const LINK_TEXT = "Read more";
export const ARROW = " →";

/** `<a>` with a `::after { content: " →" }` pseudo-element. */
export function anchorWithAfterArrow(): RawElement {
  return synthEl({
    id: "a",
    tag: "a",
    rect: { x: 0, y: 0, width: 200, height: 24 },
    styleOverrides: { color: "rgb(0, 0, 255)", "font-size": "16px" },
    text: LINK_TEXT,
    pseudo: [
      {
        which: "after",
        text: ARROW,
        computedStyle: {
          color: "rgb(0, 0, 255)",
          "font-family": "sans-serif",
          "font-weight": "400",
          "font-style": "normal",
          "text-decoration-line": "none",
        },
      },
    ],
  });
}
