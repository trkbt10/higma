/**
 * @file `float-image-shadow` — a `float: left` image with a
 * `box-shadow`. The captured rect carries the post-float geometry
 * already, but the IR must mark the image as `mode: "absolute"` so
 * the auto-layout inferer doesn't treat it as a flow sibling and
 * mis-derive the parent's direction / gap.
 *
 * The shadow stays on the image's `style.effects` regardless of
 * float — `box-shadow` is captured from `getComputedStyle` and
 * doesn't care about float. This case pins both contracts at once
 * so a regression in either surfaces here.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export function floatedImageWithShadow(): RawElement {
  const floatedImg = synthEl({
    id: "floated",
    tag: "div",
    rect: { x: 0, y: 0, width: 80, height: 80 },
    styleOverrides: {
      "background-color": "rgb(200, 200, 200)",
      float: "left",
      "box-shadow": "rgba(0, 0, 0, 0.4) 2px 4px 8px 0px",
    },
  });
  const inFlowText = synthEl({
    id: "text",
    tag: "p",
    rect: { x: 96, y: 0, width: 200, height: 60 },
    text: "Surrounding text",
  });
  return synthEl({
    id: "container",
    tag: "div",
    rect: { x: 0, y: 0, width: 320, height: 80 },
    children: [floatedImg, inFlowText],
  });
}
