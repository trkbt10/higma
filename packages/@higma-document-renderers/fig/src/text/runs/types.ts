/**
 * @file Text-run SoT types.
 *
 * A `TextRun` is a maximal contiguous span of source characters that share
 * a single resolved fill. Runs partition `[0, characters.length)` exactly:
 * no gaps, no overlaps, no zero-length runs except when the source is the
 * empty string (in which case the runs array is empty).
 *
 * `resolveTextRuns` is the single SoT for "which colour applies to which
 * character". All renderers (SVG `<text>`/`<tspan>`, glyph-path emission,
 * derived path, future React/WebGL backends) consume the same run list
 * rather than re-deriving the colour-per-character mapping.
 */

import type { FontQuery } from "@higma-document-models/fig/font";

/** Resolved fill applied to a contiguous run of source characters. */
export type TextRun = {
  /** Inclusive source-character start index. */
  readonly start: number;
  /** Exclusive source-character end index. */
  readonly end: number;
  /** Resolved CSS hex colour string (e.g. "#ff0000"). */
  readonly fillColor: string;
  /** Resolved alpha in [0, 1]. */
  readonly fillOpacity: number;
  /**
   * Font override for this run. `undefined` means "use the text node's
   * base font" (`ExtractedTextProps.font`). When set, the renderer must
   * route per-character glyph lookups through this query rather than the
   * base font.
   */
  readonly font?: FontQuery;
};
