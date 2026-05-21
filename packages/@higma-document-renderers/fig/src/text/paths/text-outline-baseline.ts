/**
 * @file Figma text-outline baseline projection.
 *
 * Kiwi preserves fractional text baselines from layout calculation, while
 * Figma's SVG exporter materializes outlined glyphs on an integer baseline.
 * Both derived glyph blobs and font-backed outlines must consume this same
 * projection so they do not drift by choosing separate y-coordinate rules.
 */






export function figmaTextOutlineBaselineY(baselineY: number): number {
  if (!Number.isFinite(baselineY)) {
    throw new Error("figma-text-outline-baseline: baselineY must be finite");
  }
  return Math.round(baselineY);
}
