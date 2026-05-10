/**
 * @file `text-line-height-px` — leaf text with `line-height: <Npx>`.
 * Composes on top of `text-leaf` so the only delta is the explicit
 * px line-height — exercises the `unit: "px"` branch of the
 * lineHeight IR.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { textLeaf } from "../text-leaf/fixture";

export const DEFAULT_LINE_HEIGHT_PX = 32;

/** Leaf text with explicit `line-height: <Npx>` on top of the default text-leaf style. */
export function textLeafWithPxLineHeight(linePx: number = DEFAULT_LINE_HEIGHT_PX): RawElement {
  return textLeaf({ extra: { "line-height": `${linePx}px` } });
}
