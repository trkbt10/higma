/**
 * @file `text-decoration` — leaf text with `text-decoration-line:
 * underline` (or `line-through`). Composes on top of `text-leaf`.
 */
import type { RawElement } from "../../../src/web-source/snapshot";
import { textLeaf } from "../text-leaf/fixture";

export type DecorationKind = "underline" | "line-through";

export const DEFAULT_DECORATION: DecorationKind = "underline";

/** Leaf text with `text-decoration-line: underline | line-through`. */
export function textLeafWithDecoration(kind: DecorationKind = DEFAULT_DECORATION): RawElement {
  return textLeaf({ extra: { "text-decoration-line": kind } });
}
