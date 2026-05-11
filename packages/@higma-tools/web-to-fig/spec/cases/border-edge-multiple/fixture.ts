/**
 * @file `border-edge-multiple` — top + bottom border only (a common
 * inset-rule pattern for `<blockquote>` / pull quotes / table headers).
 * The IR must surface two synthesised edge FRAMEs (top, bottom) and
 * leave `style.strokes` empty.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export function divWithTopBottomBorder(): RawElement {
  return synthEl({
    id: "tb",
    tag: "div",
    rect: { x: 0, y: 0, width: 200, height: 80 },
    styleOverrides: {
      "border-top-width": "1px",
      "border-bottom-width": "1px",
      "border-top-color": "rgb(50, 100, 200)",
      "border-bottom-color": "rgb(50, 100, 200)",
      "border-top-style": "solid",
      "border-bottom-style": "solid",
      "border-left-width": "0px",
      "border-right-width": "0px",
      "border-left-color": "rgb(0, 0, 0)",
      "border-right-color": "rgb(0, 0, 0)",
      "border-left-style": "none",
      "border-right-style": "none",
    },
  });
}
