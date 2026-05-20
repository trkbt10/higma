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

/**
 * Drop character-dependent derived visuals while retaining font metrics
 * recorded by Kiwi. Character edits invalidate glyph paths, decoration
 * rectangles, truncation, and serialized line strings; they do not invalidate
 * the font metadata or baseline metric values that describe the font itself.
 */
export function derivedTextDataWithoutVisualPayload(dtd: FigDerivedTextData | undefined): FigDerivedTextData | undefined {
  if (dtd === undefined) {
    return undefined;
  }
  if (!derivedTextDataHasVisualPayload(dtd)) {
    return dtd;
  }
  const baselines = readDerivedMetricBaselines(dtd);
  const fontMetaData = readDerivedFontMetaData(dtd);
  if (baselines === undefined && fontMetaData === undefined) {
    return undefined;
  }
  return {
    ...(baselines === undefined ? {} : { baselines }),
    ...(fontMetaData === undefined ? {} : { fontMetaData }),
  };
}

function readDerivedMetricBaselines(dtd: FigDerivedTextData): FigDerivedTextData["baselines"] | undefined {
  if (!Array.isArray(dtd.baselines) || dtd.baselines.length === 0) {
    return undefined;
  }
  return dtd.baselines;
}

function readDerivedFontMetaData(dtd: FigDerivedTextData): FigDerivedTextData["fontMetaData"] | undefined {
  if (!Array.isArray(dtd.fontMetaData) || dtd.fontMetaData.length === 0) {
    return undefined;
  }
  return dtd.fontMetaData;
}
