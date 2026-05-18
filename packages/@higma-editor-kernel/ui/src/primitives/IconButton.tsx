/**
 * @file IconButton primitive component
 *
 * A button that displays an icon, optionally with a label. When
 * `label` is omitted the button renders as a square icon-only tile;
 * with a label it renders icon + text. Both cases share Button's
 * hover / focus / active contract — the operator expects identical
 * interaction feedback from both primitives.
 *
 * Styling
 * -------
 * Variants (`data-variant`), sizes (`data-size`), and the icon-only
 * shape (`data-icon-only`) drive all rules in `IconButton.module.css`.
 * No imperative style injection, no className branching.
 */

import { type ReactNode, type CSSProperties, type MouseEvent } from "react";
import type { ButtonVariant } from "../types";
import styles from "./IconButton.module.css";

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
  readonly style?: CSSProperties;
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
  style,
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={styles.button}
      data-variant={variant}
      data-size={size}
      data-icon-only={label ? undefined : "true"}
      style={style}
      aria-label={ariaLabel ?? label}
      title={title ?? ariaLabel ?? label}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}
