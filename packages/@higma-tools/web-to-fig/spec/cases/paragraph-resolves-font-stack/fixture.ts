/**
 * @file `paragraph-resolves-font-stack` — paragraph host AND inline
 * descendant each declare their own multi-candidate `font-family`
 * stack. The IR's TEXT must carry the resolver-translated families
 * (one for the base run, one for the inline-override run), not the
 * captured first-comma-split candidate.
 *
 * Models `example.com`'s `<p>This <a>Learn more</a></p>` shape where
 * the anchor inherits no own `font-family` but the host's
 * `-apple-system, system-ui, sans-serif` stack still has to resolve
 * to a concrete family — and a hypothetical anchor with its own
 * `font-family: "Inter", monospace` must resolve independently.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const HOST_FONT_STACK = "-apple-system, system-ui, BlinkMacSystemFont, sans-serif";
export const INLINE_FONT_STACK = '"Inter", monospace';

/**
 * `<p>` host carrying `HOST_FONT_STACK`, containing a leading text
 * run and a trailing `<a>` whose own computed `font-family` is
 * `INLINE_FONT_STACK`. Built with `textFragments` so the paragraph
 * walker interleaves the host text and the anchor text in document
 * order.
 */
export function paragraphWithInlineFontOverride(): RawElement {
  return synthEl({
    id: "p",
    tag: "p",
    rect: { x: 0, y: 0, width: 768, height: 18 },
    styleOverrides: {
      color: "rgb(0, 0, 0)",
      "font-size": "16px",
      "font-family": HOST_FONT_STACK,
    },
    textFragments: ["This ", ""],
    children: [
      synthEl({
        id: "p/a",
        tag: "a",
        rect: { x: 30, y: 0, width: 80, height: 18 },
        styleOverrides: {
          color: "rgb(0, 0, 238)",
          display: "inline",
          "font-family": INLINE_FONT_STACK,
        },
        text: "Learn more",
      }),
    ],
  });
}
