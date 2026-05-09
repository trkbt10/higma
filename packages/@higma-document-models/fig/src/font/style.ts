/**
 * @file Font style (italic / oblique) detection from style strings.
 */

/** CSS font-style values. */
export type FontStyle = "normal" | "italic" | "oblique";

const ITALIC_PATTERNS = ["italic", "ital", "it"] as const;
const OBLIQUE_PATTERNS = ["oblique", "slant", "slanted", "inclined"] as const;

/**
 * Detect font style from style string.
 *
 * @example
 * detectStyle("Regular") // "normal"
 * detectStyle("Bold Italic") // "italic"
 * detectStyle("Oblique") // "oblique"
 */
export function detectStyle(style: string | undefined): FontStyle {
  if (!style) {
    return "normal";
  }
  const styleLower = style.toLowerCase();
  // Oblique first — more specific than italic patterns; some font names
  // contain "italic" as a substring of "italicized oblique".
  if (OBLIQUE_PATTERNS.some((p) => styleLower.includes(p))) {
    return "oblique";
  }
  if (ITALIC_PATTERNS.some((p) => styleLower.includes(p))) {
    return "italic";
  }
  return "normal";
}

/** Whether `detectStyle(style)` is `"italic"`. */
export function isItalic(style: string | undefined): boolean {
  return detectStyle(style) === "italic";
}

/** Whether `detectStyle(style)` is `"oblique"`. */
export function isOblique(style: string | undefined): boolean {
  return detectStyle(style) === "oblique";
}

/** Whether `detectStyle(style)` is either `"italic"` or `"oblique"`. */
export function isSlanted(style: string | undefined): boolean {
  const s = detectStyle(style);
  return s === "italic" || s === "oblique";
}
