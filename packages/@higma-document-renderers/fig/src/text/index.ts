/**
 * @file Shared text pipeline (format-agnostic)
 *
 * Provides text layout, measurement, and path extraction
 * shared between SVG and WebGL renderers.
 */

export type {
  ExtractedTextProps,
  FillColorResult,
  TextAlignHorizontal,
  TextAlignVertical,
  TextAutoResize,
  TextDecoration,
  TextBoxSize,
  FigTextData,
} from "./layout";

export {
  extractTextProps,
  getValueWithUnits,
  getAlignedX,
  getAlignedYWithMetrics,
  type AlignYOptions,
  textAlignHorizontalToAnchor,
  type TextAnchor,
  getFillColorAndOpacity,
  computeTextLayout,
  textLayoutToCursorLayout,
  type TextLayout,
  type LayoutLine,
  type ComputeLayoutOptions,
  type CursorLayoutResult,
  type CursorLayoutLine,
  type CursorLayoutSpan,
} from "./layout";

export {
  createTextMeasurer,
} from "./measure";

export type {
  TextMeasurerInstance,
  MeasurementProvider,
  FontSpec,
} from "./measure";

// `convertQuadraticsToCubic` lives in `@higma-primitives/path`;
// consumers import it directly. Republishing it via this barrel is
// forbidden by `no-cross-package-reexport`.

export type {
  PathContour,
} from "./paths";

// Unified text rendering SoT
export {
  resolveTextRendering,
  resolveTextAscenderRatio,
  createCachedTextFontResolver,
  type CachedTextFontSource,
} from "./rendering";

export type {
  TextRendering,
  TextRenderingEmpty,
  TextRenderingGlyphs,
  TextRenderingLines,
  ResolveTextContext,
  TextFontResolver,
} from "./rendering";
