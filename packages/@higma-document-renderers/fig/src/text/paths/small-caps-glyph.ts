/**
 * @file Per-character glyph resolution honouring Figma's `textCase`.
 *
 * Acts as the single entry point text-measurement (`buildLineMeasurer`)
 * and text-emit (`extractGlyphPathContours`,
 * `calculateMixedFontTextWidth`) both consult. Concentrating the
 * substitution logic in one routine keeps measure and paint agreed on
 * which glyph each character resolves to — a divergence would
 * silently change wrap break points without changing the painted
 * outline (or vice versa), producing the "ellipsis floats two lines
 * up" class of regression.
 *
 * Figma's `textCase = SMALL_CAPS` substitutes lowercase characters
 * with their `smcp` (small-caps) glyph variant when the font ships
 * one, leaving uppercase characters untouched. `SMALL_CAPS_FORCED`
 * additionally substitutes uppercase characters with their `c2sc`
 * variant so the entire run renders at small-caps size. When the
 * font has no GSUB entry for a character / feature pair, this
 * helper falls back to the uppercase form of the original character
 * — matching the historical `toUpperCase()` approximation so legacy
 * fonts continue to render at the larger uppercase height instead of
 * showing an unintended lowercase glyph.
 */

import type { AbstractFont, AbstractGlyph } from "@higma-document-models/fig/font";
import type { TextCase } from "../layout";

/**
 * The pairing of glyph + per-glyph font-size scale the measurer and
 * the emitter both consume. `fontSizeScale` is reserved for future
 * per-glyph scaling (e.g. variant-defined subscript / superscript
 * features); the current SMALL_CAPS path resolves either to a
 * substituted glyph at scale 1 or, when no `smcp` / `c2sc` lookup is
 * available, to the original glyph at scale 1. Keeping the field on
 * the type lets the measurer and emitter share one return shape
 * regardless of which branch the resolver took.
 */
export type TextCaseGlyph = {
  readonly glyph: AbstractGlyph;
  readonly fontSizeScale: number;
};

/**
 * Whether a character is a lowercase letter (i.e. differs from its
 * `toUpperCase()` form). Used to decide whether to route the character
 * through `smcp`. Non-letters fall through unchanged on the lower
 * branch — `0`, `,`, whitespace, etc. are case-stable so this returns
 * `false` and the renderer keeps the original glyph.
 */
function isLowercaseLetter(char: string): boolean {
  return char !== char.toUpperCase() && char === char.toLowerCase();
}

/**
 * Symmetric of `isLowercaseLetter`. The `SMALL_CAPS_FORCED` branch
 * uses this to decide whether to apply `c2sc`.
 */
function isUppercaseLetter(char: string): boolean {
  return char !== char.toLowerCase() && char === char.toUpperCase();
}

/**
 * Resolve the glyph to render for `char` given the run's `textCase`.
 *
 * The branch table:
 *   - `SMALL_CAPS` + lowercase letter → `smcp` substitution at full
 *     font size; when the font ships no `smcp` lookup, **render the
 *     original glyph unchanged** — Figma's SVG exporter does NOT
 *     synthesise small caps for non-smcp fonts (verified
 *     bit-for-bit against `text-case` Noto Sans JP fixture: the
 *     "Small Caps" line renders mixed-case literally, no lowercase
 *     shrink, no uppercase substitution). The earlier `toUpperCase()`
 *     and `0.75x` synthesis paths both diverged from this — keeping
 *     the original glyph reproduces Figma's behaviour exactly.
 *   - `SMALL_CAPS_FORCED` + lowercase letter → same as `SMALL_CAPS`.
 *   - `SMALL_CAPS_FORCED` + uppercase letter → `c2sc` substitution at
 *     full font size; when the font ships no `c2sc` lookup, render
 *     the original uppercase glyph unchanged (matches Figma's
 *     "no-op when the font can't honour the request" policy).
 *   - Anything else → plain `charToGlyph(char)` at full size.
 *
 * The CSS `font-variant-caps: small-caps` spec leaves the
 * non-supporting font behaviour implementation-defined; Figma
 * resolves to no-op here, so the renderer matches that choice.
 */
export function resolveTextCaseGlyph(
  font: AbstractFont,
  char: string,
  textCase: TextCase,
): TextCaseGlyph {
  if (textCase !== "SMALL_CAPS" && textCase !== "SMALL_CAPS_FORCED") {
    return { glyph: font.charToGlyph(char), fontSizeScale: 1 };
  }
  const substitute = font.substituteGlyph;
  if (isLowercaseLetter(char) && substitute !== undefined) {
    const smallCap = substitute.call(font, char, "smcp");
    if (smallCap !== undefined) {
      return { glyph: smallCap, fontSizeScale: 1 };
    }
  }
  if (textCase === "SMALL_CAPS_FORCED" && isUppercaseLetter(char) && substitute !== undefined) {
    const c2sc = substitute.call(font, char, "c2sc");
    if (c2sc !== undefined) {
      return { glyph: c2sc, fontSizeScale: 1 };
    }
  }
  return { glyph: font.charToGlyph(char), fontSizeScale: 1 };
}
