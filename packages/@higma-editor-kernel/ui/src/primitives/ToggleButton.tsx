/**
 * @file ToggleButton primitive component
 *
 * A button-style toggle for compact on/off states. Pressed / mixed
 * states are expressed via the standard `aria-pressed` attribute; all
 * variant rules live in `ToggleButton.module.css`. No imperative
 * style injection, no className branching.
 */

import { useCallback, type CSSProperties, type ReactNode } from "react";
import styles from "./ToggleButton.module.css";

export type ToggleButtonProps = {
  /** Toggle state: `true`/`false` for on/off, `"mixed"` for indeterminate (matches `aria-pressed`). */
  readonly pressed: boolean | "mixed";
  readonly onChange: (pressed: boolean) => void;
  /** Text label (displayed if no children provided, always used for aria-label) */
  readonly label: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly style?: CSSProperties;
  /** Custom content (icon, etc.) - if provided, replaces label text */
  readonly children?: ReactNode;
};

/**
 * Toggle button with pressed state styling.
 */
export function ToggleButton({
  pressed,
  onChange,
  label,
  ariaLabel,
  disabled,
  style,
  children,
}: ToggleButtonProps) {
  const isMixed = pressed === "mixed";

  const handleClick = useCallback(() => {
    if (!disabled) {
      // When mixed, clicking always sets to true
      onChange(isMixed ? true : !pressed);
    }
  }, [disabled, onChange, pressed, isMixed]);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      className={styles.button}
      style={style}
      aria-pressed={pressed}
      aria-label={ariaLabel ?? label}
    >
      {children ?? label}
    </button>
  );
}
