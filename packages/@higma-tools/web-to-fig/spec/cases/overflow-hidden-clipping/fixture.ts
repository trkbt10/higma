/**
 * @file `overflow-hidden-clipping` — `overflow: hidden` parent
 * with a child whose rect extends beyond the parent. CSS clips the
 * child at the parent's edges; Figma encodes that with
 * `clipsContent: true`. The child's IR rect stays at its visual
 * (un-clipped) bounds — the renderer uses `clipsContent` to mask.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT = { x: 0, y: 0, width: 100, height: 100 };
export const OVERSIZED_CHILD_RECT = { x: 0, y: 0, width: 200, height: 200 };

/** `overflow: hidden` parent containing an oversized child. */
export function clippedParent(): RawElement {
  const child = synthEl({
    id: "parent/oversized",
    tag: "div",
    rect: OVERSIZED_CHILD_RECT,
    styleOverrides: { "background-color": "rgb(255, 0, 0)" },
  });
  return synthEl({
    id: "parent",
    tag: "div",
    rect: PARENT_RECT,
    styleOverrides: { overflow: "hidden" },
    children: [child],
  });
}
