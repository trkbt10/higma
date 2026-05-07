/**
 * @file Compact glyph for each fig node type, used by the layers tree
 * and inspect panel header.
 *
 * VS Code ships codicons, but bundling the icon font into the webview
 * just to label tree rows is heavier than the value. The glyph table
 * here is intentionally text-only and theme-foreground-coloured so it
 * adopts the active VS Code theme without per-icon assets.
 */

import type { FigDesignNode } from "@higma-document-models/fig/domain";

type FigNodeType = FigDesignNode["type"];

/**
 * Single-character glyphs picked to be visually distinct at 12-13px
 * without an icon font. Unrecognised types fall through to a neutral
 * dot so a new fig node kind doesn't blank the UI.
 */
const GLYPHS: Partial<Record<FigNodeType, string>> = {
  FRAME: "▢",
  GROUP: "⊞",
  SECTION: "§",
  COMPONENT: "◆",
  COMPONENT_SET: "◇",
  INSTANCE: "◆",
  RECTANGLE: "▭",
  ELLIPSE: "○",
  LINE: "—",
  VECTOR: "◇",
  STAR: "✦",
  REGULAR_POLYGON: "⬠",
  TEXT: "T",
  BOOLEAN_OPERATION: "⨁",
  SLICE: "✂",
};






export function nodeTypeGlyph(type: FigNodeType): string {
  return GLYPHS[type] ?? "·";
}






export function nodeTypeLabel(type: FigNodeType): string {
  // Lowercase the enum value for display ("RECTANGLE" → "rectangle"),
  // mirroring Figma's casing in the inspect panel ("Rectangle 1" /
  // "Rectangle"). We only convert the first character to upper-case
  // so we get "Rectangle" and "Component set" instead of all-caps.
  const lower = type.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
