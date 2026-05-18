/**
 * @file Toggle primitive component
 *
 * A minimal toggle/switch component.
 *
 * Implemented as a real `<button role="switch">` so the browser
 * supplies keyboard focus + Space/Enter activation natively. The
 * previous `<div role="switch">` was a screen-reader-only control —
 * keyboard users had no way to toggle it.
 *
 * Styling
 * -------
 * The checked / unchecked / disabled visual state is driven by
 * `aria-checked` and the native `:disabled` selector — see
 * `Toggle.module.css`. No imperative style injection, no className
 * branching.
 */

import { useCallback, type CSSProperties } from "react";
import styles from "./Toggle.module.css";

export type ToggleProps = {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label?: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly style?: CSSProperties;
};

/**
 * Toggle switch input.
 */
export function Toggle({ checked, onChange, label, ariaLabel, disabled, style }: ToggleProps) {
  const handleClick = useCallback(() => {
    if (!disabled) {
      onChange(!checked);
    }
  }, [checked, onChange, disabled]);

  return (
    <button
      type="button"
      style={style}
      className={styles.container}
      onClick={handleClick}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label}
      disabled={disabled}
    >
      <span className={styles.track}>
        <span className={styles.thumb} />
      </span>
      {label && <span className={styles.label}>{label}</span>}
    </button>
  );
}
