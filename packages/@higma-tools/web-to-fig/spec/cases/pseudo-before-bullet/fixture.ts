/**
 * @file `pseudo-before-bullet` — `<li>` with `::before { content: "•"; }`.
 *
 * The capture walker pulls pseudo-element content into the host's
 * `pseudo` array. The normaliser's paragraph code prepends `::before`
 * text to the accumulator. A normaliser that drops the pseudo loses
 * the bullet entirely.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const ITEM_TEXT = "Item one";
export const BULLET = "• ";

/** `<li>` with a `::before { content: "•" }` pseudo-element. */
export function liWithBeforeBullet(): RawElement {
  return synthEl({
    id: "li",
    tag: "li",
    rect: { x: 0, y: 0, width: 200, height: 24 },
    styleOverrides: { color: "rgb(0, 0, 0)", "font-size": "16px" },
    text: ITEM_TEXT,
    pseudo: [
      {
        which: "before",
        text: BULLET,
        computedStyle: {
          color: "rgb(0, 0, 0)",
          "font-family": "sans-serif",
          "font-weight": "400",
          "font-style": "normal",
          "text-decoration-line": "none",
        },
      },
    ],
  });
}
