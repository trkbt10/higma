/**
 * @file `paragraph-multi-inline` — `<p>foo<strong>bar</strong>baz<em>qux</em></p>`.
 *
 * Multiple inline children mixed with direct text fragments. The
 * normaliser's `buildParagraphContent` must concatenate every fragment
 * + child text in document order and emit one TextRunIR per inline
 * child whose computed style differs from the paragraph base.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARAGRAPH_TEXT = "foobarbazqux";

/** `<p>foo<strong>bar</strong>baz<em>qux</em></p>` — two distinct inline run styles. */
export function paragraphMultiInline(): RawElement {
  return synthEl({
    id: "p",
    tag: "p",
    rect: { x: 0, y: 0, width: 400, height: 24 },
    styleOverrides: { color: "rgb(0, 0, 0)", "font-size": "16px", "font-weight": "400" },
    textFragments: ["foo", "baz", ""],
    children: [
      synthEl({
        id: "p/strong",
        tag: "strong",
        rect: { x: 24, y: 0, width: 30, height: 24 },
        styleOverrides: {
          display: "inline",
          color: "rgb(0, 0, 0)",
          "font-weight": "700",
        },
        text: "bar",
      }),
      synthEl({
        id: "p/em",
        tag: "em",
        rect: { x: 100, y: 0, width: 30, height: 24 },
        styleOverrides: {
          display: "inline",
          color: "rgb(0, 0, 0)",
          "font-style": "italic",
        },
        text: "qux",
      }),
    ],
  });
}
