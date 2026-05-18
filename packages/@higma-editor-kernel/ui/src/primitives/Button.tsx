/**
 * @file Button primitive component
 *
 * A minimal button component with variant and size support.
 */

import { useRef, type ReactNode, type CSSProperties, type MouseEvent } from "react";
import type { ButtonVariant } from "../types";
import { colorTokens, radiusTokens, fontTokens } from "../design-tokens";

export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = {
  readonly children: ReactNode;
  readonly onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly type?: "button" | "submit" | "reset";
  readonly title?: string;
};

/**
 * Inline `style` cannot express `:hover` / `:focus-visible` /
 * `:active` pseudo-classes, so the Button ships its own scoped
 * stylesheet on first mount. Variant-specific hover backgrounds are
 * derived from the base background (subtle darken for filled variants,
 * tint-on-transparent for ghost / outline).
 *
 * Focus indicator: 2px `selection.primary` outline at `:focus-visible`,
 * which gives 4.84:1 against white and 4.26:1 against bg.tertiary —
 * above the WCAG 2.4.7 minimum of 3:1.
 */
const styleFlag = { injected: false };
function injectStyles(): void {
  if (styleFlag.injected || typeof document === "undefined") {
    return;
  }
  const style = document.createElement("style");
  style.textContent = `
    .office-editor-button {
      position: relative;
    }
    .office-editor-button:focus-visible {
      outline: 2px solid var(--selection-primary, #0066ff);
      outline-offset: 2px;
    }
    .office-editor-button:not(:disabled):hover.office-editor-button--primary {
      filter: brightness(0.92);
    }
    .office-editor-button:not(:disabled):hover.office-editor-button--secondary {
      background-color: var(--bg-hover, #e8eaed) !important;
    }
    .office-editor-button:not(:disabled):hover.office-editor-button--ghost,
    .office-editor-button:not(:disabled):hover.office-editor-button--outline {
      background-color: var(--bg-hover, #e8eaed) !important;
    }
    .office-editor-button:not(:disabled):active {
      transform: translateY(1px);
    }
  `;
  document.head.appendChild(style);
  styleFlag.injected = true;
}

const baseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  fontWeight: fontTokens.weight.medium,
  fontFamily: "inherit",
  borderRadius: `var(--radius-sm, ${radiusTokens.sm})`,
  border: "none",
  cursor: "pointer",
  transition: "background-color 150ms ease, filter 150ms ease, transform 80ms ease",
  outline: "none",
};

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: {
    padding: "4px 8px",
    fontSize: fontTokens.size.xs,
  },
  md: {
    padding: "6px 12px",
    fontSize: fontTokens.size.sm,
  },
  lg: {
    padding: "8px 16px",
    fontSize: fontTokens.size.lg,
  },
};

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    color: colorTokens.text.inverse,
    backgroundColor: `var(--accent-primary, ${colorTokens.accent.primary})`,
  },
  secondary: {
    color: `var(--text-primary, ${colorTokens.text.primary})`,
    backgroundColor: `var(--bg-tertiary, ${colorTokens.background.tertiary})`,
    border: `1px solid var(--border-subtle, ${colorTokens.border.subtle})`,
  },
  ghost: {
    color: `var(--text-secondary, ${colorTokens.text.secondary})`,
    backgroundColor: "transparent",
  },
  outline: {
    color: `var(--text-secondary, ${colorTokens.text.secondary})`,
    backgroundColor: "transparent",
    border: `1px solid var(--border-strong, ${colorTokens.border.strong})`,
  },
};

const disabledStyle: CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
};

/**
 * Button primitive with variants and sizes.
 */
export function Button({
  children,
  onClick,
  variant = "secondary",
  size = "md",
  disabled,
  className,
  style,
  type = "button",
  title,
}: ButtonProps) {
  const initialized = useRef(false);
  if (!initialized.current) {
    injectStyles();
    initialized.current = true;
  }

  const combinedStyle: CSSProperties = {
    ...baseStyle,
    ...sizeStyles[size],
    ...variantStyles[variant],
    ...(disabled ? disabledStyle : {}),
    ...style,
  };

  const composedClassName = [
    "office-editor-button",
    `office-editor-button--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={composedClassName}
      style={combinedStyle}
      title={title}
    >
      {children}
    </button>
  );
}
