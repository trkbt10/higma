/**
 * @file Figma text-outline baseline projection.
 *
 * Kiwi preserves fractional text baselines from layout calculation,
 * and the integer projection here is specifically the rule Figma's
 * derived-glyph exporter applies: when the file's `derivedTextData`
 * carries pre-computed `position.y` values for each glyph, Figma's
 * SVG writer rounds the baseline to the nearest integer before
 * stamping each outline. The font-backed emitter
 * (`extractGlyphPathContours`) does NOT pass through this projection
 * — it consumes the float baseline directly so multi-frame layouts
 * with `halfLeading = 0.5` (cjk Noto Sans JP, fontSize=14) line up
 * with Figma's outlined SVG paths.
 */

/** Project a text-layout baseline onto Figma SVG-export outline coordinates. */
export function figmaTextOutlineBaselineY(baselineY: number): number {
  if (!Number.isFinite(baselineY)) {
    throw new Error("figma-text-outline-baseline: baselineY must be finite");
  }
  return Math.round(baselineY);
}
