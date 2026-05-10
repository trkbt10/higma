/**
 * @file `inferred-overlapping-children-fall-through` — `display: block`
 * parent whose children rects overlap on the primary axis. The
 * inferer's `nonOverlapping` check must reject this layout: a row /
 * column auto-layout cannot reproduce overlapping siblings (auto-
 * layout assumes children are laid out edge-to-edge with non-negative
 * gaps).
 *
 * Real cause: badge / overlay siblings positioned via negative
 * margin or transform-translate. The IR keeps them as flow children
 * but the parent has no inferred direction — the visual stays at the
 * captured rects without auto-layout re-flow.
 */
import type { RawElement, RawRect } from "../../../src/web-source";
import { synthEl } from "../../synth-snapshot";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 200, height: 80 };
// Child A: x=0..80; Child B: x=60..140 — overlap of 20px.
export const CHILDREN_RECTS: readonly RawRect[] = [
  { x: 0, y: 0, width: 80, height: 80 },
  { x: 60, y: 0, width: 80, height: 80 },
];
export const CHILD_COUNT = CHILDREN_RECTS.length;

/** `display: block` parent whose two children overlap horizontally. */
export function withOverlappingChildren(parent: RawElement): RawElement {
  const children: RawElement[] = CHILDREN_RECTS.map((rect, i) =>
    synthEl({ id: `${parent.id}/${i}`, tag: "div", rect }),
  );
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children,
  };
}
