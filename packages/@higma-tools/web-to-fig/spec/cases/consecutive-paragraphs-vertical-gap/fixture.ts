/**
 * @file `consecutive-paragraphs-vertical-gap` — a column wrapper holding
 * a heading and two `<p>` siblings separated by `margin-block` collapse.
 * Mirrors the structure example.com's `<body>` produces verbatim:
 *
 *   heading at y=0,  h=28
 *   paragraph at y=44, h=18   (16px gap above)
 *   link-paragraph at y=78, h=18  (16px gap above)
 *
 * The IR's auto-layout inference should treat the three siblings as a
 * column with `gap=16`, OR keep them as absolutely-positioned children
 * carrying their captured y-coordinates. Anything else (`gap=0` plus
 * absolute coordinates dropped) reproduces the `example-com-fullpage`
 * regression where the link sits glued under the body paragraph.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const HEADING_TEXT = "Example Domain";
export const FIRST_TEXT = "This domain is for use in documentation examples.";
export const SECOND_TEXT = "Learn more";

export const HEADING_RECT_Y = 0;
export const HEADING_RECT_HEIGHT = 28;
export const FIRST_RECT_Y = 44;
export const FIRST_RECT_HEIGHT = 18;
export const SECOND_RECT_Y = 78;
export const SECOND_RECT_HEIGHT = 18;

export const EXPECTED_VERTICAL_GAP = FIRST_RECT_Y - (HEADING_RECT_Y + HEADING_RECT_HEIGHT);
// Both gaps must be equal for the inferrer to settle on a uniform `gap`.
const SECOND_GAP = SECOND_RECT_Y - (FIRST_RECT_Y + FIRST_RECT_HEIGHT);
if (SECOND_GAP !== EXPECTED_VERTICAL_GAP) {
  throw new Error(
    `fixture geometry must produce uniform vertical gaps (heading↦first=${EXPECTED_VERTICAL_GAP}, first↦second=${SECOND_GAP})`,
  );
}

/**
 * Build the wrapper `<div>` with three children stacked in column
 * order at the captured y-coordinates. Each child's `display` is
 * `block` and its `font-size` is set so paragraph collapse picks them
 * up as TEXT IRs.
 */
export function twoParagraphsWithGap(): RawElement {
  const heading = synthEl({
    id: "h",
    tag: "h1",
    rect: { x: 0, y: HEADING_RECT_Y, width: 768, height: HEADING_RECT_HEIGHT },
    styleOverrides: { color: "rgb(0, 0, 0)", "font-size": "24px", display: "block" },
    text: HEADING_TEXT,
  });
  const first = synthEl({
    id: "p1",
    tag: "p",
    rect: { x: 0, y: FIRST_RECT_Y, width: 768, height: FIRST_RECT_HEIGHT },
    styleOverrides: { color: "rgb(0, 0, 0)", "font-size": "16px", display: "block" },
    text: FIRST_TEXT,
  });
  const second = synthEl({
    id: "p2",
    tag: "p",
    rect: { x: 0, y: SECOND_RECT_Y, width: 768, height: SECOND_RECT_HEIGHT },
    styleOverrides: { color: "rgb(0, 0, 0)", "font-size": "16px", display: "block" },
    text: SECOND_TEXT,
  });
  return synthEl({
    id: "container",
    tag: "div",
    rect: { x: 0, y: 0, width: 768, height: SECOND_RECT_Y + SECOND_RECT_HEIGHT },
    children: [heading, first, second],
  });
}
