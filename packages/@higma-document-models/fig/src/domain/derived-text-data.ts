/** @file Kiwi derivedTextData payload classification. */

import type { FigDerivedTextData } from "../types";

/**
 * Whether `derivedTextData` carries concrete visual output rather than only
 * reusable font identity metadata. Baselines carry character ranges and line
 * widths, so they are invalidated by character edits just like glyphs,
 * decorations, and serialized derived lines.
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

/**
 * Drop character-dependent derived visuals while retaining font metadata
 * recorded by Kiwi. Character edits invalidate glyph paths, baseline ranges,
 * line widths, decoration rectangles, truncation, and serialized line strings.
 */
export function derivedTextDataWithoutVisualPayload(dtd: FigDerivedTextData | undefined): FigDerivedTextData | undefined {
  if (dtd === undefined) {
    return undefined;
  }
  const fontMetaData = readDerivedFontMetaData(dtd);
  if (fontMetaData === undefined) {
    return undefined;
  }
  return {
    fontMetaData,
  };
}

function readDerivedFontMetaData(dtd: FigDerivedTextData): FigDerivedTextData["fontMetaData"] | undefined {
  if (!Array.isArray(dtd.fontMetaData) || dtd.fontMetaData.length === 0) {
    return undefined;
  }
  return dtd.fontMetaData;
}
