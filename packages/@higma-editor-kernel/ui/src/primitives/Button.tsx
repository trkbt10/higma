/**
 * @file Button primitive component
 *
 * A minimal button component with variant and size support.
 *
 * Styling
 * -------
 * Variants (primary / secondary / ghost / outline) and sizes (sm / md
 * / lg) are expressed via `data-variant` and `data-size` attributes;
 * pseudo-class rules and per-variant hover behaviour live in
 * `Button.module.css`. The CSS Module import returns a JS-used class
 * map — no imperative style injection, no side-effect imports, no
 * className branching at the call site.
 */

import { type ReactNode, type CSSProperties, type MouseEvent } from "react";
import type { ButtonVariant } from "../types";
import styles from "./Button.module.css";

export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = {
  readonly children: ReactNode;
  readonly onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly disabled?: boolean;
  readonly style?: CSSProperties;
  readonly type?: "button" | "submit" | "reset";
  readonly title?: string;
  /**
   * Loading state. Disables the button, replaces leading content
   * with a spinner glyph, preserves the label width (so layout does
   * not shift when entering/leaving the loading state), and sets
   * `aria-busy="true"` so screen readers announce the busy state.
   */
  readonly loading?: boolean;
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
  style,
  type = "button",
  title,
  loading,
}: ButtonProps) {
  const effectiveDisabled = disabled || loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={effectiveDisabled}
      aria-busy={loading || undefined}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      style={style}
      title={title}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
