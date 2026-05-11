/**
 * @file `text-letter-spacing` — leaf text with explicit
 * `letter-spacing: <Npx>`. Composes on `text-leaf` so the only delta
 * is the tracking value — exercises the IR's `letterSpacing` numeric
 * field, the emit-side `textNode.letterSpacing(value, "PIXELS")` call,
 * and the SpecGraph TEXT spec's pixel-typed `letterSpacing` field.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { textLeaf } from "../text-leaf/fixture";

export const DEFAULT_LETTER_SPACING_PX = 2;

/** Leaf text with `letter-spacing: <Npx>` on the default text-leaf style. */
export function textLeafWithLetterSpacing(spacingPx: number = DEFAULT_LETTER_SPACING_PX): RawElement {
  return textLeaf({ extra: { "letter-spacing": `${spacingPx}px` } });
}
