/**
 * @file `text-no-stroke-leak` — a paragraph host with a decorative
 * `border-bottom` plus inline `<em>` content. This is the exact
 * shape that previously surfaced a regression: `normalizeStyle` lifted
 * the captured border onto `style.strokes`, the TEXT node carried it
 * straight through, and Figma rendered a stroke around every glyph
 * instead of an inline underline rule.
 *
 * The fixture uses two inline children so the host enters the
 * `normalizeParagraph` path (paragraph hosts are never wrapped by
 * `promoteLeafTextToFrame`), which is the path where the leak lived.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const HEADING_PREFIX = "Headline ";
export const HEADING_EMPHASIS = "with emphasis";

export function paragraphWithBorder(): RawElement {
  const prefix = synthEl({
    id: "p-text",
    tag: "span",
    rect: { x: 0, y: 0, width: 80, height: 24 },
    text: HEADING_PREFIX,
    styleOverrides: { display: "inline" },
  });
  const em = synthEl({
    id: "p-em",
    tag: "em",
    rect: { x: 80, y: 0, width: 100, height: 24 },
    text: HEADING_EMPHASIS,
    styleOverrides: { display: "inline" },
  });
  return synthEl({
    id: "p",
    tag: "p",
    rect: { x: 0, y: 0, width: 320, height: 24 },
    children: [prefix, em],
    styleOverrides: {
      "font-size": "16px",
      color: "rgb(20, 30, 40)",
      "border-bottom-width": "1px",
      "border-bottom-color": "rgb(255, 0, 0)",
      "border-bottom-style": "solid",
    },
  });
}
