/**
 * @file TextRendering — SoT domain object for a fully resolved TEXT node
 *
 * A TextRendering represents the final, backend-agnostic form of a Figma TEXT
 * node after:
 *   1. Property extraction (font, size, alignment, CPA/override-resolved chars).
 *   2. Selection of rendering strategy: pre-outlined glyph contours (from
 *      Figma's derivedTextData) OR line-based rendering via font measurement.
 *   3. Layout resolution (line positions, baseline math, alignment).
 *   4. Fill color/opacity resolution.
 *
 * Every renderer (SVG, React, WebGL) consumes this single shape rather than
 * re-deriving any of it. Renderer-specific formatting (SVG attributes,
 * React JSX, WebGL tessellation) happens in the thin render layers on top.
 */

import type { GlyphContour, PathContour } from "../paths";
import type { ExtractedTextProps, TextLayout } from "../layout";
import type { FigMatrix } from "@higma-document-models/fig/types";
import type { AbstractFont } from "@higma-document-models/fig/font";
import type { FontQuery } from "@higma-document-models/fig/font";
import type { TextRun } from "@higma-document-renderers/fig/scene-graph";

/**
 * Resolved per-line-height metric for line-mode rendering.
 *
 * Extracted from Figma's fontMetaData when available; otherwise derived
 * from the explicit lineHeight/fontSize on the node.
 */
export type ResolvedFontMetrics = {
  /** Font family recorded by Figma (useful for font resolution). */
  readonly fontFamily: string | undefined;
  /** Font weight recorded by Figma. */
  readonly fontWeight: number | undefined;
  /** Multiplier: line height in ems (e.g. 1.32). Never 0. */
  readonly fontLineHeight: number;
  /** Ascender ratio used for baseline placement. */
  readonly ascenderRatio: number;
};

/**
 * Synchronous glyph-outline font resolver.
 *
 * Font loading itself is intentionally outside the text resolver. Callers that
 * want renderer-independent outlines must preload/cache fonts and pass this
 * resolver explicitly; absence keeps missing outlines visible to WebGL instead
 * of hiding them behind renderer-local drawing paths.
 *
 * The query argument is the canonical `FontQuery` — same shape used to
 * preload, cache, and dedup. Callers that previously passed loose
 * `{fontFamily, fontWeight, fontStyle}` triples must call
 * `figmaFontToQuery` (or use `ExtractedTextProps.font` / `TextRun.font`)
 * to obtain a query first.
 */
export type TextFontResolver = (query: FontQuery) => AbstractFont | undefined;

/**
 * Fully resolved text rendering — discriminated union by strategy.
 */
export type TextRendering =
  | TextRenderingEmpty
  | TextRenderingGlyphs
  | TextRenderingLines;

/** No visible text (empty string, fully transparent, etc.) */
export type TextRenderingEmpty = {
  readonly kind: "empty";
};

/**
 * Truncation directive from Figma's text layout engine.
 *
 * When present, the renderer should display the source characters up to
 * `startIndex` followed by `ellipsis`. Additional lines past the given
 * truncatedHeight (multi-line truncation) are clipped.
 */
export type TextTruncation = {
  /** Kiwi "ENDING" → tail-ellipsis; other modes reserved for future. */
  readonly mode: "ENDING";
  /**
   * Codepoint index in the source characters where the ellipsis begins.
   * -1 / undefined means "no runtime truncation was computed" (the source
   * already fits, or Figma did not pre-compute truncation for this node).
   */
  readonly startIndex: number;
  /** Ellipsis string appended after the truncation cut (typically "…" or "..."). */
  readonly ellipsis: string;
  /**
   * Max visible height in pixels (for multi-line truncation).
   * undefined when only single-line end truncation applies.
   */
  readonly maxHeight?: number;
};

/**
 * Pre-outlined glyphs from Figma's derivedTextData.
 *
 * This strategy is used when Figma exported glyph path blobs, giving us
 * pixel-perfect output independent of the rendering system's font availability
 * (essential for SF Symbols and other private-use codepoints).
 */
export type TextRenderingGlyphs = {
  readonly kind: "glyphs";
  /**
   * Glyph outline contours in screen coordinates, each annotated with the
   * source `firstCharacter` so renderers can group glyphs by `runs[i]`.
   */
  readonly glyphContours: readonly GlyphContour[];
  /** Decoration rectangles (underline, strikethrough) in screen coordinates. */
  readonly decorationContours: readonly PathContour[];
  /**
   * Per-character fill runs covering `[0, props.characters.length)`.
   * Always non-empty for non-empty text; a single base-fill run is the
   * degenerate case used when no `characterStyleIDs` are present.
   *
   * SoT: every renderer (SVG `<path>` per run, WebGL tessellation, future
   * Canvas2D) groups glyphs by which run their `firstCharacter` falls
   * into and applies that run's fill — never re-derives "what colour for
   * character N" from raw fillPaints + override table.
   */
  readonly runs: readonly TextRun[];
  /**
   * Fill of the base run, retained as a convenience for renderers that
   * draw decorations (underlines, strikethroughs) which always pick up
   * the base fill regardless of per-character overrides.
   */
  readonly fillColor: string;
  /** Fill alpha in [0, 1]. */
  readonly fillOpacity: number;
  /** Node transform (identity if unset). */
  readonly transform: FigMatrix | undefined;
  /** Node opacity in [0, 1]. */
  readonly opacity: number;
  /** Extracted props (for downstream consumers that want original values). */
  readonly props: ExtractedTextProps;
  /**
   * Line layout — included even for glyph mode because Canvas2D / tessellation
   * rasterizers may use it when glyph outlines are too small to rasterize cleanly.
   */
  readonly layout: TextLayout;
  /**
   * Truncation directive. `undefined` when text fits uncropped.
   * In glyph mode, Figma has already baked truncation into the glyph
   * positions; the truncation metadata is provided for consumers that
   * need to render an alternate form (e.g. accessibility labels).
   */
  readonly truncation?: TextTruncation;
};

/**
 * Line-based rendering using system font / opentype.js.
 *
 * Used when no pre-outlined glyphs are available. The renderer lays out
 * text via `<text>` (SVG), HTML text, or font measurement + path extraction.
 */
export type TextRenderingLines = {
  readonly kind: "lines";
  /** Computed per-line positions (post-truncation). */
  readonly layout: TextLayout;
  /**
   * Per-character fill runs covering `[0, props.characters.length)`.
   * Lines-mode renderers must intersect runs with each line's character
   * range to emit the right colour per substring; lines mode is currently
   * single-fill in the SVG backend (one `<text>` per line, no `<tspan>`),
   * so `runs.length > 1` here is a signal that the source text uses
   * character-level styling that the lines backend does not yet split.
   */
  readonly runs: readonly TextRun[];
  /** Fill color (CSS string) — base run, used for decorations. */
  readonly fillColor: string;
  /** Fill alpha in [0, 1]. */
  readonly fillOpacity: number;
  /** Node transform (identity if unset). */
  readonly transform: FigMatrix | undefined;
  /** Node opacity in [0, 1]. */
  readonly opacity: number;
  /** Extracted props (for downstream consumers that want original values). */
  readonly props: ExtractedTextProps;
  /**
   * Truncation directive. `undefined` when the full source text is drawn
   * unchanged. When set, `layout.lines` already reflects the post-truncation
   * rendering (e.g. the last line ends with the ellipsis). Renderers may
   * still consult the original `props.characters` for accessibility labels.
   */
  readonly truncation?: TextTruncation;
  /**
   * Per-line-height font metrics resolved from Figma's fontMetaData.
   * Present when Figma pre-computed font metrics for this TEXT node.
   */
  readonly fontMetrics?: ResolvedFontMetrics;
};
