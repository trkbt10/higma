/**
 * @file IconButton primitive component
 *
 * A button that displays an icon, optionally with a label.
 * When label is omitted, renders as a square icon-only button.
 */

import { useRef, type ReactNode, type CSSProperties, type MouseEvent } from "react";
import type { ButtonVariant } from "../types";
import { colorTokens, radiusTokens, fontTokens } from "../design-tokens";

/**
 * IconButton shares Button's hover / focus-visible / active visual
 * contract — the user expects identical interaction feedback from
 * both. Stylesheet is injected once; variants gain the same
 * hover-darken / hover-tint behaviour as Button.
 */
const styleFlag = { injected: false };
function injectStyles(): void {
  if (styleFlag.injected || typeof document === "undefined") {
    return;
  }
  const style = document.createElement("style");
  style.textContent = `
    .office-editor-icon-button {
      position: relative;
    }
    .office-editor-icon-button:focus-visible {
      outline: 2px solid var(--selection-primary, #0066ff);
      outline-offset: 2px;
    }
    .office-editor-icon-button:not(:disabled):hover.office-editor-icon-button--primary {
      filter: brightness(0.92);
    }
    .office-editor-icon-button:not(:disabled):hover.office-editor-icon-button--secondary,
    .office-editor-icon-button:not(:disabled):hover.office-editor-icon-button--ghost,
    .office-editor-icon-button:not(:disabled):hover.office-editor-icon-button--outline {
      background-color: var(--bg-hover, #e8eaed) !important;
    }
    .office-editor-icon-button:not(:disabled):active {
      transform: translateY(1px);
    }
  `;
  document.head.appendChild(style);
  styleFlag.injected = true;
}

export type IconButtonSize = "sm" | "md" | "lg";

export type IconButtonProps = {
  readonly icon: ReactNode;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  readonly variant?: ButtonVariant;
  readonly size?: IconButtonSize;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
};

const baseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "6px",
  fontWeight: fontTokens.weight.medium,
  fontFamily: "inherit",
  border: "none",
  cursor: "pointer",
  transition: "background-color 150ms ease, filter 150ms ease, transform 80ms ease",
  outline: "none",
};

const sizeStyles: Record<IconButtonSize, CSSProperties> = {
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

const iconOnlySizeStyles: Record<IconButtonSize, CSSProperties> = {
  sm: {
    padding: "4px",
    width: "28px",
    height: "28px",
  },
  md: {
    padding: "6px",
    width: "32px",
    height: "32px",
  },
  lg: {
    padding: "8px",
    width: "40px",
    height: "40px",
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
 * Icon button primitive. Renders a square button when label is omitted,
 * or a standard button with icon and label text when label is provided.
 */
export function IconButton({
  icon,
  label,
  ariaLabel,
  title,
  onClick,
  variant = "ghost",
  size = "md",
  disabled,
  className,
  style,
}: IconButtonProps) {
  const initialized = useRef(false);
  if (!initialized.current) {
    injectStyles();
    initialized.current = true;
  }
  const isIconOnly = !label;
  const sizeStyle = isIconOnly ? iconOnlySizeStyles[size] : sizeStyles[size];

  const combinedStyle: CSSProperties = {
    ...baseStyle,
    ...variantStyles[variant],
    ...sizeStyle,
    borderRadius: isIconOnly ? radiusTokens.sm : radiusTokens.md,
    ...(disabled ? disabledStyle : {}),
    ...style,
  };

  const composedClassName = [
    "office-editor-icon-button",
    `office-editor-icon-button--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={composedClassName}
      style={combinedStyle}
      aria-label={ariaLabel ?? label}
      title={title ?? ariaLabel ?? label}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
