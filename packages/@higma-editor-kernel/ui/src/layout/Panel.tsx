/**
 * @file Panel layout component
 *
 * Reusable panel container for sidebars and property panels.
 * Uses design tokens for consistent styling.
 */

import type { ReactNode, CSSProperties } from "react";
import { colorTokens, fontTokens, radiusTokens, spacingTokens } from "../design-tokens";

// =============================================================================
// Types
// =============================================================================

export type PanelProps = {
  /** Panel content */
  readonly children: ReactNode;
  /** Panel title (optional) */
  readonly title?: string;
  /** Badge/count to show next to title (optional) */
  readonly badge?: string | number;
  /** Panel width (default: 280px) */
  readonly width?: number | string;
  /** Custom class name */
  readonly className?: string;
  /** Custom style */
  readonly style?: CSSProperties;
};

// =============================================================================
// Component
// =============================================================================

/**
 * Panel container for sidebar content.
 *
 * Provides consistent styling for editor panels with optional header.
 *
 * @example
 * ```tsx
 * <Panel title="Layers" badge={5}>
 *   <LayerList />
 * </Panel>
 * ```
 */
export function Panel({ children, title, badge, width = 280, className, style }: PanelProps) {
  const containerStyle: CSSProperties = {
    width: typeof width === "number" ? `${width}px` : width,
    flexShrink: 0,
    backgroundColor: `var(--bg-primary, ${colorTokens.background.primary})`,
    borderRadius: `var(--radius-md, ${radiusTokens.md})`,
    border: `1px solid var(--border-strong, ${colorTokens.border.strong})`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    ...style,
  };

  const headerStyle: CSSProperties = {
    padding: `${spacingTokens.sm} ${spacingTokens.md}`,
    borderBottom: `1px solid var(--border-subtle, ${colorTokens.border.subtle})`,
    fontSize: fontTokens.size.md,
    fontWeight: fontTokens.weight.semibold,
    color: `var(--text-primary, ${colorTokens.text.primary})`,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };

  // The count badge ("Layers 12") is a functional readout, not
  // decoration — operators rely on it to know how many items are in
  // the section. text.primary brings it to 15.4:1 (AAA) against the
  // tertiary background, where text.tertiary was 2.34:1 (below AA).
  const badgeStyle: CSSProperties = {
    fontSize: fontTokens.size.xs,
    color: `var(--text-primary, ${colorTokens.text.primary})`,
    backgroundColor: `var(--bg-tertiary, ${colorTokens.background.tertiary})`,
    padding: `${spacingTokens.xs} ${spacingTokens.sm}`,
    borderRadius: radiusTokens.sm,
    fontWeight: fontTokens.weight.medium,
  };

  const contentStyle: CSSProperties = {
    flex: 1,
    overflow: "auto",
  };

  return (
    <div className={className} style={containerStyle}>
      {title && (
        <div style={headerStyle}>
          <span>{title}</span>
          {badge !== undefined && <span style={badgeStyle}>{badge}</span>}
        </div>
      )}
      <div style={contentStyle}>{children}</div>
    </div>
  );
}
