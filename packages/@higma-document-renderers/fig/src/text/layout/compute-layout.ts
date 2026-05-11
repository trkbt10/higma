/**
 * @file Unified text layout computation
 *
 * Computes text layout (line positions, baselines) from extracted text props.
 * This is the format-agnostic layout pipeline used by both SVG and WebGL backends.
 */

import type { ExtractedTextProps, TextAlignHorizontal, TextAlignVertical } from "./types";
import { getAlignedX, getAlignedYWithMetrics } from "./alignment";
import { breakLines } from "../measure/line-break";

/**
 * A single line of laid-out text
 */
export type LayoutLine = {
  /** Text content of this line */
  readonly text: string;
  /**
   * X position (SVG text-anchor point).
   *
   * This is the coordinate used as SVG <text x=...>. Its meaning depends on
   * the horizontal alignment (textAnchor):
   * - LEFT/start:  left edge of text
   * - CENTER/middle: center of text
   * - RIGHT/end:   right edge of text
   */
  readonly x: number;
  /** Y position (baseline) */
  readonly y: number;
  /** Line index (0-based, across all paragraphs) */
  readonly index: number;
  /**
   * Paragraph index (0-based).
   *
   * Tracks which source paragraph (\n-delimited) this line belongs to.
   * A single paragraph may produce multiple lines when word-wrapping is active.
   * This is essential for cursor position mapping: editor-core's TextBodyLike
   * uses paragraph structure, so the cursor layout must group lines by paragraph.
   */
  readonly paragraphIndex: number;
  /**
   * Start offset in the source paragraph for this visual line.
   *
   * This is part of the text layout contract. Renderers and editor overlays
   * must consume this range instead of reconstructing wrapped-line offsets
   * from rendered text, because wrapping may suppress leading/trailing spaces.
   */
  readonly sourceStart: number;
  /** End offset in the source paragraph for this visual line. */
  readonly sourceEnd: number;
  /**
   * Estimated pixel width of the line's text content.
   *
   * Computed from character count × estimated character width. This is an
   * approximation suitable for cursor positioning when precise font metrics
   * are unavailable. Callers with access to canvas.measureText (browser) or
   * font metrics can override this value for higher accuracy.
   */
  readonly estimatedWidth: number;
};

/**
 * Complete text layout result
 */
export type TextLayout = {
  /** Laid-out lines with positions */
  readonly lines: readonly LayoutLine[];
  /** Horizontal alignment */
  readonly alignH: TextAlignHorizontal;
  /** Vertical alignment */
  readonly alignV: TextAlignVertical;
  /** Font size */
  readonly fontSize: number;
  /** Line height */
  readonly lineHeight: number;
  /** Ascender ratio (ascender / unitsPerEm) */
  readonly ascenderRatio: number;
};

/**
 * Options for computing text layout
 */
export type ComputeLayoutOptions = {
  /** Extracted text properties */
  readonly props: ExtractedTextProps;
  /** Explicit line array (from text wrapping). If not provided, splits by \n */
  readonly lines?: readonly string[];
  /** Ascender ratio from font metrics (for accurate baseline positioning) */
  readonly ascenderRatio: number;
  /**
   * Descender ratio (|descender| / unitsPerEm) from the same font
   * metrics. Threaded through to `getAlignedYWithMetrics` so the
   * half-leading split per CSS 2.1 §10.8.1 lands the first-line
   * baseline at `top + half-leading + ascent` — without it the
   * baseline sits a few pixels too high on body paragraphs that ship
   * an explicit `line-height` value.
   *
   * Optional for backwards compatibility: callers that omit it get
   * the legacy baseline placement (no half-leading).
   */
  readonly descenderRatio?: number;
  /** Override line height (e.g., from font metrics for 100% line height) */
  readonly lineHeight?: number;
  /**
   * Precise per-character widths in CSS pixels for the rendered font
   * + size. When supplied, wrapping uses these for line-break
   * decisions instead of the `AVERAGE_CHAR_WIDTH_RATIO` estimate.
   *
   * The caller computes this from a `measureProvider.measureCharWidths`
   * call against the same Font the path renderer paints with — that's
   * the only way the wrap break the layout chooses matches the actual
   * glyph metrics. Skipping it forces the renderer to wrap at an
   * approximate column count, which is what produces the
   * `example-com-fullpage` "Avoid use ↵ in operations." regression.
   */
  readonly measureCharWidths?: (text: string) => readonly number[];
};

/**
 * Average character width as a fraction of font size.
 *
 * For proportional fonts like Inter, Helvetica, Arial, the average
 * character width is approximately 0.5–0.6 × fontSize. We use 0.55
 * as a balance between narrow (i, l, t) and wide (m, w) characters.
 * This is used only when precise font measurement is not available.
 */
const AVERAGE_CHAR_WIDTH_RATIO = 0.55;

/**
 * Whether the text auto-resize mode implies a fixed width (wrapping enabled).
 *
 * - WIDTH_AND_HEIGHT: Text box expands to fit content — no wrapping.
 * - HEIGHT: Fixed width, height expands — wrapping enabled.
 * - NONE: Fixed width and height — wrapping enabled (may clip).
 * - TRUNCATE: Fixed width and height with truncation — wrapping enabled.
 */
function isFixedWidth(textAutoResize: string): boolean {
  return textAutoResize !== "WIDTH_AND_HEIGHT";
}

/**
 * Estimate character width for a given font size and letter spacing.
 * Used when precise font measurement is not available.
 */
function estimateCharWidth(fontSize: number, letterSpacing: number | undefined): number {
  return fontSize * AVERAGE_CHAR_WIDTH_RATIO + (letterSpacing ?? 0);
}

/**
 * Simple word-wrap algorithm using estimated character widths.
 *
 * Breaks text into lines that fit within maxWidth, preferring word
 * boundaries. Falls back to character-level breaks for words wider
 * than maxWidth.
 *
 * @param text - Single paragraph text (no newlines)
 * @param maxWidth - Maximum line width in pixels
 * @param charWidth - Estimated width per character
 * @returns Array of source-ranged line strings
 */
function wrapParagraph(
  text: string,
  maxWidth: number,
  charWidth: number,
  measureCharWidths?: (text: string) => readonly number[],
): readonly SourceLine[] {
  // Prefer the caller-supplied measurement when present — per-character
  // advance widths from the actual rendered font produce break points
  // identical to what the path renderer paints. Falling back to a
  // uniform `charWidth` is an approximation kept for callsites that
  // don't have a font measurer wired in.
  const charWidths = measureCharWidths
    ? measureCharWidths(text)
    : Array.from({ length: text.length }, () => charWidth);
  return breakLines({ text, charWidths, maxWidth, mode: "auto" }).map((line) => ({
    text: line.text,
    sourceStart: line.startIndex,
    sourceEnd: line.endIndex,
  }));
}

/**
 * A line with its source paragraph index.
 */
type LineWithParagraph = {
  readonly text: string;
  readonly paragraphIndex: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
};

type SourceLine = {
  readonly text: string;
  readonly sourceStart: number;
  readonly sourceEnd: number;
};

function paragraphToSourceLine(text: string): SourceLine {
  return { text, sourceStart: 0, sourceEnd: text.length };
}

/**
 * Split text into lines with optional word wrapping, preserving paragraph origin.
 *
 * Each output line carries the index of its source paragraph (\n-delimited).
 * This is essential for cursor position mapping: a single paragraph may produce
 * multiple visual lines when word-wrapping is active, but editor-core's
 * TextBodyLike treats each \n-delimited segment as one paragraph.
 *
 * When props.textAutoResize is HEIGHT/NONE/TRUNCATE (fixed width),
 * wraps text at word boundaries using estimated character widths.
 * Otherwise (WIDTH_AND_HEIGHT), only splits at explicit newlines.
 */
function splitTextIntoLines(
  props: ExtractedTextProps,
  measureCharWidths?: (text: string) => readonly number[],
): LineWithParagraph[] {
  const paragraphs = props.characters.split("\n");

  if (!isFixedWidth(props.textAutoResize) || !props.size) {
    return paragraphs.map((text, i) => ({ ...paragraphToSourceLine(text), paragraphIndex: i }));
  }

  const maxWidth = props.size.width;
  if (maxWidth <= 0) {
    return paragraphs.map((text, i) => ({ ...paragraphToSourceLine(text), paragraphIndex: i }));
  }

  const charWidth = estimateCharWidth(props.fontSize, props.letterSpacing);
  if (charWidth <= 0) {
    return paragraphs.map((text, i) => ({ ...paragraphToSourceLine(text), paragraphIndex: i }));
  }

  const allLines: LineWithParagraph[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const wrapped = wrapParagraph(paragraphs[i], maxWidth, charWidth, measureCharWidths);
    for (const line of wrapped) {
      allLines.push({ ...line, paragraphIndex: i });
    }
  }
  return allLines;
}

function resolveLinesWithParagraph(
  explicitLines: readonly string[] | undefined,
  props: ExtractedTextProps,
  measureCharWidths?: (text: string) => readonly number[],
): LineWithParagraph[] {
  if (explicitLines) {
    return explicitLines.map((text, i) => ({ ...paragraphToSourceLine(text), paragraphIndex: i }));
  }
  return splitTextIntoLines(props, measureCharWidths);
}

/**
 * Compute text layout from extracted properties
 *
 * This function determines the position of each text line based on
 * alignment, font metrics, and text box size.
 *
 * @param options - Layout computation options
 * @returns Computed text layout
 */
export function computeTextLayout(options: ComputeLayoutOptions): TextLayout {
  const { props, ascenderRatio } = options;
  if (!Number.isFinite(ascenderRatio) || ascenderRatio <= 0) {
    throw new Error("computeTextLayout requires a positive ascenderRatio from font metrics");
  }
  const descenderRatio = options.descenderRatio;
  const lineHeight = options.lineHeight ?? props.lineHeight;

  // Get lines with paragraph origin tracking.
  // If explicit lines are provided (no paragraph info), treat each as its own paragraph.
  const linesWithParagraph: LineWithParagraph[] = resolveLinesWithParagraph(
    options.lines,
    props,
    options.measureCharWidths,
  );

  // Calculate x position from horizontal alignment
  const x = getAlignedX(props.textAlignHorizontal, props.size?.width);

  // Calculate baseline y position from vertical alignment + font metrics
  const baseY = getAlignedYWithMetrics({
    align: props.textAlignVertical,
    height: props.size?.height,
    fontSize: props.fontSize,
    lineCount: linesWithParagraph.length,
    lineHeight,
    ascenderRatio,
    descenderRatio,
  });

  // Estimate character width for approximate line width calculation
  const charWidth = estimateCharWidth(props.fontSize, props.letterSpacing);

  // Build laid-out lines
  const lines: LayoutLine[] = linesWithParagraph.map((lwp, index) => ({
    text: lwp.text,
    x,
    y: baseY + index * lineHeight,
    index,
    paragraphIndex: lwp.paragraphIndex,
    sourceStart: lwp.sourceStart,
    sourceEnd: lwp.sourceEnd,
    estimatedWidth: lwp.text.length * charWidth,
  }));

  return {
    lines,
    alignH: props.textAlignHorizontal,
    alignV: props.textAlignVertical,
    fontSize: props.fontSize,
    lineHeight,
    ascenderRatio,
  };
}

// =============================================================================
// Cursor layout conversion
// =============================================================================

/**
 * A positioned span for cursor calculation.
 * (Matches editor-core's LayoutSpanLike structurally)
 */
export type CursorLayoutSpan = {
  readonly text: string;
  readonly width: number;
  readonly dx: number;
  readonly fontSize: number;
};

/**
 * A positioned line for cursor calculation.
 * (Matches editor-core's LayoutLineLike structurally)
 */
export type CursorLayoutLine = {
  readonly spans: readonly CursorLayoutSpan[];
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
};

/**
 * Layout result for cursor calculation.
 * (Matches editor-core's LayoutResultLike structurally)
 */
export type CursorLayoutResult = {
  readonly paragraphs: readonly {
    readonly lines: readonly CursorLayoutLine[];
  }[];
};

/**
 * Convert TextLayout's SVG-anchor-based coordinates to left-edge coordinates
 * for cursor position calculation.
 *
 * SVG <text> uses textAnchor for alignment:
 * - "start" (LEFT): x = left edge of text
 * - "middle" (CENTER): x = center of text → left edge = x − width/2
 * - "end" (RIGHT): x = right edge of text → left edge = x − width
 *
 * editor-core's cursor positioning expects line.x to be the LEFT edge
 * and span.width to be the rendered text width.
 *
 * This function is the single conversion point between these two coordinate
 * systems. FigTextEditOverlay calls this instead of performing its own
 * coordinate arithmetic.
 *
 * @param layout - Result of computeTextLayout()
 * @param getLineTextWidth - Function to measure actual text width per line
 *   (e.g., via canvas.measureText).
 * @returns Cursor layout result suitable for editor-core's coordinate-to-cursor functions
 */
export function textLayoutToCursorLayout(
  layout: TextLayout,
  getLineTextWidth: (text: string) => number,
): CursorLayoutResult {
  return computeCursorLayout(layout, getLineTextWidth);
}

function computeLeftX(anchorX: number, textWidth: number, alignH: string): number {
  switch (alignH) {
    case "CENTER":
      return anchorX - textWidth / 2;
    case "RIGHT":
      return anchorX - textWidth;
    default: // LEFT, JUSTIFIED
      return anchorX;
  }
}

function computeCursorLayout(
  layout: TextLayout,
  getLineTextWidth: (text: string) => number,
): CursorLayoutResult {
  // Group layout lines by paragraphIndex.
  // A single source paragraph (\n-delimited) may produce multiple visual lines
  // when word-wrapping is active. editor-core's TextBodyLike uses \n-delimited
  // paragraphs, so the cursor layout must mirror that structure: each paragraph
  // contains all the visual lines that originated from the same source paragraph.
  //
  // Example: "長文テキスト\n後ろのテキスト" with wrapping:
  //   paragraph 0: line "長文テ", line "キスト"
  //   paragraph 1: line "後ろの", line "テキス", line "ト"

  const grouped = new Map<number, CursorLayoutLine[]>();

  for (const line of layout.lines) {
    const textWidth = getLineTextWidth(line.text);
    if (!Number.isFinite(textWidth) || textWidth < 0) {
      throw new Error(`Text layout cursor measurement returned invalid width for "${line.text}"`);
    }

    // Convert SVG text-anchor x to left-edge x
    const leftX = computeLeftX(line.x, textWidth, layout.alignH);

    const cursorLine: CursorLayoutLine = {
      spans: [{
        text: line.text,
        width: textWidth,
        dx: 0,
        fontSize: layout.fontSize,
      }],
      x: leftX,
      y: line.y,
      height: layout.lineHeight,
      sourceStart: line.sourceStart,
      sourceEnd: line.sourceEnd,
    };

    const existing = grouped.get(line.paragraphIndex);
    if (existing) {
      existing.push(cursorLine);
    } else {
      grouped.set(line.paragraphIndex, [cursorLine]);
    }
  }

  // Build paragraphs in order of paragraphIndex
  const sortedKeys = Array.from(grouped.keys()).sort((a, b) => a - b);
  const paragraphs = sortedKeys.map((key) => ({
    lines: grouped.get(key)!,
  }));

  return { paragraphs };
}
