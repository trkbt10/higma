/**
 * @file Header used by every CMS workspace page.
 */

import type { CSSProperties, ReactNode } from "react";
import { Breadcrumb, type BreadcrumbItem } from "@higma-editor-kernel/ui/editor";
import { colorTokens, fontTokens, spacingTokens } from "@higma-editor-kernel/ui/design-tokens";

export type SiteCmsPageHeaderProps = {
  readonly title: string;
  readonly description?: string;
  readonly breadcrumb: readonly BreadcrumbItem[];
  readonly onBreadcrumbClick?: (id: string, index: number) => void;
  readonly trailing?: ReactNode;
};

const headerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.xs,
  paddingBottom: spacingTokens.sm,
  borderBottom: `1px solid ${colorTokens.border.subtle}`,
};

const titleRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: spacingTokens.md,
};

const titleStyle: CSSProperties = {
  fontSize: fontTokens.size.xl,
  fontWeight: fontTokens.weight.semibold,
  color: colorTokens.text.primary,
};

const descriptionStyle: CSSProperties = {
  color: colorTokens.text.tertiary,
  fontSize: fontTokens.size.sm,
};

const trailingStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.sm,
};

/** Render the breadcrumb + title block shared by every CMS page. */
export function SiteCmsPageHeader({
  title,
  description,
  breadcrumb,
  onBreadcrumbClick,
  trailing,
}: SiteCmsPageHeaderProps) {
  return (
    <header style={headerStyle}>
      <Breadcrumb items={breadcrumb} onItemClick={onBreadcrumbClick} />
      <div style={titleRowStyle}>
        <h1 style={titleStyle}>{title}</h1>
        {trailing && <div style={trailingStyle}>{trailing}</div>}
      </div>
      {description && <p style={descriptionStyle}>{description}</p>}
    </header>
  );
}
