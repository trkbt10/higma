/**
 * @file `floated-image-beside-text` — Wikipedia TFA's lead pattern: a
 * `<div>` containing a `<figure>` (the lead image) with `float: right`
 * plus a paragraph of body prose. The browser flows the prose around
 * the float; the IR cannot reproduce float-wrap, but it MUST keep
 * both children as siblings (positioned by their captured rects) so
 * the .fig output at least shows the image and the prose at their
 * captured locations.
 *
 * The risk this case guards against: paragraph collapse. The wrapper
 * `<div>` carries both a paragraph-eligible `<p>` and a non-inline
 * `<figure>` containing an `<img>`. If the wrapper itself were ever
 * collapsed to a TEXT IR (e.g. by a regression in
 * `everyDescendantIsInline`), the image would silently vanish. The
 * fixture proves the wrapper stays a FRAME with two children.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl, withStyle } from "../../synth-snapshot";

export const WRAPPER_RECT: RawRect = { x: 0, y: 0, width: 600, height: 200 };
// Image floated to the right edge.
export const IMG_RECT: RawRect = { x: 500, y: 0, width: 100, height: 80 };
// Paragraph occupies the left side, wrapping around the float in real
// browsers — but the IR rect simply records the post-layout box.
export const PARA_RECT: RawRect = { x: 0, y: 0, width: 480, height: 200 };

export const PROSE = "Body text that wraps around the floated image on the right.";

/**
 * Build a wrapper `<div>` carrying a floated `<figure><img></figure>`
 * plus a long `<p>` of prose. Both children sit at captured rects;
 * the IR is a FRAME with two child entries.
 */
export function floatedImageBesideText(): RawElement {
  const img = synthEl({
    id: "wrap/figure/img",
    tag: "img",
    rect: IMG_RECT,
    imageId: "lead",
    imageIds: ["lead"],
  });
  const figure = synthEl({
    id: "wrap/figure",
    tag: "figure",
    rect: IMG_RECT,
    computedStyle: withStyle({ float: "right" }),
    children: [img],
  });
  const para = synthEl({
    id: "wrap/p",
    tag: "p",
    rect: PARA_RECT,
    styleOverrides: { color: "rgb(32, 33, 34)", "font-size": "16px" },
    text: PROSE,
  });
  return synthEl({
    id: "wrap",
    tag: "div",
    rect: WRAPPER_RECT,
    children: [figure, para],
  });
}
