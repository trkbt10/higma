/**
 * @file `position-absolute-in-relative` — `position: relative` parent
 * containing a `position: absolute` child. The child's CSS containing
 * block is the parent (not the viewport), so the captured rect for
 * the child sits inside the parent's rect just like a flow child.
 *
 * Distinct from `fixed` / `sticky` (which the normaliser lifts out):
 * the absolute child stays in the parent's children list but should
 * be marked `sizing: { mode: "absolute" }` so the parent's autoLayout
 * inferer ignores it. Today the normaliser DOES leave the child in
 * place but does NOT mark `sizing: absolute`, which silently turns
 * the badge into a flow child the inferer measures.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT = { x: 100, y: 100, width: 200, height: 100 };
export const ABSOLUTE_CHILD_RECT = { x: 280, y: 90, width: 24, height: 24 };

/** A `position: relative` parent with one `position: absolute` badge child. */
export function relativeWithAbsoluteBadge(): RawElement {
  const child = synthEl({
    id: "parent/badge",
    tag: "div",
    rect: ABSOLUTE_CHILD_RECT,
    styleOverrides: {
      position: "absolute",
      "background-color": "rgb(255, 0, 0)",
    },
  });
  return synthEl({
    id: "parent",
    tag: "div",
    rect: PARENT_RECT,
    styleOverrides: { position: "relative" },
    children: [child],
  });
}
