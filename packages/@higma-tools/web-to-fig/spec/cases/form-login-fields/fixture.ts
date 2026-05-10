/**
 * @file `form-login-fields` — `<form>` containing two label/input
 * pairs (email, password) and a submit `<button>`. The default login
 * form shape on every web app.
 *
 * Verifies that the form structure flows through end-to-end:
 *   - `<form>` is a column FRAME (vertical stack of label rows + button).
 *   - Each label row collapses cleanly: label is a TEXT, input is a
 *     FRAME (input is a replaced element so it can't be paragraph-
 *     collapsed).
 *   - Submit `<button>` is promoted to FRAME-with-TEXT (chrome).
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const FORM_RECT: RawRect = { x: 0, y: 0, width: 360, height: 280 };
export const ROW_HEIGHT = 64;
export const ROW_GAP = 16;
export const FIELD_HEIGHT = 36;
export const FIELDS = [
  { label: "Email", id: "email", type: "email" },
  { label: "Password", id: "password", type: "password" },
] as const;
export const SUBMIT_LABEL = "Sign in";

/** Build `<form>` with two labelled inputs + a submit button. */
export function loginForm(): RawElement {
  const rows: RawElement[] = FIELDS.map((field, i) => {
    const yOffset = i * (ROW_HEIGHT + ROW_GAP);
    const labelEl = synthEl({
      id: `form/row-${i}/label`,
      tag: "label",
      rect: { x: 0, y: yOffset, width: FORM_RECT.width, height: 20 },
      styleOverrides: {
        display: "block",
        color: "rgb(0, 0, 0)",
        "font-size": "14px",
      },
      text: field.label,
    });
    const input = synthEl({
      id: `form/row-${i}/input`,
      tag: "input",
      rect: { x: 0, y: yOffset + 24, width: FORM_RECT.width, height: FIELD_HEIGHT },
      styleOverrides: {
        display: "inline-block",
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
    });
    return synthEl({
      id: `form/row-${i}`,
      tag: "div",
      rect: { x: 0, y: yOffset, width: FORM_RECT.width, height: ROW_HEIGHT },
      styleOverrides: { display: "block" },
      children: [labelEl, input],
    });
  });
  const submitY = FIELDS.length * (ROW_HEIGHT + ROW_GAP);
  const submit = synthEl({
    id: "form/submit",
    tag: "button",
    rect: { x: 0, y: submitY, width: FORM_RECT.width, height: 40 },
    styleOverrides: {
      "background-color": "rgb(0, 102, 204)",
      color: "rgb(255, 255, 255)",
      "font-size": "16px",
      "border-top-left-radius": "6px",
      "border-top-right-radius": "6px",
      "border-bottom-right-radius": "6px",
      "border-bottom-left-radius": "6px",
    },
    text: SUBMIT_LABEL,
  });
  return synthEl({
    id: "form",
    tag: "form",
    rect: FORM_RECT,
    contentRect: FORM_RECT,
    styleOverrides: { display: "block" },
    children: [...rows, submit],
  });
}
