/**
 * @file Font helper utilities.
 */

import type { AbstractFont } from "./types";

/**
 * Check if a font has a glyph for a character.
 *
 * Glyph index 0 is `.notdef` — the absence marker — so any non-zero index
 * means the font carries an actual outline for the requested character.
 */
export function fontHasGlyph(font: AbstractFont, char: string): boolean {
  const glyph = font.charToGlyph(char);
  return glyph.index !== 0;
}
