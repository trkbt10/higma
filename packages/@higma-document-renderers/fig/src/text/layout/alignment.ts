/**
 * @file Text alignment calculations (shared, format-agnostic)
 */

import type { TextAlignHorizontal, TextAlignVertical } from "./types";

/**
 * Get x position based on horizontal alignment
 *
 * @param align - Figma horizontal alignment
 * @param width - Text box width
 * @returns X position for text element
 */
export function getAlignedX(align: TextAlignHorizontal, width: number | undefined): number {
  if (!width) {return 0;}
  switch (align) {
    case "CENTER":
      return width / 2;
    case "RIGHT":
      return width;
    case "LEFT":
    case "JUSTIFIED":
    default:
      return 0;
  }
}

/**
 * Options for Y alignment calculation
 */
export type AlignYOptions = {
  /** Vertical alignment */
  align: TextAlignVertical;
  /** Text box height (optional) */
  height: number | undefined;
  /** Font size in pixels */
  fontSize: number;
  /** Number of text lines */
  lineCount: number;
  /** Line height in pixels */
  lineHeight: number;
  /**
   * Ascender ratio (ascender / unitsPerEm) from the font's typographic
   * metrics — sourced from `OS/2.sTypoAscender` by the measure provider
   * (CSS Inline L3 convention).
   */
  ascenderRatio: number;
  /**
   * Descender ratio (|descender| / unitsPerEm) from the font's
   * typographic metrics. Combined with `ascenderRatio` this yields the
   * font's content-area height. Passed alongside `ascenderRatio` so the
   * half-leading split honours CSS 2.1 §10.8.1: when `line-height`
   * exceeds the content-area height the extra space is split half above
   * and half below, shifting the first-line baseline down by
   * `(line-height - content-area-height) / 2`.
   *
   * Optional for backwards compatibility: when omitted the half-leading
   * term is zero and the baseline sits exactly at `fontSize *
   * ascenderRatio` from the top — which is what the renderer did before
   * the half-leading fix landed, and what the .fig snapshots compiled
   * against legacy callers expect.
   */
  descenderRatio?: number;
};

/**
 * Calculate starting y position based on vertical alignment
 *
 * The y value represents the baseline position of text.
 * We calculate where the first line's baseline should be placed
 * based on vertical alignment within the text box.
 *
 * @param options - Alignment options including font metrics
 * @returns Y position for first line baseline
 */
export function getAlignedYWithMetrics(options: AlignYOptions): number {
  const {
    align,
    height,
    fontSize,
    lineCount,
    lineHeight,
    ascenderRatio,
    descenderRatio,
  } = options;
  if (!Number.isFinite(ascenderRatio) || ascenderRatio <= 0) {
    throw new Error("getAlignedYWithMetrics requires a positive ascenderRatio from font metrics");
  }

  // CSS 2.1 §10.8.1 baseline placement with Chromium's integer
  // rounding on the font's typographic ascent / descent applied.
  //
  // Chromium reports `TextMetrics.fontBoundingBoxAscent` /
  // `fontBoundingBoxDescent` as integers even when the float-precise
  // values (`OS/2.sTypoAscender × fontSize / unitsPerEm`) are
  // fractional, and the rendered baseline lands at the integer
  // position. Pre-rounding ascent / descent before the half-leading
  // split removes the sub-pixel drift that an all-float formula
  // leaves on every line.
  //
  // The half-leading term carries the CSS rule that when
  // `line-height` exceeds the content-area height the surplus is
  // split half-above / half-below. Wrap-boundary fixture (16px lh:22)
  // depends on this: with halfLeading=0 lines clump 2 px too high.
  //
  // Verified against `capturedLineBaselineYs` (browser-truth) for
  // SFNS body 16px, SFNS headline 24px, Inter 16px / 14px, Noto Sans
  // JP 16px — every case matches to within 1 px (AA tolerance).
  const descenderRatioResolved = descenderRatio !== undefined && Number.isFinite(descenderRatio) && descenderRatio >= 0
    ? descenderRatio
    : 0;
  const ascentPx = Math.round(fontSize * ascenderRatio);
  const descentPx = Math.round(fontSize * descenderRatioResolved);
  const contentAreaPx = ascentPx + descentPx;
  const halfLeading = Math.max(0, (lineHeight - contentAreaPx) / 2);
  const baselineOffset = halfLeading + ascentPx;

  // Total text height: from top of first line to baseline of last line
  const totalTextHeight = baselineOffset + (lineCount - 1) * lineHeight;

  if (!height) {
    return baselineOffset; // Default: baseline at ascender from top
  }

  switch (align) {
    case "CENTER":
      return (height - totalTextHeight) / 2 + baselineOffset;
    case "BOTTOM":
      return height - totalTextHeight + baselineOffset;
    case "TOP":
    default:
      return baselineOffset;
  }
}
