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
// SYMBOL is the on-disk encoding of the Figma UI concept "Component"
// (the canonical schema has no COMPONENT or COMPONENT_SET NodeType;
// a "Component Set" / "Variant Set" is a FRAME with variant
// metadata). The presentation label for SYMBOL still surfaces as
// "Component" in the UI — see `nodeTypeLabel`. Detection of variant
// sets is up to the caller. See
// `docs/refactor/component-type-cleanup.md`.
const GLYPHS: Partial<Record<FigNodeType, string>> = {
  FRAME: "▢",
  GROUP: "⊞",
  SECTION: "§",
  SYMBOL: "◆",
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
  // so we get "Rectangle" instead of all-caps.
  //
  // The on-disk SYMBOL type surfaces as the user-facing "Component"
  // label so the VS Code panel matches Figma's UI vocabulary.
  if (type === "SYMBOL") {
    return "Component";
  }
  const lower = type.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
