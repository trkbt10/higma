/**
 * @file `button-with-text` — `<button>Click me</button>`. The
 * captured shape has direct text (the label) and no children — same
 * leaf-text shape as `<h1>Hello</h1>`. The result should be a TEXT
 * IR carrying the label.
 *
 * Real browsers add UA padding + border to `<button>`; we author
 * those into the fixture so the case proves both the text and the
 * chrome survive.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const BUTTON_LABEL = "Click me";

/** `<button>` carrying direct text plus authored chrome (background, radius, padding). */
export function buttonWithText(): RawElement {
  return synthEl({
    id: "button",
    tag: "button",
    rect: { x: 0, y: 0, width: 100, height: 32 },
    styleOverrides: {
      "background-color": "rgb(0, 100, 200)",
      color: "rgb(255, 255, 255)",
      "font-size": "14px",
      "padding-left": "12px",
      "padding-right": "12px",
      "border-top-left-radius": "4px",
      "border-top-right-radius": "4px",
      "border-bottom-right-radius": "4px",
      "border-bottom-left-radius": "4px",
    },
    text: BUTTON_LABEL,
  });
}
