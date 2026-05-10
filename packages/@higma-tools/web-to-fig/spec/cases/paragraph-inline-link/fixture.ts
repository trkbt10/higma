/**
 * @file `paragraph-inline-link` — `<p>See <a>more</a> here</p>`.
 *
 * Models the canonical "paragraph host with one inline link" the
 * normaliser collapses into a single TEXT IR carrying the anchor as a
 * coloured / underlined `TextRunIR`. The fixture composes by hand
 * (rather than reusing `text-leaf`) because paragraph hosts have a
 * different shape: leaf text has `text` but no children, paragraph
 * hosts have `textFragments` interleaving with element children.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARAGRAPH_TEXT = "See more here";
export const LINK_TEXT = "more";
export const LINK_COLOR = "rgb(0, 0, 255)";

/** `<p>See <a>more</a> here</p>` shape with the anchor coloured + underlined. */
export function paragraphWithInlineLink(): RawElement {
  return synthEl({
    id: "p",
    tag: "p",
    rect: { x: 0, y: 0, width: 400, height: 24 },
    styleOverrides: { color: "rgb(0, 0, 0)", "font-size": "16px" },
    textFragments: ["See ", " here"],
    children: [
      synthEl({
        id: "p/a",
        tag: "a",
        rect: { x: 30, y: 0, width: 30, height: 24 },
        styleOverrides: {
          display: "inline",
          color: LINK_COLOR,
          "text-decoration-line": "underline",
        },
        text: LINK_TEXT,
      }),
    ],
  });
}
