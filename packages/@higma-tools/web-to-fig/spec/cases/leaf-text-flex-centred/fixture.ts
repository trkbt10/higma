/**
 * @file `leaf-text-flex-centred` — `<button>` styled with
 * `display: flex; align-items: center; justify-content: center;`
 * carrying a single text label. The captured layout authors centring
 * via the flex container (the canonical modern pattern), so the IR
 * must surface both axes as centred without falling back to "label
 * pinned to top-left".
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const FLEX_BUTTON_LABEL = "Submit";

export function flexCentredButton(): RawElement {
  return synthEl({
    id: "flex-button",
    tag: "button",
    rect: { x: 0, y: 0, width: 200, height: 60 },
    styleOverrides: {
      "background-color": "rgb(0, 100, 200)",
      color: "rgb(255, 255, 255)",
      "font-size": "14px",
      "line-height": "20px",
      display: "flex",
      "align-items": "center",
      "justify-content": "center",
      "padding-top": "0px",
      "padding-right": "0px",
      "padding-bottom": "0px",
      "padding-left": "0px",
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-bottom-left-radius": "8px",
    },
    text: FLEX_BUTTON_LABEL,
  });
}
