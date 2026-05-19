/** @file Kiwi derivedTextData payload classification. */

import type { FigDerivedTextData } from "../types";

/**
 * Whether `derivedTextData` carries concrete visual output rather than only
 * font metrics. Font metrics remain valid across character edits; glyphs,
 * decorations, and serialized derived lines do not.
 */
export function derivedTextDataHasVisualPayload(dtd: FigDerivedTextData | undefined): boolean {
  if (dtd === undefined) {
    return false;
  }
  if (Array.isArray(dtd.glyphs) && dtd.glyphs.length > 0) {
    return true;
  }
  if (Array.isArray(dtd.decorations) && dtd.decorations.length > 0) {
    return true;
  }
  if (Array.isArray(dtd.derivedLines) && dtd.derivedLines.some((line) => line.characters !== undefined)) {
    return true;
  }
  return false;
}
