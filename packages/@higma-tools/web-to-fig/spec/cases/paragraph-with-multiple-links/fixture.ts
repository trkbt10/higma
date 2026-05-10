/**
 * @file `paragraph-with-multiple-links` — distilled from Wikipedia
 * paragraph prose: a `<p>` with several inline `<a>` links interleaved
 * with plain text. The Wikipedia TFA paragraph is mostly this shape,
 * with 5–10 links per paragraph, all carrying the same anchor blue
 * but different `href`s.
 *
 * Why isolate this from the existing single-link `paragraph-inline-link`
 * case: the multi-link path exercises the writer's run-coalescing
 * logic — two adjacent same-style runs (anchor blue) separated by an
 * unstyled gap MUST emit as two separate runs, not one big merged
 * run. If it merged, the gap text would be silently re-coloured blue.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl, withStyle } from "../../synth-snapshot";

export const PARA_RECT: RawRect = { x: 0, y: 0, width: 600, height: 24 };
export const ANCHOR_COLOR = "rgb(0, 102, 204)";

export const PREFIX = "See also ";
export const FIRST_LINK = "Foo";
export const MIDDLE = ", ";
export const SECOND_LINK = "Bar";
export const SUFFIX = ", and friends.";

/**
 * Build a `<p>` whose `textFragments` interleave plain prose with
 * two `<a>` link runs. The fragment count must be `children.length + 1`
 * so the paragraph walker takes the document-order branch; mismatched
 * lengths fall through to the legacy "all text first" path and the
 * link runs end up at the wrong character indices.
 */
export function paragraphWithMultipleLinks(): RawElement {
  const linkStyle = withStyle({
    color: ANCHOR_COLOR,
    "text-decoration-line": "underline",
    display: "inline",
  });
  const firstLink = synthEl({
    id: "p/a1",
    tag: "a",
    rect: { x: 50, y: 0, width: 30, height: 24 },
    computedStyle: linkStyle,
    text: FIRST_LINK,
  });
  const secondLink = synthEl({
    id: "p/a2",
    tag: "a",
    rect: { x: 100, y: 0, width: 30, height: 24 },
    computedStyle: linkStyle,
    text: SECOND_LINK,
  });
  return synthEl({
    id: "p",
    tag: "p",
    rect: PARA_RECT,
    styleOverrides: { color: "rgb(32, 33, 34)", "font-size": "16px" },
    textFragments: [PREFIX, MIDDLE, SUFFIX],
    children: [firstLink, secondLink],
  });
}
