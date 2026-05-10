/**
 * @file `position-sticky` — sticky elements share lift behaviour with
 * fixed (the normaliser treats both as viewportLayer entries because
 * a stuck sticky element paints at viewport-anchored coordinates).
 *
 * The fixture is a `<main>` with a sticky toolbar near the top of
 * the document — same shape as `fixed-header-lift` but with
 * `position: sticky` instead of `position: fixed`.
 */
import type { RawViewportSnapshot } from "../../../src/web-source/snapshot";
import { synthEl, synthViewport } from "../../synth-snapshot";

export const TOOLBAR_HEIGHT = 48;
export const VIEWPORT_HEIGHT = 800;
export const VIEWPORT_WIDTH = 1280;

/** A `<main>` snapshot containing a `position: sticky` toolbar near the top. */
export function stickyToolbarViewport(): RawViewportSnapshot {
  return synthViewport({
    viewport: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    children: [
      synthEl({
        id: "main",
        tag: "main",
        rect: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        children: [
          synthEl({
            id: "main/toolbar",
            tag: "nav",
            rect: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: TOOLBAR_HEIGHT },
            styleOverrides: { position: "sticky", "background-color": "rgb(240, 240, 240)" },
          }),
          synthEl({
            id: "main/p",
            tag: "p",
            rect: { x: 0, y: TOOLBAR_HEIGHT, width: VIEWPORT_WIDTH, height: 24 },
            text: "scroll body",
          }),
        ],
      }),
    ],
  });
}
