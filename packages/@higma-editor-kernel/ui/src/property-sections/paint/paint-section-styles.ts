/** @file Shared styles for paint property section views. */

import type { CSSProperties } from "react";
import { colorTokens, fontTokens } from "../../design-tokens";

export const paintRowStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: "4px 0",
};

export const paintHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
};

export const paintInlineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  width: "100%",
};

export const swatchStyle: CSSProperties = {
  width: 24,
  height: 24,
  border: `1px solid ${colorTokens.border.strong}`,
  borderRadius: 4,
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};

export const hexStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  fontFamily: "monospace",
  color: colorTokens.text.primary,
  minWidth: 60,
};

/**
 * × remove buttons. The icon's `currentColor` inherits this style's
 * `color`, so the icon's contrast against the panel background matters.
 * text.primary (17.4:1 AAA) replaces text.tertiary (2.64:1) so the
 * "remove" affordance is reliably visible against any panel surface.
 */
export const removeButtonStyle: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: 2,
  color: colorTokens.text.primary,
  lineHeight: 0,
  flexShrink: 0,
};

export const addButtonStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  background: "none",
  border: `1px dashed ${colorTokens.border.primary}`,
  borderRadius: 4,
  cursor: "pointer",
  padding: "4px 8px",
  color: colorTokens.text.primary,
  fontSize: fontTokens.size.sm,
  width: "100%",
  justifyContent: "center",
};

export const sectionContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

export const IMAGE_ACCEPT_TYPES = "image/png,image/jpeg,image/gif,image/webp,image/svg+xml";
