/**
 * @file `modal-style-centred-dialog` — `position: fixed` overlay with
 * a centred dialog card. Common across confirm dialogs, sign-in
 * pop-ups, etc.
 *
 * Two `position: fixed` siblings of `<body>`:
 *   - The scrim (`<div class="scrim">`) — full-viewport semi-transparent backdrop.
 *   - The dialog (`<div class="dialog">`) — small centred card.
 *
 * Both lift to `viewportLayer` via `liftViewportLayer`. The case
 * asserts both lifts happen and each lifted entry preserves its
 * geometry. This is the multi-entry counterpart to the existing
 * `fixed-masthead-flex-row` case (which has only one fixed entry).
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const VIEWPORT: RawRect = { x: 0, y: 0, width: 1280, height: 800 };
export const SCRIM_RECT: RawRect = { x: 0, y: 0, width: 1280, height: 800 };
export const DIALOG_RECT: RawRect = { x: 440, y: 280, width: 400, height: 240 };
export const DIALOG_TITLE = "Confirm action";

/** Build a fixed-positioned scrim + dialog pair. */
export function modalScrimAndDialog(): readonly RawElement[] {
  const scrim = synthEl({
    id: "scrim",
    tag: "div",
    rect: SCRIM_RECT,
    contentRect: SCRIM_RECT,
    styleOverrides: {
      position: "fixed",
      "background-color": "rgba(0, 0, 0, 0.5)",
    },
  });
  const dialogTitle = synthEl({
    id: "dialog/title",
    tag: "h2",
    rect: { x: DIALOG_RECT.x + 24, y: DIALOG_RECT.y + 24, width: 360, height: 32 },
    styleOverrides: {
      display: "block",
      color: "rgb(0, 0, 0)",
      "font-size": "20px",
      "font-weight": "700",
    },
    text: DIALOG_TITLE,
  });
  const dialog = synthEl({
    id: "dialog",
    tag: "div",
    rect: DIALOG_RECT,
    contentRect: DIALOG_RECT,
    styleOverrides: {
      position: "fixed",
      "background-color": "rgb(255, 255, 255)",
      "border-top-left-radius": "8px",
      "border-top-right-radius": "8px",
      "border-bottom-right-radius": "8px",
      "border-bottom-left-radius": "8px",
    },
    children: [dialogTitle],
  });
  return [scrim, dialog];
}
