/**
 * @file `input-text` — `<input type="text" value="hello">`. Form
 * controls are replaced elements with browser-native rendering. The
 * IR can't faithfully reproduce the native control, but it should
 * at least preserve the input's geometry and (where authored) its
 * background / border so the layout is recognisable.
 *
 * The captured shape: `RawElement.text` is empty (the value lives in
 * a property the browser draws), but the rect is the input's bbox
 * and computedStyle has the visible chrome (border, padding).
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const INPUT_RECT = { x: 0, y: 0, width: 200, height: 32 };

/** `<input type="text">` with authored chrome (white bg, grey border). */
export function textInput(): RawElement {
  return synthEl({
    id: "input",
    tag: "input",
    rect: INPUT_RECT,
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
    },
  });
}
