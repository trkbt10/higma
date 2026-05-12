/**
 * @file Text node type definitions
 *
 * SoT for font/value types: @higma-document-models/fig/types.
 */

import type { FigMatrix, FigPaint } from "@higma-document-models/fig/types";
import type { FontQuery } from "@higma-document-models/fig/font";
import type { TextAutoResize } from "@higma-document-models/fig/scene-graph";

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
 * Fill color and opacity result
 */
export type FillColorResult = {
  readonly color: string;
  readonly opacity: number;
};
