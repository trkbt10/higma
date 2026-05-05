/**
 * @file Font helper utilities
 */

import type { AbstractFont } from "./types";

/**
 * Check if a font has a glyph for a character
 *
 * @param font - Font object (AbstractFont or opentype.js Font)
 * @param char - Character to check
 * @returns True if the font has a glyph for the character (not .notdef)
 */
export function fontHasGlyph(font: AbstractFont, char: string): boolean {
  const glyph = font.charToGlyph(char);
  // Glyph index 0 is always .notdef
  return glyph.index !== 0;
}
