/**
 * @file `box-leaf` — the root primitive every other case starts from.
 *
 * `baseDiv()` returns a neutral `<div>` `RawElement`: no fill, no
 * stroke, no effects, no autoLayout — the simplest non-degenerate
 * input the normaliser accepts. Composite cases call `baseDiv()` and
 * then thread the result through `withSolidBg`, `withUniformBorder`,
 * etc. to add one feature at a time, so a regression in any single
 * primitive only breaks the smallest case that exercises it.
 *
 * `id` defaults to `box` because every higher-tier case re-parents the
 * resulting element under the synthetic body — the id never leaves
 * this fixture's scope, so a stable label is fine.
 */
import type { RawElement, RawRect } from "../../../src/web-source/snapshot";
import { synthEl } from "../../synth-snapshot";

export const DEFAULT_BOX: RawRect = { x: 0, y: 0, width: 100, height: 60 };

/**
 * Build a neutral `<div>` `RawElement`. Override `rect` to position
 * the element when the case asserts on geometry; override `id` when a
 * composite case needs to disambiguate two siblings.
 */
/** Build a neutral no-style `<div>` `RawElement` — the bottom of the case ladder. */
export function baseDiv(overrides: { readonly id?: string; readonly tag?: string; readonly rect?: RawRect; readonly contentRect?: RawRect } = {}): RawElement {
  return synthEl({
    id: overrides.id ?? "box",
    tag: overrides.tag ?? "div",
    rect: overrides.rect ?? DEFAULT_BOX,
    contentRect: overrides.contentRect,
  });
}
