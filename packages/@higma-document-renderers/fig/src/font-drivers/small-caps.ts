/**
 * @file OpenType small-caps (`smcp` / `c2sc`) GSUB lookup wrapper.
 *
 * Figma's `textCase = SMALL_CAPS` and `SMALL_CAPS_FORCED` request the
 * font's true small-caps glyphs — not the `toUpperCase()` approximation
 * the path renderer historically emitted. This wrapper teaches an
 * opentype.js Font to answer `substituteGlyph(char, "smcp")` by
 * consulting its GSUB table for the requested feature and returning
 * the substituted glyph (or `undefined` when the font ships no entry
 * for that character / feature).
 *
 * The lookups are computed lazily — the first call per feature builds
 * a `glyphIndex → glyphIndex` map by walking
 * `font.substitution.getSingle(feature, script)` across the scripts
 * Figma's editor consults (`latn`, `DFLT`). Subsequent calls hit the
 * cached map, so the hot path inside `extractGlyphPathContours` stays
 * O(1) per character.
 *
 * Composes with `wrapFontWithVariation` — applied first to the raw
 * opentype.js Font so the variation wrapper sees the
 * `substituteGlyph` method and forwards it (the variation view then
 * wraps the substituted glyph in its variation transform, keeping
 * variable-font weight tuning consistent with the base glyph path).
 */

import type { AbstractFont, AbstractGlyph } from "@higma-document-models/fig/font";

type SmallCapsFeature = "smcp" | "c2sc";

/**
 * Subset of opentype.js's Font surface used by the smcp wrapper. The
 * cast is local to this module so the renderer-facing `AbstractFont`
 * never needs to know about opentype.js's substitution surface.
 */
type OpentypeSmallCapsFont = AbstractFont & {
  readonly substitution?: {
    getSingle?(
      feature: string,
      script?: string,
      language?: string,
    ): readonly { readonly sub: number; readonly by: number }[] | undefined;
  };
  readonly glyphs?: {
    get(index: number): AbstractGlyph;
  };
};

const SCRIPTS_TO_PROBE: readonly string[] = ["latn", "DFLT"];

/**
 * Build `glyphIndex → substitutedGlyphIndex` map for one feature by
 * walking every script Figma's editor honours. Scripts that the font
 * doesn't declare contribute nothing — `getSingle` returns
 * `undefined` and the loop moves on.
 */
function buildFeatureMap(font: OpentypeSmallCapsFont, feature: SmallCapsFeature): Map<number, number> {
  const map = new Map<number, number>();
  const getSingle = font.substitution?.getSingle;
  if (typeof getSingle !== "function") {
    return map;
  }
  for (const script of SCRIPTS_TO_PROBE) {
    const entries = safeGetSingle(getSingle, font.substitution, feature, script);
    if (entries === undefined) {
      continue;
    }
    for (const { sub, by } of entries) {
      // Earlier scripts take precedence — `latn` populated `map` first,
      // and `DFLT` only fills in glyphs the script-specific lookup
      // didn't already substitute.
      if (!map.has(sub)) {
        map.set(sub, by);
      }
    }
  }
  return map;
}

/**
 * Call `getSingle` defensively — opentype.js raises when the script
 * isn't declared by the font (instead of returning an empty array),
 * and the absence of a script must NOT abort the small-caps wrapper.
 */
function safeGetSingle(
  getSingle: NonNullable<NonNullable<OpentypeSmallCapsFont["substitution"]>["getSingle"]>,
  thisArg: OpentypeSmallCapsFont["substitution"],
  feature: SmallCapsFeature,
  script: string,
): readonly { readonly sub: number; readonly by: number }[] | undefined {
  try {
    return getSingle.call(thisArg, feature, script);
  } catch {
    return undefined;
  }
}

/**
 * Return a Font view augmented with `substituteGlyph(char, feature)`.
 * The wrapper is intentionally thin — it delegates every other Font
 * method to the underlying instance unchanged, only intercepting the
 * one new entry point.
 */
export function wrapFontWithSmallCaps(font: AbstractFont): AbstractFont {
  const inner = font as OpentypeSmallCapsFont;
  const featureMaps = new Map<SmallCapsFeature, Map<number, number>>();
  const getFeatureMap = (feature: SmallCapsFeature): Map<number, number> => {
    const cached = featureMaps.get(feature);
    if (cached !== undefined) {
      return cached;
    }
    const map = buildFeatureMap(inner, feature);
    featureMaps.set(feature, map);
    return map;
  };
  const substituteGlyph = (char: string, feature: SmallCapsFeature): AbstractGlyph | undefined => {
    const baseGlyph = font.charToGlyph(char);
    const map = getFeatureMap(feature);
    const substitutedIndex = map.get(baseGlyph.index);
    if (substitutedIndex === undefined) {
      return undefined;
    }
    const lookup = inner.glyphs?.get;
    if (typeof lookup !== "function") {
      return undefined;
    }
    return lookup.call(inner.glyphs, substitutedIndex);
  };
  return new Proxy(font, {
    get(target, key, receiver) {
      if (key === "substituteGlyph") {
        return substituteGlyph;
      }
      return Reflect.get(target, key, receiver);
    },
  });
}
