/**
 * @file Font type definitions.
 *
 * Provides abstract font types that are compatible with opentype.js
 * but don't directly depend on it. The renderer-side `font-drivers/*`
 * implementations satisfy these interfaces.
 */

import type { FontQuery } from "./query";
import type { FontStyle } from "./style";

// =============================================================================
// Abstract Font Types (opentype.js compatible)
// =============================================================================

/** Path command for SVG path data. */
export type PathCommand = {
  readonly type: "M" | "L" | "Q" | "C" | "Z";
  readonly x?: number;
  readonly y?: number;
  readonly x1?: number;
  readonly y1?: number;
  readonly x2?: number;
  readonly y2?: number;
};

/** Path object returned by `font.getPath()`. */
export type FontPath = {
  readonly commands: readonly PathCommand[];
  /** Convert to SVG path data string. */
  toPathData(decimalPlaces?: number): string;
};

/** Glyph object returned by `font.charToGlyph()`. */
export type AbstractGlyph = {
  /** Glyph index (0 = .notdef). */
  readonly index: number;
  /** Advance width in font units. */
  readonly advanceWidth?: number;
  /** Get the glyph path. */
  getPath(x: number, y: number, fontSize: number): FontPath;
};

/**
 * Abstract font interface compatible with opentype.js Font.
 *
 * This allows font drivers to return opentype.js Font objects while
 * keeping the model module independent of opentype.js.
 */
export type AbstractFont = {
  /** Units per em (typically 1000 or 2048). */
  readonly unitsPerEm: number;
  /** Ascender in font units (positive). */
  readonly ascender: number;
  /** Descender in font units (negative). */
  readonly descender: number;

  /** Convert a character to a glyph. */
  charToGlyph(char: string): AbstractGlyph;

  /** Convert text to an SVG path. */
  getPath(
    text: string,
    x: number,
    y: number,
    fontSize: number,
    options?: { letterSpacing?: number }
  ): FontPath;

  /** Font tables (optional, for advanced metrics). */
  readonly tables?: {
    readonly hhea?: { readonly lineGap?: number };
    readonly os2?: {
      readonly sCapHeight?: number;
      readonly sxHeight?: number;
    };
  };
};

// =============================================================================
// Font Loader Types
// =============================================================================

/**
 * Loaded font result.
 *
 * The `query` field is the canonical descriptor of which font this is —
 * loaders return the query of the font they actually loaded, which may
 * differ from the requested query if the loader did closest-match
 * substitution (e.g. requested weight 600, family had only 400 + 700).
 */
export type LoadedFont = {
  /** The loaded font object. */
  readonly font: AbstractFont;
  /** Identity of the loaded font (post-substitution). */
  readonly query: FontQuery;
  /** PostScript name. */
  readonly postscriptName?: string;
};

/**
 * Alias for backwards compatibility — every loader receives the same
 * concretely-defaulted shape so cache keys, dedup, and resolver lookups
 * all agree.
 */
export type FontLoadOptions = FontQuery;

// =============================================================================
// Font Resolution Types
// =============================================================================

/** Figma font reference (from .fig file). */
export type FigmaFontRef = {
  readonly family: string;
  readonly style: string;
  readonly postscript?: string;
};

/** Resolved font information. */
export type ResolvedFont = {
  /** CSS font-family value. */
  readonly fontFamily: string;
  /** Numeric font weight (100-900). */
  readonly fontWeight: number;
  /** Font style (normal, italic, oblique). */
  readonly fontStyle: FontStyle;
  /** Whether the exact font was found. */
  readonly isExactMatch: boolean;
  /** Original Figma font reference. */
  readonly source: FigmaFontRef;
  /** CSS font-family chain used. */
  readonly fontFamilyChain: readonly string[];
};

/** Font availability status. */
export type FontAvailability = {
  readonly available: boolean;
  readonly family: string;
  readonly variants: readonly FontVariant[];
};

/** Font variant (weight + style combination). */
export type FontVariant = {
  readonly weight: number;
  readonly style: FontStyle;
  readonly postscript?: string;
};

/** Font resolver configuration. */
export type FontResolverConfig = {
  /** Custom font mappings (Figma family -> CSS font stack). */
  readonly fontMappings?: ReadonlyMap<string, readonly string[]>;
  /** Default CSS generic font stack. */
  readonly defaultFontStack?: readonly string[];
  /** Font availability checker. */
  readonly availabilityChecker: FontAvailabilityChecker;
};

/** Font availability checker interface. */
export type FontAvailabilityChecker = {
  /** Check if a font family is available. */
  isAvailable(family: string): boolean | Promise<boolean>;

  /** Get available variants for a font family. */
  getVariants?(family: string): readonly FontVariant[] | Promise<readonly FontVariant[]>;
};

/** Font metrics (for text measurement). */
export type FontMetrics = {
  /** Units per em. */
  readonly unitsPerEm: number;
  /** Ascender (positive, above baseline). */
  readonly ascender: number;
  /** Descender (negative, below baseline). */
  readonly descender: number;
  /** Line gap. */
  readonly lineGap: number;
  /** Cap height (height of capital letters). */
  readonly capHeight?: number;
  /** X-height (height of lowercase x). */
  readonly xHeight?: number;
};
