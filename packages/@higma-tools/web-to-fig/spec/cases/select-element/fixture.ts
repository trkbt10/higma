/**
 * @file `select-element` — `<select>` with `<option>` children.
 *
 * The browser draws the entire select widget natively; the captured
 * `<option>` children have empty rects (display: none until the
 * dropdown opens). The IR can at least preserve the select's bbox
 * and chrome — same contract as `input-text` essentially.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const SELECT_RECT = { x: 0, y: 0, width: 160, height: 32 };

/** `<select>` with three invisible `<option>` children. */
export function selectWithOptions(): RawElement {
  // Options are NOT visible (display: none on the captured `<option>`
  // — the synth uses `visible: false` to mirror that).
  const options: RawElement[] = ["A", "B", "C"].map((label, i) =>
    synthEl({
      id: `select/option-${i}`,
      tag: "option",
      rect: { x: 0, y: 0, width: 0, height: 0 },
      visible: false,
      text: label,
    }),
  );
  return synthEl({
    id: "select",
    tag: "select",
    rect: SELECT_RECT,
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
    },
    children: options,
  });
}
