/**
 * @file Text node type definitions
 *
 * SoT for font/value types: @higma-document-models/fig/types.
 */

import type { FigMatrix, FigPaint } from "@higma-document-models/fig/types";
import type { FontQuery } from "@higma-document-models/fig/font";
import type { TextAutoResize, BlendMode } from "@higma-document-renderers/fig/scene-graph";

/**
 * Text data structure from .fig files
 */
export type FigTextData = {
  readonly characters?: string;
  readonly lines?: readonly unknown[];
};

/**
 * Horizontal text alignment
 */
export type TextAlignHorizontal = "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";

/**
 * Vertical text alignment
 */
export type TextAlignVertical = "TOP" | "CENTER" | "BOTTOM";

/**
 * Text decoration
 */
export type TextDecoration = "NONE" | "UNDERLINE" | "STRIKETHROUGH";

/**
 * Text case transformation.
 *
 * ORIGINAL: no transformation (display characters as stored)
 * UPPER: convert to uppercase
 * LOWER: convert to lowercase
 * TITLE: capitalize first letter of each word
 * SMALL_CAPS / SMALL_CAPS_FORCED: OpenType small-caps feature
 */
export type TextCase = "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";

/**
 * Size of text box
 */
export type TextBoxSize = {
  readonly width: number;
  readonly height: number;
};

/**
 * Extracted text properties from a Figma node.
 *
 * `font` is the canonical `FontQuery` describing the node's base font.
 * Per-character override fonts live on each `TextRun` from the runs
 * resolver. There are no flat `fontFamily`/`fontWeight`/`fontStyle` fields:
 * any code that needs the CSS-attribute form unpacks `font` at the boundary.
 */
export type ExtractedTextProps = {
  readonly transform: FigMatrix | undefined;
  readonly characters: string;
  readonly fontSize: number;
  readonly font: FontQuery;
  readonly letterSpacing: number | undefined;
  readonly lineHeight: number;
  readonly fillPaints: readonly FigPaint[] | undefined;
  readonly opacity: number;
  readonly textAlignHorizontal: TextAlignHorizontal;
  readonly textAlignVertical: TextAlignVertical;
  readonly textAutoResize: TextAutoResize;
  readonly textDecoration: TextDecoration;
  readonly size: TextBoxSize | undefined;
};

/**
 * Fill color and opacity result.
 *
 * `blendMode` is set when the source `Fill.blendMode` is anything
 * other than the implicit `NORMAL`. The renderer projects it onto the
 * per-pass `<path style="mix-blend-mode:…">` so the painter's-
 * algorithm composite matches Figma's compositor — required for
 * stacked text fills with OVERLAY / MULTIPLY / SOFT_LIGHT etc. (e.g.
 * the App Store template's `[{black @0.15 NORMAL}, {black @1
 * OVERLAY}]` Description / "Special event" text, which would
 * otherwise paint solid black instead of the intended medium grey).
 */
export type FillColorResult = {
  readonly color: string;
  readonly opacity: number;
  readonly blendMode?: BlendMode;
};
