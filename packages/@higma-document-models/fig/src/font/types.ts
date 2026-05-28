/**
 * @file Font type definitions.
 *
 * Provides abstract font types that can be backed by opentype.js
 * but don't directly depend on it. The renderer-side `font-drivers/*`
 * implementations satisfy these interfaces.
 */

import type { PathCommand } from "@higma-primitives/path";
import type { FontQuery } from "./query";
import type { FontStyle } from "./style";

// =============================================================================
// Abstract Font Types
// =============================================================================

// `PathCommand` lives in `@higma-primitives/path` — the SoT. Local
// consumers of the font types reach for it through this module's own
// imports; external consumers must import it from the primitive
// package directly. The `no-cross-package-reexport` lint rule
// forbids republishing the primitive type through this barrel.

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
 * Abstract font interface satisfied by opentype.js Font.
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
    readonly hhea?: {
      readonly lineGap?: number;
      /**
       * `hhea.Ascender` in font units. Per CSS Inline L3 §5.5 the
       * renderer uses this when the font's OS/2 table either omits the
       * typo entries or does not set the `USE_TYPO_METRICS` bit in
       * `fsSelection` — that flag is the spec-defined opt-in that
       * promotes sTypo* over the classical hhea metrics, and CJK
       * faces like Noto Sans JP ship without it so their hhea
       * (=usWinAscent on Noto) values drive line layout.
       */
      readonly ascender?: number;
      /** `hhea.Descender` in font units (negative). */
      readonly descender?: number;
    };
    /**
     * `post` table. Carries the underline placement metrics the
     * renderer reads when computing the `textDecoration: UNDERLINE`
     * rectangle: `underlinePosition` (negative = below baseline,
     * units) and `underlineThickness` (positive, units).
     */
    readonly post?: {
      readonly underlinePosition?: number;
      readonly underlineThickness?: number;
    };
    readonly os2?: {
      readonly sCapHeight?: number;
      readonly sxHeight?: number;
      /**
       * Typographic ascender per the OS/2 spec.
       *
       * Per CSS Inline Layout Level 3 §5.5 the renderer uses these
       * metrics ONLY when the font sets the `USE_TYPO_METRICS` bit
       * (`fsSelection` bit 7, mask `0x80`). For fonts that leave the
       * bit clear (CJK faces in particular — Noto Sans JP ships
       * `sTypoAscender=880` but `usWinAscent=1160=hhea.ascender`),
       * `typoAscenderUnits` falls back to `hhea.ascender` so the
       * resolved baseline lands at the same y as the browser's
       * first-line baseline (and Figma's SVG export).
       */
      readonly sTypoAscender?: number;
      /** Typographic descender per the OS/2 spec (negative). */
      readonly sTypoDescender?: number;
      /** Typographic line gap per the OS/2 spec. */
      readonly sTypoLineGap?: number;
      /**
       * `OS/2.fsSelection` flag bits. Bit 7 (mask `0x80`) is
       * `USE_TYPO_METRICS` — when set the renderer uses
       * `sTypoAscender` / `sTypoDescender` for line layout, otherwise
       * it falls back to `hhea.ascender` / `hhea.descender`. See
       * the CSS Inline L3 reference above on the `sTypoAscender`
       * field for the rest of the rationale.
       */
      readonly fsSelection?: number;
      /**
       * Strikethrough centerline position above the baseline, in font
       * units (positive = above baseline). The renderer uses this to
       * place the `textDecoration: STRIKETHROUGH` rectangle — Figma's
       * SVG exporter draws the strike at exactly
       * `baselineY - (yStrikeoutPosition × fontSize / unitsPerEm)`,
       * with `yStrikeoutSize` setting the rectangle's height.
       */
      readonly yStrikeoutPosition?: number;
      /** Strikethrough rectangle thickness, in font units. */
      readonly yStrikeoutSize?: number;
    };
  };

  /**
   * Apply a per-render `opsz` (optical size) axis value, in CSS
   * pixels, for subsequent `charToGlyph` requests. Implementations
   * backed by a variable font carry an `opsz` axis (SF Pro, Roboto
   * Flex, Inter Variable, …) and must propagate the value into the
   * glyph-path interpolation; static fonts ignore the call.
   *
   * Defined here so the renderer's text path emitter can tune optical
   * size without reaching down into a specific driver. Callers
   * invoke it once per text run with the run's `fontSize`. Callers
   * are NOT required to call it — fonts return their default
   * instance when no setter runs.
   */
  setOpticalSize?(fontSizePx: number): void;

  /**
   * Return the kerning adjustment between two adjacent glyphs in font
   * units. The renderer's measurer and path walker add this to the
   * running advance so glyph pairs covered by the font's `kern` table
   * (legacy) or GPOS pair adjustment lookup (modern) line up with the
   * browser's measurement. Returns `0` when the font has no entry for
   * the pair, and may be omitted entirely when the driver can't
   * surface kern data — callers must treat it as optional and fall
   * through to plain advance summation.
   *
   * Argument shape mirrors opentype.js: callers may pass either the
   * `AbstractGlyph` object or its numeric glyph index, so the same
   * underlying Font instance can satisfy both this interface and the
   * opentype.js native signature directly.
   *
   * Defined here rather than reaching into opentype.js so non-Node
   * font drivers (browser, future native) can stay free of the
   * opentype.js dependency while still feeding the same measurer.
   */
  getKerningValue?(
    leftGlyph: AbstractGlyph | number,
    rightGlyph: AbstractGlyph | number,
  ): number;

  /**
   * Substitute a character's base glyph via an OpenType GSUB feature.
   * Returns the substituted glyph when the font's GSUB table maps the
   * character through the named feature; returns `undefined` when no
   * substitution applies (caller falls back to `charToGlyph`).
   *
   * The renderer uses this to honour Figma's `textCase = SMALL_CAPS` /
   * `SMALL_CAPS_FORCED` by routing lowercase characters through `smcp`
   * (and, for `SMALL_CAPS_FORCED`, uppercase characters through `c2sc`)
   * — Figma's editor and SVG exporter render true small-caps glyphs
   * out of the font instead of a `toUpperCase()` approximation.
   *
   * Implementations missing `gsub` data (legacy fonts, drivers that
   * don't surface GSUB) may omit the method entirely; callers must
   * handle `undefined` by falling back to the plain character glyph.
   */
  substituteGlyph?(char: string, feature: "smcp" | "c2sc"): AbstractGlyph | undefined;
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
  /**
   * Ascender in font units (positive, above baseline). The metric the
   * renderer uses for CSS line-box layout — modern browsers source
   * this from `OS/2.sTypoAscender` when present (CSS Inline L3), with
   * the `hhea` ascender as the legacy fallback for fonts that don't
   * carry an OS/2 table.
   */
  readonly ascender: number;
  /** Descender in font units (negative, below baseline). Same precedence as `ascender`. */
  readonly descender: number;
  /**
   * Line gap in font units. The leading the font ships as its
   * intended inter-line space when `line-height: normal`. Per CSS
   * Inline L3 the browser uses `OS/2.sTypoLineGap` when available.
   */
  readonly lineGap: number;
  /** Cap height (height of capital letters). */
  readonly capHeight?: number;
  /** X-height (height of lowercase x). */
  readonly xHeight?: number;
};
