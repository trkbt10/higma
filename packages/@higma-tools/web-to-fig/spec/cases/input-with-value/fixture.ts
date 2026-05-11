/**
 * @file `input-with-value` — `<input type="text" value="hello">`.
 *
 * The fixture mirrors what `formControlText` lifts up — the captured
 * `text` field carries the input's value so the IR has something to
 * render where the native control would draw the visible string.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const INPUT_VALUE = "hello@example.com";

export function inputWithValue(): RawElement {
  return synthEl({
    id: "input",
    tag: "input",
    rect: { x: 0, y: 0, width: 240, height: 36 },
    text: INPUT_VALUE,
    styleOverrides: {
      "background-color": "rgb(255, 255, 255)",
      "border-top-width": "1px",
      "border-right-width": "1px",
      "border-bottom-width": "1px",
      "border-left-width": "1px",
      "border-top-color": "rgb(200, 200, 200)",
      "border-right-color": "rgb(200, 200, 200)",
      "border-bottom-color": "rgb(200, 200, 200)",
      "border-left-color": "rgb(200, 200, 200)",
      "padding-left": "8px",
      "padding-right": "8px",
      "font-size": "14px",
      "line-height": "20px",
      color: "rgb(20, 20, 20)",
    },
  });
}
