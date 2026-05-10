/**
 * @file `fixed-header-lift` — a `<main>` body containing a
 * `position: fixed` header. The normaliser must lift the header
 * subtree out of the static tree into the viewport-anchored
 * `viewportLayer` so its negative-relative-y offset doesn't poison
 * the autoLayout inferer.
 *
 * The fixture builds the snapshot directly (`synthViewport`-shaped)
 * because the lift logic operates on the whole viewport: shape this
 * primitive at the viewport level, not at a single `RawElement`.
 */
import type { RawViewportSnapshot } from "../../../src/web-source/snapshot";
import { synthEl, synthViewport } from "../../synth-snapshot";

export const HEADER_HEIGHT = 60;
export const VIEWPORT_HEIGHT = 800;
export const VIEWPORT_WIDTH = 1280;

/** Build a viewport with a `<main>` body and a `position: fixed` header child. */
export function fixedHeaderViewport(): RawViewportSnapshot {
  return synthViewport({
    viewport: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    children: [
      synthEl({
        id: "main",
        tag: "main",
        rect: { x: 0, y: HEADER_HEIGHT, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT - HEADER_HEIGHT },
        children: [
          synthEl({
            id: "main/p",
            tag: "p",
            rect: { x: 0, y: HEADER_HEIGHT, width: VIEWPORT_WIDTH, height: 24 },
            text: "scroll body",
          }),
          synthEl({
            id: "main/header",
            tag: "header",
            rect: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: HEADER_HEIGHT },
            styleOverrides: {
              position: "fixed",
              "background-color": "rgb(255, 255, 255)",
            },
          }),
        ],
      }),
    ],
  });
}
