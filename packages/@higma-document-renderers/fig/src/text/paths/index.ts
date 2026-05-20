/**
 * @file Text path extraction module (format-agnostic)
 *
 * Provides glyph outline extraction from fonts and derived data.
 * Both SVG and WebGL backends consume the PathCommand arrays.
 */

// Types
export type {
  GlyphOutline,
  GlyphContour,
  PathContour,
  DecorationRect,
  TextPathResult,
} from "./types";

// Bezier conversion `convertQuadraticsToCubic` lives in
// `@higma-primitives/path`. Consumers import it directly from the
// primitive package; the `no-cross-package-reexport` rule forbids
// republishing it through this barrel.

// OpenType.js path extraction
export {
  calculateTextWidth,
  extractLinePathCommands,
  createUnderlineRect,
  extractTextPathData,
} from "./opentype-paths";

// Derived path extraction (functions only — types come from @higma-document-models/fig/domain)
export {
  transformGlyphCommands,
  extractDerivedGlyphCommands,
  extractDerivedDecorations,
  extractDerivedTextPathData,
  hasDerivedGlyphs,
} from "./derived-paths";

// SVG serialization
export {
  pathCommandsToSvgD,
  decorationRectToSvgD,
  textPathResultToSvgD,
} from "./serialize-svg";
