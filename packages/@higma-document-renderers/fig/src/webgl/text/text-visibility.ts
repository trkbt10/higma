/** @file Visibility checks for WebGL text rendering inputs. */

import type { RenderTextLines } from "../../scene-graph/render-tree";

/**
 * Return true when line-mode text contains visible characters that require
 * glyph contours. Whitespace-only TEXT nodes legitimately have no contours.
 */
export function hasVisibleLineText(content: RenderTextLines): boolean {
  for (const line of content.layout.lines) {
    for (const char of line.text) {
      if (char.trim().length > 0) {
        return true;
      }
    }
  }
  return false;
}
