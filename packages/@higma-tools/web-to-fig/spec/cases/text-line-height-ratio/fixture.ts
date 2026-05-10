/**
 * @file `text-line-height-ratio` — leaf text with a unitless
 * `line-height: <ratio>`. CSS authors `line-height: 1.5` and the
 * computed-style value is the same string (no resolution to px).
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { textLeaf } from "../text-leaf/fixture";

export const DEFAULT_LINE_HEIGHT_RATIO = 1.5;

/** Leaf text with a unitless `line-height: <ratio>`. */
export function textLeafWithRatioLineHeight(
  ratio: number = DEFAULT_LINE_HEIGHT_RATIO,
): RawElement {
  return textLeaf({ extra: { "line-height": String(ratio) } });
}
