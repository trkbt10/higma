/**
 * @file Text layout module (format-agnostic)
 *
 * Provides text property extraction, alignment, and fill handling
 * shared between SVG and WebGL renderers.
 */

// Types
export type {
  ExtractedTextProps,
  FillColorResult,
  TextAlignHorizontal,
  TextAlignVertical,
  TextDecoration,
  TextBoxSize,
  FigTextData,
} from "./types";

// Property extraction
export { extractTextProps, getValueWithUnits, type TextNodeInput } from "./extract-props";

// Alignment
export {
  getAlignedX,
  getAlignedYWithMetrics,
  type AlignYOptions,
} from "./alignment";

export {
  textAlignHorizontalToAnchor,
  type TextAnchor,
} from "./text-anchor";

// Fill handling
export { getFillColorAndOpacity, getAllVisibleSolidFills } from "./fill";

// Layout computation
export {
  computeTextLayout,
  textLayoutToCursorLayout,
  type TextLayout,
  type LayoutLine,
  type TextLayoutSourceLine,
  type ComputeLayoutOptions,
  type CursorLayoutResult,
  type CursorLayoutLine,
  type CursorLayoutSpan,
} from "./compute-layout";
