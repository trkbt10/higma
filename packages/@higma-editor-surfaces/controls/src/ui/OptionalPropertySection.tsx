/**
 * @file OptionalPropertySection - Unified property section for inspector panels
 *
 * The single collapsible section component for all inspector panels.
 * Embeds collapsible header + content layout directly (no external Accordion dependency).
 *
 * Two modes:
 * - Required mode: renders children directly (use `children` prop)
 * - Optional mode: renders editor when value exists, "Add" button when undefined
 *   (use `value`, `createDefault`, `onChange`, `renderEditor` props)
 */

import { useState, useCallback, type ReactNode, type CSSProperties } from "react";
import { ChevronRightIcon } from "@higma-editor-kernel/ui/icons";
import {
  colorTokens,
  fontTokens,
  iconTokens,
  spacingTokens,
  inspectorTokens,
} from "@higma-editor-kernel/ui/design-tokens";
import { Button } from "@higma-editor-kernel/ui/primitives";
import styles from "./OptionalPropertySection.module.css";

// =============================================================================
// Types
// =============================================================================

type BaseSectionProps = {
  readonly title: string;
  readonly defaultExpanded?: boolean;
  /** Controlled expanded state */
  readonly expanded?: boolean;
  /** Callback when expansion state changes */
  readonly onExpandedChange?: (expanded: boolean) => void;
  /** Disable interaction */
  readonly disabled?: boolean;
  /** Badge/count displayed next to the title */
  readonly badge?: string | number;
};

type RequiredSectionProps = BaseSectionProps & {
  readonly children: ReactNode;
  readonly value?: undefined;
  readonly createDefault?: undefined;
  readonly onChange?: undefined;
  readonly renderEditor?: undefined;
};

type OptionalSectionProps<T> = BaseSectionProps & {
  readonly children?: undefined;
  /** Current property value (undefined = not set) */
  readonly value: T | undefined;
  /** Factory function to create default value when "Add" is clicked */
  readonly createDefault: () => T;
  /** Called when property is added or updated */
  readonly onChange: (value: T) => void;
  /** Render the editor for the property value */
  readonly renderEditor: (value: T, onChange: (value: T) => void) => ReactNode;
};

export type OptionalPropertySectionProps<T = unknown> = RequiredSectionProps | OptionalSectionProps<T>;

// =============================================================================
// Styles
// =============================================================================

const containerStyle: CSSProperties = {
  borderBottom: `1px solid var(--border-subtle, ${colorTokens.border.subtle})`,
};

/**
 * Section header is a real `<button>` so the browser provides focus
 * indicator, Space, and Enter activation. The previous `<div role="button">`
 * was unreachable by keyboard and provided no hover feedback.
 *
 * Pseudo-class rules (`:focus-visible`, `:hover`) live in
 * `OptionalPropertySection.module.css`. The inline `outline` reset
 * has been removed from this style object — the CSS-Module rules and
 * the UA default ordering give us a clean keyboard focus ring without
 * any imperative style injection.
 */
const headerStyle = (disabled: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  width: "100%",
  padding: `${inspectorTokens.sectionPaddingBlock} ${inspectorTokens.sectionPaddingInline}`,
  cursor: disabled ? "not-allowed" : "pointer",
  userSelect: "none",
  opacity: disabled ? 0.5 : 1,
  background: "none",
  border: "none",
  borderRadius: 0,
  fontFamily: "inherit",
  textAlign: "left",
});

// Section title — the headline of every accordion section ("Position",
// "Fill", "Effects"). text.secondary at 6.05:1 fails AAA. text.primary
// (17.4:1) restores AAA without changing the typographic identity:
// the uppercase + tracking + semibold weight already communicate
// "header" without needing a chromatic step down.
const titleStyle: CSSProperties = {
  fontSize: fontTokens.size.sm,
  fontWeight: fontTokens.weight.semibold,
  color: `var(--text-primary, ${colorTokens.text.primary})`,
  textTransform: "uppercase",
  letterSpacing: "0.3px",
  display: "flex",
  alignItems: "center",
  gap: spacingTokens.xs,
};

// Disclosure chevron is non-text iconography. Its contrast against the
// section header background still matters (operator needs to see the
// expand/collapse affordance). Upgraded from text.tertiary (2.64:1)
// to text.primary (17.4:1).
const chevronContainerStyle = (expanded: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: `var(--text-primary, ${colorTokens.text.primary})`,
  transition: "transform 150ms ease",
  transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
});

const contentWrapperStyle = (expanded: boolean): CSSProperties => ({
  overflow: "hidden",
  maxHeight: expanded ? "2000px" : "0",
  opacity: expanded ? 1 : 0,
  visibility: expanded ? "visible" : "hidden",
  pointerEvents: expanded ? "auto" : "none",
  transition: "max-height 200ms ease, opacity 150ms ease",
});

const contentStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: spacingTokens.sm,
  padding: `0 ${inspectorTokens.sectionPaddingInline} ${inspectorTokens.sectionPaddingBlock} ${inspectorTokens.sectionPaddingInline}`,
};

// Section count badge ("Effects 2", "Layers 5"). Functional readout.
// text.primary on bg.tertiary = 15.4:1 (AAA). Previously text.tertiary
// at 2.34:1.
const badgeStyle: CSSProperties = {
  fontSize: fontTokens.size.xs,
  color: `var(--text-primary, ${colorTokens.text.primary})`,
  backgroundColor: `var(--bg-tertiary, ${colorTokens.background.tertiary})`,
  padding: "2px 6px",
  borderRadius: "4px",
  fontWeight: fontTokens.weight.medium,
};

const addButtonContainerStyle: CSSProperties = {
  textAlign: "center",
};

// =============================================================================
// Helpers
// =============================================================================

function resolveContent<T>(props: OptionalPropertySectionProps<T>, title: string): ReactNode {
  if (props.children !== undefined) {
    return props.children;
  }
  const { value, createDefault, onChange, renderEditor } = props as OptionalSectionProps<T>;
  if (value !== undefined) {
    return renderEditor(value, onChange);
  }
  return (
    <div style={addButtonContainerStyle}>
      <Button variant="secondary" size="sm" onClick={() => onChange(createDefault())}>
        Add {title}
      </Button>
    </div>
  );
}

// =============================================================================
// Component
// =============================================================================

/**
 * Unified property section for inspector panels.
 *
 * Required mode (children):
 * ```tsx
 * <OptionalPropertySection title="Transform" defaultExpanded>
 *   <div>content</div>
 * </OptionalPropertySection>
 * ```
 *
 * Optional mode (value + renderEditor):
 * ```tsx
 * <OptionalPropertySection
 *   title="Fill"
 *   value={fill}
 *   createDefault={() => ({ type: "solid", color: "#000" })}
 *   onChange={setFill}
 *   renderEditor={(v, onChange) => <FillEditor value={v} onChange={onChange} />}
 * />
 * ```
 */
export function OptionalPropertySection<T>(props: OptionalPropertySectionProps<T>) {
  const {
    title,
    defaultExpanded = false,
    expanded: controlledExpanded,
    onExpandedChange,
    disabled,
  } = props;

  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;

  const handleToggle = useCallback(() => {
    if (disabled) { return; }
    if (isControlled) {
      onExpandedChange?.(!expanded);
    } else {
      setInternalExpanded(!expanded);
      onExpandedChange?.(!expanded);
    }
  }, [disabled, isControlled, expanded, onExpandedChange]);

  // Determine content
  const content = resolveContent(props, title);

  return (
    <div style={containerStyle}>
      <button
        type="button"
        style={headerStyle(disabled ?? false)}
        className={styles.header}
        onClick={handleToggle}
        aria-expanded={expanded}
        disabled={disabled}
      >
        <span style={titleStyle}>
          {title}
          {props.badge !== undefined && <span style={badgeStyle}>{props.badge}</span>}
        </span>
        <span style={chevronContainerStyle(expanded)}>
          <ChevronRightIcon size={iconTokens.size.sm} strokeWidth={iconTokens.strokeWidth} />
        </span>
      </button>
      <div style={contentWrapperStyle(expanded)} aria-hidden={!expanded}>
        <div style={contentStyle}>{content}</div>
      </div>
    </div>
  );
}
