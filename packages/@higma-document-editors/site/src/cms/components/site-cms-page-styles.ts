/**
 * @file CMS workspace layout styles built on top of the shared site panel styles.
 */

import type { CSSProperties } from "react";
import { colorTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";

import { sitePanelRootStyle } from "../../panels/site-panel-styles";

export const siteCmsPageRootStyle: CSSProperties = {
  ...sitePanelRootStyle,
  gap: spacingTokens.md,
  padding: spacingTokens.md,
  overflowY: "auto",
  background: colorTokens.background.secondary,
};

export const siteCmsPageContentStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.md,
  flex: 1,
  minHeight: 0,
};
