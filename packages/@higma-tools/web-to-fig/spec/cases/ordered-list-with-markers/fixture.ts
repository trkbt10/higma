/**
 * @file `ordered-list-with-markers` — `<ol>` of three `<li>`s with no
 * nested blocks. Each `<li>` is a leaf-text paragraph host with the
 * UA-supplied `::marker` pseudo-element carrying the numeric label.
 *
 * Two things to assert:
 *   - The `<ol>` is a FRAME with three child entries (one per `<li>`).
 *   - Each `<li>` collapses to a TEXT IR carrying its prose.
 *
 * `::marker` content is dropped at the IR level — Figma's TEXT model
 * has no list-marker affordance and we don't synthesize one. This
 * case pins that expectation so a future regression that tries to
 * splice marker glyphs into the characters is caught immediately.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const ROOT_RECT: RawRect = { x: 0, y: 0, width: 300, height: 96 };
export const ITEM_HEIGHT = 32;
export const ITEM_TEXTS: readonly string[] = ["First step", "Second step", "Third step"];
export const ITEM_COUNT = ITEM_TEXTS.length;

const LIST_ITEM_STYLE = {
  display: "list-item",
  color: "rgb(0, 0, 0)",
  "font-size": "16px",
} as const;

/** Build `<ol><li>First step</li><li>Second step</li><li>Third step</li></ol>`. */
export function orderedListWithMarkers(): RawElement {
  const items: RawElement[] = ITEM_TEXTS.map((text, i) =>
    synthEl({
      id: `ol/li-${i}`,
      tag: "li",
      rect: { x: 0, y: i * ITEM_HEIGHT, width: ROOT_RECT.width, height: ITEM_HEIGHT },
      styleOverrides: LIST_ITEM_STYLE,
      text,
    }),
  );
  return synthEl({
    id: "ol",
    tag: "ol",
    rect: ROOT_RECT,
    styleOverrides: { display: "block" },
    children: items,
  });
}
