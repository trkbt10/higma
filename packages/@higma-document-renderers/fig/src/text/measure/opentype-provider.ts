/**
 * @file OpenType.js based measurement provider
 *
 * Provides accurate text measurement using opentype.js font parsing.
 * Requires FontLoader to load font files.
 */

import type { FontLoader, LoadedFont, FontMetrics, AbstractFont, AbstractGlyph } from "@higma-document-models/fig/font";
import { fontQueryKey } from "@higma-document-models/fig/font";
import type { MeasurementProvider, FontSpec, TextMeasurement } from "./types";

/**
 * Look up the kerning pair adjustment between two glyphs in font
 * units. Returns 0 when the font driver doesn't surface
 * `getKerningValue` (estimation-only fonts, static webfonts without a
 * kern table). Centralised so the two measurement loops below stay
 * symmetric — diverging the wrap-time and paint-time kerning sources
 * is exactly the kind of drift the rest of this file is structured to
 * prevent.
 */
function kerningBetween(
  font: AbstractFont,
  leftGlyph: AbstractGlyph,
  rightGlyph: AbstractGlyph,
): number {
  if (typeof font.getKerningValue !== "function") {
    return 0;
  }
  return font.getKerningValue(leftGlyph, rightGlyph);
}

function glyphsForText(font: AbstractFont, text: string): readonly AbstractGlyph[] {
  return Array.from({ length: text.length }, (_, index) => font.charToGlyph(text[index]));
}

function kerningPxAt(
  font: AbstractFont,
  glyphs: readonly AbstractGlyph[],
  index: number,
  scale: number,
): number {
  if (index === 0) {
    return 0;
  }
  const leftGlyph = glyphs[index - 1];
  const rightGlyph = glyphs[index];
  if (leftGlyph === undefined || rightGlyph === undefined) {
    throw new Error("OpenType text measurement received an invalid glyph index");
  }
  return kerningBetween(font, leftGlyph, rightGlyph) * scale;
}

function letterSpacingPxAt(index: number, length: number, letterSpacing: number): number {
  if (index < length - 1) {
    return letterSpacing;
  }
  return 0;
}

function glyphAdvancePxAt(
  font: AbstractFont,
  glyphs: readonly AbstractGlyph[],
  index: number,
  scale: number,
  letterSpacing: number,
): number {
  const glyph = glyphs[index];
  if (glyph === undefined) {
    throw new Error("OpenType text measurement received an invalid glyph index");
  }
  return (
    kerningPxAt(font, glyphs, index, scale) +
    (glyph.advanceWidth ?? 0) * scale +
    letterSpacingPxAt(index, glyphs.length, letterSpacing)
  );
}

/** OpenType.js based measurement provider instance */
export type OpentypeMeasurementProviderInstance = MeasurementProvider & {
  /** Preload fonts for later synchronous use */
  preloadFont(font: FontSpec): Promise<boolean>;
  /** Get ascender ratio (ascender / unitsPerEm) */
  getAscenderRatio(font: FontSpec): number;
  /** Get font metrics */
  getFontMetrics(font: FontSpec): FontMetrics;
};

/**
 * Create an OpenType.js based measurement provider
 *
 * Uses actual font files for precise text measurement.
 */
export function createOpentypeMeasurementProvider(fontLoader: FontLoader): OpentypeMeasurementProviderInstance {
  const fontCache = new Map<string, LoadedFont>();

  function getCacheKey(spec: FontSpec): string {
    return fontQueryKey(spec.font);
  }

  async function loadFontForSpec(spec: FontSpec): Promise<LoadedFont | undefined> {
    const key = getCacheKey(spec);
    const cached = fontCache.get(key);
    if (cached) {return cached;}

    const loaded = await fontLoader.loadFont(spec.font);

    if (loaded) {
      fontCache.set(key, loaded);
    }

    return loaded;
  }

  function getCachedFont(spec: FontSpec): AbstractFont | undefined {
    const key = getCacheKey(spec);
    return fontCache.get(key)?.font;
  }

  function requireCachedFont(spec: FontSpec): AbstractFont {
    const font = getCachedFont(spec);
    if (font) {
      return font;
    }
    throw new Error(`OpenType text measurement requires preloaded font "${spec.font.family}"`);
  }

  function getFontMetrics(font: FontSpec): FontMetrics {
    const opentypeFont = getCachedFont(font);
    if (!opentypeFont) { throw new Error(`OpenType text measurement requires preloaded font "${font.font.family}"`); }

    // CSS Inline L3 derives the line box's ascent / descent from
    // `OS/2.sTypoAscender` / `OS/2.sTypoDescender` regardless of the
    // `USE_TYPO_METRICS` (`fsSelection` bit 7) flag — every modern
    // browser follows this. The `hhea` ascender (which opentype.js
    // exposes as `font.ascender`) is the historical alternative for
    // fonts that don't carry an OS/2 table at all. Reading the typo
    // metrics here closes a noticeable baseline-position gap on faces
    // whose `hhea` and `OS/2.sTypo` differ — notably CJK fonts like
    // Noto Sans JP, where `hhea.ascender = 1160` but
    // `sTypoAscender = 880` (a 5px first-line baseline gap at
    // fontSize=16).
    const os2 = opentypeFont.tables?.os2;
    const ascender = typeof os2?.sTypoAscender === "number" ? os2.sTypoAscender : opentypeFont.ascender;
    const descender = typeof os2?.sTypoDescender === "number" ? os2.sTypoDescender : opentypeFont.descender;
    const typoLineGap = typeof os2?.sTypoLineGap === "number" ? os2.sTypoLineGap : undefined;
    const hheaLineGap = (opentypeFont.tables?.hhea?.lineGap as number | undefined) ?? 0;
    const lineGap = typoLineGap ?? hheaLineGap;
    return {
      unitsPerEm: opentypeFont.unitsPerEm,
      ascender,
      descender,
      lineGap,
      capHeight: (opentypeFont.tables?.os2?.sCapHeight as number) ?? undefined,
      xHeight: (opentypeFont.tables?.os2?.sxHeight as number) ?? undefined,
    };
  }

  return {
    async preloadFont(font: FontSpec): Promise<boolean> {
      const loaded = await loadFontForSpec(font);
      return loaded !== undefined;
    },

    measureText(text: string, font: FontSpec): TextMeasurement {
      const opentypeFont = requireCachedFont(font);

      // Optical-size axis tracks the rendered font-size — sync it
      // before reading advance widths or the measurement diverges
      // from what the path renderer paints.
      opentypeFont.setOpticalSize?.(font.fontSize);
      const scale = font.fontSize / opentypeFont.unitsPerEm;
      const letterSpacing = font.letterSpacing ?? 0;
      const glyphs = glyphsForText(opentypeFont, text);
      // Track the previous glyph so we can add the font's pair-adjust
      // value before stamping the next glyph's advance. The browser
      // does this implicitly (`font-kerning: auto` is the default) so
      // not folding it in here leaves the rendered line systematically
      // wider than the captured screenshot wherever the font ships a
      // GPOS pair (most modern proportional fonts).
      const width = glyphs.reduce((sum, _glyph, index) => (
        sum + glyphAdvancePxAt(opentypeFont, glyphs, index, scale, letterSpacing)
      ), 0);

      const ascent = opentypeFont.ascender * scale;
      const descent = Math.abs(opentypeFont.descender * scale);

      return {
        width,
        height: ascent + descent,
        ascent,
        descent,
      };
    },

    measureCharWidths(text: string, font: FontSpec): readonly number[] {
      const opentypeFont = requireCachedFont(font);

      // Tune the variable-font `opsz` axis to the rendered font-size
      // before reading advance widths, otherwise the wrap measurement
      // is computed at the file's default optical size and the
      // resulting break points drift from what the renderer paints.
      opentypeFont.setOpticalSize?.(font.fontSize);
      const scale = font.fontSize / opentypeFont.unitsPerEm;
      const letterSpacing = font.letterSpacing ?? 0;
      const glyphs = glyphsForText(opentypeFont, text);
      // Fold the pair-adjustment between char[i-1] and char[i] into
      // char[i]'s reported width. The renderer's wrap planner sums
      // these widths to test "does it fit?" and the wrap-break point
      // has to agree with the eventual painted width — keeping the
      // kerning out of measure but in paint produces shifted break
      // points and the diff regresses.
      return glyphs.map((_glyph, index) => (
        glyphAdvancePxAt(opentypeFont, glyphs, index, scale, letterSpacing)
      ));
    },

    getFontMetrics,

    getAscenderRatio(font: FontSpec): number {
      const metrics = getFontMetrics(font);
      return metrics.ascender / metrics.unitsPerEm;
    },
  };
}

/**
 * Async measurement functions
 */
export async function measureTextAsync(
  provider: OpentypeMeasurementProviderInstance,
  text: string,
  font: FontSpec
): Promise<TextMeasurement> {
  await provider.preloadFont(font);
  return provider.measureText(text, font);
}






/** Get the ascender ratio for a font asynchronously */
export async function getAscenderRatioAsync(
  provider: OpentypeMeasurementProviderInstance,
  font: FontSpec
): Promise<number> {
  await provider.preloadFont(font);
  return provider.getAscenderRatio(font);
}
