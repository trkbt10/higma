/**
 * @file `html-body-bg-propagation` — `<body>` carries a background colour
 * but lays out narrower than the viewport, and `<html>` (the captured
 * root) has no background. The browser propagates the body's
 * background to the canvas under CSS 2.1 §14.2, so the rendered
 * viewport is fully painted with the body colour. The IR's root frame
 * must mirror that — placing the fill only on a child wrapper leaves
 * the area outside the body unpainted in the rendered `.fig`, which
 * is exactly what the `example-com-fullpage` diff exposes.
 *
 * `synthViewport` already wraps children under a synthetic root frame
 * with viewport-sized rect and no background — we use that as the
 * stand-in for `<html>`. The exported helper builds the inner `<body>`
 * surrogate with the requested background colour and the captured
 * rect example.com produces in practice (centred, narrow).
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl, withStyle } from "../../synth-snapshot";

export const BODY_BG = "rgb(238, 238, 238)";
export const BODY_RECT: RawRect = { x: 256, y: 120, width: 768, height: 96 };

/**
 * Build a `<body>`-shaped `RawElement` carrying the requested
 * `background-color` at a sub-viewport rect. The result is meant to be
 * the only child of `synthViewport({ children: [...] })` so the synth
 * body plays the `<html>` role and the returned element plays the
 * `<body>` role — matching the structure `web-to-fig`'s in-page walker
 * produces for a fullpage extract.
 */
export function bodyWithBg(bgColor: string = BODY_BG, rect: RawRect = BODY_RECT): RawElement {
  return synthEl({
    id: "body-with-bg",
    tag: "body",
    rect,
    contentRect: rect,
    computedStyle: withStyle({ "background-color": bgColor }),
  });
}
