/**
 * @file `inferred-zero-children-falls-through` — `display: block`
 * parent with no children. The inferer's earliest short-circuit
 * (`children.length === 0`) must return `direction: "none"`. The
 * normaliser then encodes the parent as a FRAME with no autoLayout
 * intent — exactly what an empty `<div>` should produce.
 *
 * Real cause: spacer divs, lazy-rendered placeholders, layout grid
 * cells that haven't received content yet. Without this short-circuit,
 * `inferAutoLayout` would try to compute Math.max / Math.min over
 * an empty array and emit NaN, poisoning every downstream consumer.
 */
import type { RawElement, RawRect } from "../../../src/web-source";

export const PARENT_RECT: RawRect = { x: 0, y: 0, width: 200, height: 80 };

/** Build a `display: block` parent with zero children. */
export function withNoChildren(parent: RawElement): RawElement {
  return {
    ...parent,
    rect: PARENT_RECT,
    contentRect: PARENT_RECT,
    children: [],
  };
}
