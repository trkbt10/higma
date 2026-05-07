/**
 * @file Site editor panel styles.
 */

import type { CSSProperties } from "react";
import { colorTokens, fontTokens, radiusTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";

export const sitePanelRootStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  boxSizing: "border-box",
  color: colorTokens.text.primary,
  fontSize: fontTokens.size.md,
};

export const sitePanelTitleStyle: CSSProperties = {
  fontSize: fontTokens.size.xl,
  fontWeight: fontTokens.weight.semibold,
};

export const sitePanelSectionTitleStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.semibold,
  color: colorTokens.text.secondary,
  textTransform: "uppercase",
  letterSpacing: fontTokens.letterSpacing.uppercase,
};

export const sitePanelRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: spacingTokens.sm,
  minHeight: 22,
  minWidth: 0,
};

export const sitePanelValueStyle: CSSProperties = {
  color: colorTokens.text.secondary,
  fontSize: fontTokens.size.sm,
  flex: 1,
  minWidth: 0,
  overflowWrap: "anywhere",
  textAlign: "right",
};

export const siteBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 18,
  padding: `0 ${spacingTokens.xs}`,
  borderRadius: radiusTokens.sm,
  background: colorTokens.background.tertiary,
  color: colorTokens.text.secondary,
  fontSize: fontTokens.size.sm,
  lineHeight: 1,
};

export const siteCodeStyle: CSSProperties = {
  fontFamily: '"Consolas", "Monaco", "Courier New", monospace',
  fontSize: fontTokens.size.sm,
  color: colorTokens.text.secondary,
  wordBreak: "break-all",
};
