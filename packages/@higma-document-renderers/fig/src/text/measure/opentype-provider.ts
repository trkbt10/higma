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

  function estimateMeasurement(text: string, font: FontSpec): TextMeasurement {
    const avgWidth = font.fontSize * 0.5;
    const letterSpacing = font.letterSpacing ?? 0;
    const width = text.length * avgWidth + (text.length - 1) * letterSpacing;
    const ascent = font.fontSize * 0.8;
    const descent = font.fontSize * 0.2;

    return {
      width,
      height: ascent + descent,
      ascent,
      descent,
    };
  }

  function estimateCharWidths(text: string, font: FontSpec): readonly number[] {
    const avgWidth = font.fontSize * 0.5;
    const letterSpacing = font.letterSpacing ?? 0;
    return Array.from(text).map((_, i) =>
      i < text.length - 1 ? avgWidth + letterSpacing : avgWidth
    );
  }

  function estimateFontMetrics(_font: FontSpec): FontMetrics {
    return {
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
    };
  }

  function getFontMetrics(font: FontSpec): FontMetrics {
    const opentypeFont = getCachedFont(font);

    if (!opentypeFont) {
      return estimateFontMetrics(font);
    }

    return {
      unitsPerEm: opentypeFont.unitsPerEm,
      ascender: opentypeFont.ascender,
      descender: opentypeFont.descender,
      lineGap: (opentypeFont.tables?.hhea?.lineGap as number) ?? 0,
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
      const opentypeFont = getCachedFont(font);

      if (!opentypeFont) {
        return estimateMeasurement(text, font);
      }

      // Optical-size axis tracks the rendered font-size — sync it
      // before reading advance widths or the measurement diverges
      // from what the path renderer paints.
      opentypeFont.setOpticalSize?.(font.fontSize);
      const scale = font.fontSize / opentypeFont.unitsPerEm;
      const letterSpacing = font.letterSpacing ?? 0;

      const widthRef = { value: 0 };
      // Track the previous glyph so we can add the font's pair-adjust
      // value before stamping the next glyph's advance. The browser
      // does this implicitly (`font-kerning: auto` is the default) so
      // not folding it in here leaves the rendered line systematically
      // wider than the captured screenshot wherever the font ships a
      // GPOS pair (most modern proportional fonts).
      let previousGlyph: AbstractGlyph | undefined;
      for (let i = 0; i < text.length; i++) {
        const glyph = opentypeFont.charToGlyph(text[i]);
        if (previousGlyph !== undefined) {
          widthRef.value += kerningBetween(opentypeFont, previousGlyph, glyph) * scale;
        }
        widthRef.value += (glyph.advanceWidth ?? 0) * scale;
        if (i < text.length - 1) {
          widthRef.value += letterSpacing;
        }
        previousGlyph = glyph;
      }

      const ascent = opentypeFont.ascender * scale;
      const descent = Math.abs(opentypeFont.descender * scale);

      return {
        width: widthRef.value,
        height: ascent + descent,
        ascent,
        descent,
      };
    },

    measureCharWidths(text: string, font: FontSpec): readonly number[] {
      const opentypeFont = getCachedFont(font);

      if (!opentypeFont) {
        return estimateCharWidths(text, font);
      }

      // Tune the variable-font `opsz` axis to the rendered font-size
      // before reading advance widths, otherwise the wrap measurement
      // is computed at the file's default optical size and the
      // resulting break points drift from what the renderer paints.
      opentypeFont.setOpticalSize?.(font.fontSize);
      const scale = font.fontSize / opentypeFont.unitsPerEm;
      const letterSpacing = font.letterSpacing ?? 0;
      const widths: number[] = [];
      // Fold the pair-adjustment between char[i-1] and char[i] into
      // char[i]'s reported width. The renderer's wrap planner sums
      // these widths to test "does it fit?" and the wrap-break point
      // has to agree with the eventual painted width — keeping the
      // kerning out of measure but in paint produces shifted break
      // points and the diff regresses.
      let previousGlyph: AbstractGlyph | undefined;
      for (let i = 0; i < text.length; i++) {
        const glyph = opentypeFont.charToGlyph(text[i]);
        const charWidthRef = { value: (glyph.advanceWidth ?? 0) * scale };
        if (previousGlyph !== undefined) {
          charWidthRef.value += kerningBetween(opentypeFont, previousGlyph, glyph) * scale;
        }
        if (i < text.length - 1) {
          charWidthRef.value += letterSpacing;
        }
        widths.push(charWidthRef.value);
        previousGlyph = glyph;
      }

      return widths;
    },

    getFontMetrics,

    getAscenderRatio(font: FontSpec): number {
      const metrics = getFontMetrics(font);
      return metrics.ascender / metrics.unitsPerEm;
    },
  };
}

/**
 * Async measurement helpers
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
