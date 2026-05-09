/**
 * @file Shared path types for text rendering
 *
 * Uses PathCommand from font/types.ts as the canonical format.
 * Both SVG serialization and WebGL tessellation consume these types.
 */

import type { PathCommand } from "@higma-document-models/fig/font";

/**
 * A single glyph's outline path data
 */
export type GlyphOutline = {
  /** Path commands for this glyph */
  readonly commands: readonly PathCommand[];
};

/**
 * A contour (closed path segment)
 */
export type PathContour = {
  readonly commands: readonly PathCommand[];
  readonly windingRule?: "nonzero" | "evenodd";
};

/**
 * Shared glyph annotation: the source-character index that a glyph
 * outline corresponds to. SoT for "which character does this contour
 * paint?" — both `text/paths/GlyphContour` (commands are font/types
 * PathCommand) and `scene-graph/GlyphContour` (commands are
 * scene-graph PathCommand) intersect with this annotation rather than
 * each redeclaring the field.
 *
 * `firstCharacter` is `undefined` for contours that don't map to a
 * single source character — Figma's auto-inserted ellipsis glyph for
 * truncated text, opentype.js fallback line contours, and so on. The
 * run grouper folds those into the base run.
 */
export type GlyphCharacterIndex = {
  readonly firstCharacter: number | undefined;
};

/**
 * A text-glyph outline contour, annotated with the source character
 * the glyph corresponds to. See `GlyphCharacterIndex` for the
 * annotation semantics.
 */
export type GlyphContour = PathContour & GlyphCharacterIndex;

/**
 * Decoration rectangle (underline, strikethrough)
 */
export type DecorationRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * Result of text path extraction
 */
export type TextPathResult = {
  /** Glyph outline paths, one entry per source glyph. */
  readonly glyphContours: readonly GlyphContour[];
  /** Decoration paths (underlines, strikethroughs) */
  readonly decorations: readonly DecorationRect[];
};

